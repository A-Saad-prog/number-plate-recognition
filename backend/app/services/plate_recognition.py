import os
import re
import base64
import time
import threading
import logging
from datetime import datetime
from uuid import uuid4

import cv2
import numpy as np
from dotenv import load_dotenv

# Disable PaddlePaddle features that caused compatibility issues
os.environ["FLAGS_enable_pir_api"] = "0"

from ultralytics import YOLO
from paddleocr import TextRecognition

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:
    boto3 = None
    BotoCoreError = ClientError = Exception

load_dotenv(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env")))

# ============================================================
# Configuration
# ============================================================

MODEL_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "../../../models/best.pt",
    )
)

CONFIDENCE_THRESHOLD = 0.30
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "640"))
YOLO_DEVICE = os.getenv("YOLO_DEVICE") or None
VISION_DEBUG = os.getenv("VISION_DEBUG", "").lower() in {"1", "true", "yes"}

OCR_CONFIDENCE_THRESHOLD = 0.50
OCR_ACCEPT_CONFIDENCE_THRESHOLD = 0.80
OCR_STRONG_FORMAT_CONFIDENCE_THRESHOLD = float(
    os.getenv("OCR_STRONG_FORMAT_CONFIDENCE_THRESHOLD", "0.60")
)
OCR_RECOGNITION_MODEL = os.getenv(
    "OCR_RECOGNITION_MODEL", "en_PP-OCRv5_mobile_rec"
)

PLATE_HORIZONTAL_PADDING_RATIO = 0.12
PLATE_VERTICAL_PADDING_RATIO = 0.25

ocr_states = {}
ocr_states_lock = threading.Lock()
ocr_lock = threading.Lock()
vision_logger = logging.getLogger(__name__)


def _vision_debug(message, *args):
    if VISION_DEBUG:
        vision_logger.info(message, *args)


def _vision_debug_request(request_id, source, **timings):
    if not VISION_DEBUG:
        return

    parts = [
        f"id={request_id or 'n/a'}",
        f"source={source or 'default'}",
    ]
    for key, value in timings.items():
        if isinstance(value, float):
            parts.append(f"{key}={value:.1f}ms")
        else:
            parts.append(f"{key}={value}")
    vision_logger.info("[Vision BE] %s", " ".join(parts))


# ============================================================
# Load YOLO
# ============================================================

print("Loading YOLO...")

yolo = YOLO(MODEL_PATH)

print("YOLO loaded.")


# ============================================================
# Load OCR
# ============================================================

print("Loading OCR recognition model...")

# YOLO already isolates the plate, so use Paddle's recognition-only predictor
# rather than loading and running a second text detector on the same crop.
ocr = TextRecognition(model_name=OCR_RECOGNITION_MODEL)

print("OCR recognition model loaded.")


# ============================================================
# FPS Tracking
# ============================================================

fps_start_time = time.time()
fps_frame_count = 0
current_fps = 0.0


def update_fps():

    global fps_start_time
    global fps_frame_count
    global current_fps

    fps_frame_count += 1

    elapsed = time.time() - fps_start_time

    if elapsed >= 1.0:

        current_fps = fps_frame_count / elapsed

        fps_frame_count = 0
        fps_start_time = time.time()

    return current_fps


# ============================================================
# License Plate Validation / Normalization
# ============================================================

from app.services.plate_formats import (
    classify_plate,
    is_valid_plate,
    normalize_plate,
)


def _ocr_state(source):
    with ocr_states_lock:
        return ocr_states.setdefault(
            source,
            {
                "ocr_in_flight": False,
                "vision_lock": threading.Lock(),
                "lock": threading.RLock(),
            },
        )


def _upload_accepted_frame(frame, metadata):
    """Upload the frame that produced a valid OCR result."""
    bucket = os.getenv("AWS_S3_BUCKET")
    endpoint_url = os.getenv("AWS_ENDPOINT_URL_S3")
    region = os.getenv("AWS_REGION")

    if not boto3:
        print("Accepted-frame upload skipped: boto3 is not installed")
        return

    if not bucket or not endpoint_url:
        print("Accepted-frame upload skipped: S3 configuration is incomplete")
        return

    success, encoded_frame = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not success:
        return

    plate = re.sub(r"[^A-Z0-9-]", "", metadata["plate"])
    captured_at = datetime.now()
    object_key = (
        f"{captured_at:%Y}/{captured_at:%m}/{captured_at:%d}/"
        f"{plate}-{captured_at:%H%M%S}-{uuid4().hex[:8]}.jpg"
    )

    try:
        client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        )
        client.put_object(
            Bucket=bucket,
            Key=object_key,
            Body=encoded_frame.tobytes(),
            ContentType="image/jpeg",
        )
        print(f"Accepted frame uploaded: {object_key}")
    except (BotoCoreError, ClientError, OSError) as error:
        print(f"Accepted-frame upload failed: {error.__class__.__name__}")


