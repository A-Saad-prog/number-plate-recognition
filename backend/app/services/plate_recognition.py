import os
import re
import base64
import time

import cv2
import numpy as np

from collections import Counter

# Disable PaddlePaddle features that caused compatibility issues
os.environ["FLAGS_enable_pir_api"] = "0"

from ultralytics import YOLO
from paddleocr import PaddleOCR

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

OCR_READINGS_REQUIRED = 1

OCR_CONFIDENCE_THRESHOLD = 0.50

PLATE_PADDING = 10


# ============================================================
# Load YOLO
# ============================================================

print("Loading YOLO...")

yolo = YOLO(MODEL_PATH)

print("YOLO loaded.")


# ============================================================
# Load OCR
# ============================================================

print("Loading OCR...")

ocr = PaddleOCR(
    lang="en",
    enable_mkldnn=False,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
)

print("OCR loaded.")


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
# License Plate Validation
# ============================================================


def is_valid_plate(text: str) -> bool:

    if not text:
        return False

    text = text.upper().strip()

    text = text.replace(" ", "")

    pattern = r"^[A-Z]{3}-?[0-9]{4}$"

    return bool(re.match(pattern, text))


# ============================================================
# Normalize Plate
# ============================================================


def normalize_plate(text: str) -> str:

    text = text.upper().strip()

    text = text.replace(" ", "")

    if len(text) == 7 and "-" not in text:

        text = text[:3] + "-" + text[3:]

    return text


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


def read_plate(plate_crop):

    try:

        results = ocr.predict(plate_crop)

        texts = []
        scores = []

        for result in results:

            data = result.get(
                "rec_texts",
                [],
            )

            confidence = result.get(
                "rec_scores",
                [],
            )

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

        best_index = scores.index(max(scores))

        text = texts[best_index]

        if not is_valid_plate(text):

            print(f"OCR rejected: {text}")

            return None

        plate = normalize_plate(text)

        print(f"OCR: {plate} " f"(confidence: " f"{scores[best_index]:.2f})")

        return plate

    except Exception as error:

        print(f"OCR error: {error}")

        return None


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
# Majority vote
# ============================================================


def detect_plate(image_base64: str):

    global current_fps

    frame = decode_image(image_base64)

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

    results = yolo.predict(
        source=frame,
        conf=CONFIDENCE_THRESHOLD,
        device="cpu",
        verbose=False,
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

        return {
            "detected": False,
            "license_plate": None,
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

    crop_x1 = max(
        0,
        x1 - PLATE_PADDING,
    )

    crop_y1 = max(
        0,
        y1 - PLATE_PADDING,
    )

    crop_x2 = min(
        width,
        x2 + PLATE_PADDING,
    )

    crop_y2 = min(
        height,
        y2 + PLATE_PADDING,
    )

    plate_crop = frame[
        crop_y1:crop_y2,
        crop_x1:crop_x2,
    ]

    if plate_crop.size == 0:

        return {
            "detected": True,
            "license_plate": None,
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

    # ========================================================
    # OCR
    #
    # Same 3-reading majority voting logic
    # from your original plate_detector.py.
    # ========================================================

    ocr_results = []

    for _ in range(OCR_READINGS_REQUIRED):

        plate = read_plate(plate_crop)

        if plate:

            ocr_results.append(plate)

    # ========================================================
    # Majority vote
    # ========================================================

    recognized_plate = None

    if ocr_results:

        counts = Counter(ocr_results)

        recognized_plate = counts.most_common(1)[0][0]

    # ========================================================
    # Encode crop
    # ========================================================

    plate_image_base64 = encode_plate_image(plate_crop)

    # ========================================================
    # Return everything to React
    # ========================================================

    return {
        "detected": True,
        "license_plate": recognized_plate,
        "plate_image": plate_image_base64,
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