def _upload_accepted_frame_in_background(frame, metadata):
    threading.Thread(
        target=_upload_accepted_frame,
        args=(frame, metadata),
        daemon=True,
    ).start()


# ============================================================
# Decode Browser Image
# ============================================================


def decode_image(image_base64: str):

    try:

        if "," in image_base64:

            image_base64 = image_base64.split(",", 1)[1]

        image_bytes = base64.b64decode(image_base64)

        image_array = np.frombuffer(
            image_bytes,
            dtype=np.uint8,
        )

        image = cv2.imdecode(
            image_array,
            cv2.IMREAD_COLOR,
        )

        return image

    except Exception as error:

        print(f"Image decoding error: {error}")

        return None


# ============================================================
# Encode Plate Image
# ============================================================


def encode_plate_image(plate_crop):

    try:

        success, encoded_image = cv2.imencode(
            ".jpg",
            plate_crop,
            [
                cv2.IMWRITE_JPEG_QUALITY,
                95,
            ],
        )

        if not success:

            return None

        return base64.b64encode(encoded_image.tobytes()).decode("utf-8")

    except Exception as error:

        print(f"Image encoding error: {error}")

        return None


# ============================================================
# OCR
# ============================================================


def read_plate(plate_crop, source=None, request_id=None):
    started_at = time.perf_counter()
    preprocess_ms = 0.0
    recognition_ms = 0.0

    try:
        height, width = plate_crop.shape[:2]
        if width < 160 or height < 32:
            scale = min(3.0, max(160 / width, 32 / height))
            plate_crop = cv2.resize(
                plate_crop,
                (round(width * scale), round(height * scale)),
                interpolation=cv2.INTER_CUBIC,
            )

        height, width = plate_crop.shape[:2]
        if height >= 2 and width / height < 2.0:
            split_at = height // 2
            top_line = plate_crop[:split_at]
            bottom_line = plate_crop[split_at:]
            target_height = max(top_line.shape[0], bottom_line.shape[0])
            top_line = cv2.resize(
                top_line,
                (round(top_line.shape[1] * target_height / top_line.shape[0]), target_height),
                interpolation=cv2.INTER_CUBIC,
            )
            bottom_line = cv2.resize(
                bottom_line,
                (round(bottom_line.shape[1] * target_height / bottom_line.shape[0]), target_height),
                interpolation=cv2.INTER_CUBIC,
            )
            separator = np.full(
                (target_height, max(4, target_height // 8), 3),
                255,
                dtype=np.uint8,
            )
            plate_crop = np.hstack((top_line, separator, bottom_line))
        preprocess_ms = (time.perf_counter() - started_at) * 1000

        recognition_started_at = time.perf_counter()
        results = ocr.predict(plate_crop)
        recognition_ms = (time.perf_counter() - recognition_started_at) * 1000

        texts = []
        scores = []

        for result in results:

            data = result.get("rec_text", [])
            confidence = result.get("rec_score", [])
            if not isinstance(data, (list, tuple, np.ndarray)):
                data = [data]
            if not isinstance(confidence, (list, tuple, np.ndarray)):
                confidence = [confidence]

            for text, score in zip(
                data,
                confidence,
            ):

                score = float(score)

                if score < OCR_CONFIDENCE_THRESHOLD:
                    continue

                text = text.strip()

                if not text:
                    continue

                texts.append(text)
                scores.append(score)

        if not texts:
            return None

        result = classify_plate("\n".join(texts), max(scores))

        strong_format_accept = (
            result is not None
            and result["confidence"] >= OCR_STRONG_FORMAT_CONFIDENCE_THRESHOLD
            and result.get("corrections", 0) <= 1
        )

        if result is None or (
            result["confidence"] < OCR_ACCEPT_CONFIDENCE_THRESHOLD
            and not strong_format_accept
        ):
            _vision_debug(
                "OCR rejected: %s (confidence: %.2f)",
                " ".join(texts),
                max(scores),
            )
            return None

        _vision_debug(
            "OCR accepted candidate %s (confidence: %.2f)",
            result["plate"],
            result["confidence"],
        )

        return result

    except Exception as error:

        print(f"OCR error: {error}")

        return None

    finally:
        _vision_debug(
            "[OCR] id=%s source=%s preprocess=%.1fms detection=0.0ms recognition=%.1fms total=%.1fms",
            request_id or "n/a",
            source or "default",
            preprocess_ms,
            recognition_ms,
            (time.perf_counter() - started_at) * 1000,
        )


def _run_ocr_vote(
    source: str,
    plate_crop,
    frame_for_upload,
    request_id: str | None = None,
):
    """Run one OCR read from one detected plate crop."""
    state = _ocr_state(source)
    started_at = time.perf_counter()
    predict_ms = 0.0

    try:
        if plate_crop is None or plate_crop.size == 0:
            return None

        with ocr_lock:
            timing_started_at = time.perf_counter()
            ocr_result = read_plate(plate_crop, source, request_id)
            predict_ms = (time.perf_counter() - timing_started_at) * 1000

        if not ocr_result:
            return None

        _upload_accepted_frame_in_background(frame_for_upload, ocr_result)
        if VISION_DEBUG:
            vision_logger.info(
                "[OCR] id=%s source=%s predict=%.1fms validation=%.1fms accepted=%s",
                request_id or "n/a",
                source,
                predict_ms,
                0.0,
                ocr_result.get("plate") or "n/a",
            )
        return ocr_result
    finally:
        with state["lock"]:
            state["ocr_in_flight"] = False
        _vision_debug(
            "Vision OCR timing source=%s ocr_ms=%.1f",
            source,
            (time.perf_counter() - started_at) * 1000,
        )


# ============================================================
# Detect Plate
#
# This is the main function called by FastAPI.
#
# Browser frame
#       ↓
# Decode
#       ↓
# YOLO
#       ↓
# Bounding box
#       ↓
# Crop
#       ↓
# PaddleOCR
#       ↓
# Text recognition
# ============================================================


def _pending_ocr_response(state, source, request_id, request_started_at):
    _vision_debug_request(
        request_id,
        source,
        decode=0.0,
        yolo=0.0,
        total=(time.perf_counter() - request_started_at) * 1000,
        ocr_pending=state["ocr_in_flight"],
        yolo_skipped=True,
    )
    return {
        "detected": True,
        "license_plate": None,
        "plate_metadata": None,
        "plate_image": None,
        "confidence": 0.0,
        "box": None,
        "fps": current_fps,
    }


def detect_plate(
    image_base64: str, source: str | None = None, request_id: str | None = None
):
    source = source or "default"
    state = _ocr_state(source)
    request_started_at = time.perf_counter()

    with state["lock"]:
        if state["ocr_in_flight"]:
            return _pending_ocr_response(state, source, request_id, request_started_at)

    # Do not let two requests for the same source pass the OCR-busy check
    # before the first request has scheduled its OCR worker.
    if not state["vision_lock"].acquire(blocking=False):
        with state["lock"]:
            return _pending_ocr_response(state, source, request_id, request_started_at)

    try:
        return _detect_plate(image_base64, source, request_id)
    finally:
        state["vision_lock"].release()


def _detect_plate(
    image_base64: str, source: str | None = None, request_id: str | None = None
):

    global current_fps
    source = source or "default"
    state = _ocr_state(source)
    request_started_at = time.perf_counter()

    with state["lock"]:
        if state["ocr_in_flight"]:
            return _pending_ocr_response(state, source, request_id, request_started_at)

    frame = decode_image(image_base64)
    decoded_at = time.perf_counter()
    if VISION_DEBUG:
        _vision_debug_request(
            request_id,
            source,
            decode=(decoded_at - request_started_at) * 1000,
        )

    if frame is None:

        raise ValueError("Could not decode camera frame.")

    # ========================================================
    # FPS
    # ========================================================

    current_fps = update_fps()

    # ========================================================
    # Image dimensions
    # ========================================================

    height, width = frame.shape[:2]

    # ========================================================
    # YOLO
    # ========================================================

    inference_options = {
        "source": frame,
        "conf": CONFIDENCE_THRESHOLD,
        "verbose": False,
        "imgsz": YOLO_IMGSZ,
    }
    if YOLO_DEVICE:
        inference_options["device"] = YOLO_DEVICE

    yolo_started_at = time.perf_counter()
    results = yolo.predict(**inference_options)
    yolo_finished_at = time.perf_counter()
    if VISION_DEBUG:
        _vision_debug_request(
            request_id,
            source,
            decode=(decoded_at - request_started_at) * 1000,
            yolo=(yolo_finished_at - yolo_started_at) * 1000,
        )

    # ========================================================
    # Find strongest plate
    # ========================================================

    best_box = None

    best_confidence = 0.0

    for result in results:

        if result.boxes is None:
            continue

        for box in result.boxes:

            confidence = float(box.conf[0])

            if confidence > best_confidence:

                best_confidence = confidence

                best_box = box.xyxy[0].tolist()

    # ========================================================
    # No plate detected
    # ========================================================

    if best_box is None:

        _vision_debug(
            "Vision timing source=%s decode_ms=%.1f yolo_ms=%.1f total_ms=%.1f detected=false",
            source,
            (decoded_at - request_started_at) * 1000,
            (yolo_finished_at - decoded_at) * 1000,
            (time.perf_counter() - request_started_at) * 1000,
        )

        return {
            "detected": False,
            "license_plate": None,
            "plate_metadata": None,
            "plate_image": None,
            "confidence": 0.0,
            "box": None,
            "fps": current_fps,
        }

    # ========================================================
    # Bounding box
    # ========================================================

    x1, y1, x2, y2 = map(
        int,
        best_box,
    )

    x1 = max(
        0,
        x1,
    )

    y1 = max(
        0,
        y1,
    )

    x2 = min(
        width,
        x2,
    )

    y2 = min(
        height,
        y2,
    )

    # ========================================================
    # Crop with padding
    # ========================================================

    crop_started_at = time.perf_counter()
    box_width = x2 - x1
    box_height = y2 - y1
    horizontal_padding = max(
        4, min(18, round(box_width * PLATE_HORIZONTAL_PADDING_RATIO))
    )
    vertical_padding = max(3, min(12, round(box_height * PLATE_VERTICAL_PADDING_RATIO)))

    crop_x1 = max(0, x1 - horizontal_padding)
    crop_y1 = max(0, y1 - vertical_padding)
    crop_x2 = min(width, x2 + horizontal_padding)
    crop_y2 = min(height, y2 + vertical_padding)

    plate_crop = frame[
        crop_y1:crop_y2,
        crop_x1:crop_x2,
    ]
    crop_ms = (time.perf_counter() - crop_started_at) * 1000

    if plate_crop.size == 0:

        return {
            "detected": True,
            "license_plate": None,
            "plate_metadata": None,
            "plate_image": None,
            "confidence": best_confidence,
            "box": {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
            },
            "fps": current_fps,
        }

    # Mark OCR busy before starting the one recognition call. The source lock
    # prevents concurrent requests from starting duplicate work.
    with state["lock"]:
        state["ocr_in_flight"] = True

    plate_metadata = _run_ocr_vote(source, plate_crop.copy(), frame, request_id)
    recognized_plate = plate_metadata["plate"] if plate_metadata else None
    response_started_at = time.perf_counter()
    if VISION_DEBUG:
        _vision_debug_request(
            request_id,
            source,
            decode=(decoded_at - request_started_at) * 1000,
            yolo=(yolo_finished_at - yolo_started_at) * 1000,
            crop=crop_ms,
            response=(response_started_at - request_started_at) * 1000,
            total=(time.perf_counter() - request_started_at) * 1000,
            ocr_pending=str(recognized_plate is None),
        )
    _vision_debug(
        "Vision timing source=%s decode_ms=%.1f yolo_ms=%.1f box_ms=%.1f total_ms=%.1f ocr_pending=%s",
        source,
        (decoded_at - request_started_at) * 1000,
        (yolo_finished_at - decoded_at) * 1000,
        (time.perf_counter() - yolo_finished_at) * 1000,
        (time.perf_counter() - request_started_at) * 1000,
        recognized_plate is None,
    )

    # ========================================================
    # Return everything to React
    # ========================================================

    return {
        "detected": True,
        "license_plate": recognized_plate,
        "plate_metadata": plate_metadata,
        "plate_image": None,
        "confidence": best_confidence,
        "box": {
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
        },
        "fps": current_fps,
    }


# ============================================================
# Compatibility Wrapper
# ============================================================


def recognize_plate(image_base64: str):

    result = detect_plate(image_base64)

    if not result["detected"]:

        raise ValueError("No license plate detected.")

    if not result["license_plate"]:

        raise ValueError("License plate detected, " "but OCR could not read it.")

    return result
