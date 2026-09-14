import os
import re
import time
import threading
import logging
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
from dotenv import load_dotenv

# Disable PaddlePaddle features that caused compatibility issues
os.environ["FLAGS_enable_pir_api"] = "0"

from ultralytics import YOLO
from ultralytics.utils.nms import non_max_suppression
from ultralytics.utils.ops import scale_boxes
from paddleocr import TextRecognition
import torch

logger = logging.getLogger(__name__)

try:
    import psutil
    _runtime_process = psutil.Process(os.getpid())
except ImportError:
    _runtime_process = None

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:
    boto3 = None
    BotoCoreError = ClientError = Exception

load_dotenv(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env")))

# ============================================================
# Shared vision model / config / helper module
#
# The live recognition pipeline lives in app/api/vision.py
# (POST /vision/detect-plate -> detect_license_plate() ->
# _process_plate_frame()). This module now only provides the
# shared YOLO/OCR model objects, the config constants those
# depend on, FPS tracking, and the accepted-frame upload helper
# that vision.py imports.
# ============================================================

MODEL_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "../../../models/best.pt",
    )
)
OPENVINO_MODEL_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "../../../models/best_openvino_model",
    )
)

CONFIDENCE_THRESHOLD = 0.30
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "640"))
YOLO_DEVICE = os.getenv("YOLO_DEVICE") or None
YOLO_BACKEND = os.getenv("YOLO_BACKEND", "pytorch").strip().lower()


def _env_flag(name):
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


OPENVINO_INFERENCE_THREADS = int(
    os.getenv("OPENVINO_INFERENCE_THREADS", "8")
)
try:
    OPENVINO_NUM_STREAMS = int(os.getenv("OPENVINO_NUM_STREAMS", ""))
    if OPENVINO_NUM_STREAMS < 1:
        OPENVINO_NUM_STREAMS = None
except (TypeError, ValueError):
    OPENVINO_NUM_STREAMS = None
OPENVINO_CPU_PINNING = _env_flag("OPENVINO_CPU_PINNING")
OPENVINO_DISABLE_HT = _env_flag("OPENVINO_DISABLE_HT")
VISION_RUNTIME_DEBUG = os.getenv("VISION_RUNTIME_DEBUG", "").strip().lower() in {
    "1", "true", "yes", "on"
}
YOLO_NMS_IOU = 0.70  # Ultralytics predict() default; preserve existing NMS behavior.
YOLO_MAX_DETECTIONS = 300  # Ultralytics predict() default.

OCR_RECOGNITION_MODEL = os.getenv(
    "OCR_RECOGNITION_MODEL", "en_PP-OCRv5_mobile_rec"
)
OCR_BACKEND = os.getenv("OCR_BACKEND", "paddle").strip().lower()
if OCR_BACKEND not in {"paddle", "onnxruntime"}:
    print(f"Unknown OCR_BACKEND={OCR_BACKEND!r}; using paddle.")
    OCR_BACKEND = "paddle"
try:
    PADDLE_OCR_CPU_THREADS = max(
        1,
        int(os.getenv("PADDLE_OCR_CPU_THREADS", "2")),
    )
except (TypeError, ValueError):
    PADDLE_OCR_CPU_THREADS = 2
try:
    ONNX_OCR_INTRA_THREADS = max(
        1,
        int(os.getenv("ONNX_OCR_INTRA_THREADS", "2")),
    )
except (TypeError, ValueError):
    ONNX_OCR_INTRA_THREADS = 2
ONNX_OCR_MODEL_DIR = Path(
    os.getenv(
        "ONNX_OCR_MODEL_DIR",
        str(Path.home() / ".paddlex" / "official_models" / "en_PP-OCRv5_mobile_rec_onnx"),
    )
)


# ============================================================
# Load YOLO detector
# ============================================================

if YOLO_BACKEND not in {"openvino", "pytorch"}:
    print(f"Unknown YOLO_BACKEND={YOLO_BACKEND!r}; using pytorch.")
    YOLO_BACKEND = "pytorch"

yolo = None
_openvino_detector = None
_active_yolo_backend = None


class OpenVINOYOLODetector:
    """Direct OpenVINO runtime wrapper for the exported static YOLO11 model."""

    def __init__(self, model_dir):
        try:
            from openvino import Core
        except ImportError:
            from openvino.runtime import Core

        xml_files = [
            os.path.join(model_dir, name)
            for name in os.listdir(model_dir)
            if name.endswith(".xml")
        ]
        if len(xml_files) != 1:
            raise RuntimeError(f"Expected one OpenVINO XML model in {model_dir}")

        core = Core()
        model = core.read_model(xml_files[0])
        compile_config = {
            "PERFORMANCE_HINT": "LATENCY",
            "INFERENCE_NUM_THREADS": OPENVINO_INFERENCE_THREADS,
        }
        if OPENVINO_NUM_STREAMS is not None:
            compile_config["NUM_STREAMS"] = OPENVINO_NUM_STREAMS
        if OPENVINO_CPU_PINNING:
            compile_config["ENABLE_CPU_PINNING"] = "YES"
        if OPENVINO_DISABLE_HT:
            compile_config["ENABLE_HYPER_THREADING"] = "NO"
        self.compiled_model = core.compile_model(
            model,
            "CPU",
            compile_config,
        )
        self.input_port = self.compiled_model.input(0)
        self.output_port = self.compiled_model.output(0)
        expected_shape = [1, 3, YOLO_IMGSZ, YOLO_IMGSZ]
        if list(self.input_port.shape) != expected_shape:
            raise RuntimeError(
                f"OpenVINO model input must be batch=1 {expected_shape}; got {list(self.input_port.shape)}"
            )
        self.infer_request = self.compiled_model.create_infer_request()
        self.infer_lock = threading.Lock()
        self.runtime_timing = threading.local()

    @staticmethod
    def _preprocess(frame):
        height, width = frame.shape[:2]
        gain = min(YOLO_IMGSZ / height, YOLO_IMGSZ / width)
        resized_width = int(round(width * gain))
        resized_height = int(round(height * gain))
        resized = cv2.resize(frame, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
        pad_width = YOLO_IMGSZ - resized_width
        pad_height = YOLO_IMGSZ - resized_height
        padded = cv2.copyMakeBorder(
            resized,
            int(round(pad_height / 2 - 0.1)),
            int(round(pad_height / 2 + 0.1)),
            int(round(pad_width / 2 - 0.1)),
            int(round(pad_width / 2 + 0.1)),
            cv2.BORDER_CONSTANT,
            value=(114, 114, 114),
        )
        input_tensor = np.ascontiguousarray(
            padded.transpose(2, 0, 1)[::-1],
            dtype=np.float32,
        )[None] / 255.0
        return input_tensor, gain, (pad_width / 2, pad_height / 2)

    def predict(self, frame, request_id="n/a", source="default", collect_runtime_timing=False):
        collect_timing = VISION_RUNTIME_DEBUG or collect_runtime_timing
        total_started_at = time.perf_counter() if collect_timing else None
        preprocess_started_at = time.perf_counter() if collect_timing else None
        input_tensor, gain, pad = self._preprocess(frame)
        preprocess_ms = (time.perf_counter() - preprocess_started_at) * 1000 if collect_timing else 0.0
        # FastAPI can serve different camera requests concurrently; an
        # InferRequest itself is not safe to share across threads.
        lock_wait_started_at = time.perf_counter() if collect_timing else None
        with self.infer_lock:
            inference_started_at = time.perf_counter() if collect_timing else None
            raw_output = self.infer_request.infer({self.input_port: input_tensor})[self.output_port]
        openvino_infer_ms = (time.perf_counter() - inference_started_at) * 1000 if collect_timing else 0.0
        openvino_lock_wait_ms = (inference_started_at - lock_wait_started_at) * 1000 if collect_timing else 0.0
        postprocess_started_at = time.perf_counter() if collect_timing else None
        detections = non_max_suppression(
            torch.from_numpy(raw_output),
            conf_thres=CONFIDENCE_THRESHOLD,
            iou_thres=YOLO_NMS_IOU,
            max_det=YOLO_MAX_DETECTIONS,
        )[0]
        if len(detections) == 0:
            result = []
        else:
            boxes = detections[:, :4].clone()
            scale_boxes(
                (YOLO_IMGSZ, YOLO_IMGSZ),
                boxes,
                frame.shape[:2],
                ratio_pad=((gain, gain), pad),
            )
            result = [
                (tuple(box.tolist()), float(confidence))
                for box, confidence in zip(boxes, detections[:, 4])
            ]

        if collect_timing:
            timing = {
                "preprocess_ms": preprocess_ms,
                "openvino_infer_ms": openvino_infer_ms,
                "openvino_lock_wait_ms": openvino_lock_wait_ms,
                "postprocess_ms": (time.perf_counter() - postprocess_started_at) * 1000,
                "total_yolo_ms": (time.perf_counter() - total_started_at) * 1000,
            }
            self.runtime_timing.last = timing
            if VISION_RUNTIME_DEBUG:
                thread = threading.current_thread()
                process_threads = threading.active_count()
                process_cpu_percent = None
                process_memory_mb = None
                if _runtime_process is not None:
                    process_threads = _runtime_process.num_threads()
                    process_cpu_percent = _runtime_process.cpu_percent(interval=None)
                    process_memory_mb = _runtime_process.memory_info().rss / (1024 * 1024)
                logger.info(
                    "[Vision runtime] request_id=%s source=%s preprocess_ms=%.1f openvino_infer_ms=%.1f "
                    "openvino_lock_wait_ms=%.1f postprocess_ms=%.1f total_yolo_ms=%.1f pid=%s thread_id=%s thread_name=%s "
                    "process_threads=%s process_cpu_percent=%s process_memory_mb=%s",
                    request_id,
                    source,
                    timing["preprocess_ms"],
                    timing["openvino_infer_ms"],
                    timing["openvino_lock_wait_ms"],
                    timing["postprocess_ms"],
                    timing["total_yolo_ms"],
                    os.getpid(),
                    thread.ident,
                    thread.name,
                    process_threads,
                    f"{process_cpu_percent:.1f}" if process_cpu_percent is not None else "n/a",
                    f"{process_memory_mb:.1f}" if process_memory_mb is not None else "n/a",
                )
        return result


def _load_pytorch_detector():
    global yolo
    if yolo is None:
        print("Loading PyTorch YOLO...")
        yolo = YOLO(MODEL_PATH)
        print("PyTorch YOLO loaded.")
    return yolo


def _load_selected_detector():
    global _openvino_detector
    global _active_yolo_backend

    if YOLO_BACKEND == "openvino":
        try:
            print("Loading OpenVINO YOLO...")
            _openvino_detector = OpenVINOYOLODetector(OPENVINO_MODEL_DIR)
            _active_yolo_backend = "openvino"
            openvino_settings = [
                "CPU LATENCY",
                f"{OPENVINO_INFERENCE_THREADS} inference threads",
                f"CPU pinning={'enabled' if OPENVINO_CPU_PINNING else 'disabled'}",
                f"HT disabled={'yes' if OPENVINO_DISABLE_HT else 'no'}",
            ]
            if OPENVINO_NUM_STREAMS is not None:
                openvino_settings.append(f"NUM_STREAMS={OPENVINO_NUM_STREAMS}")
            print(
                "OpenVINO YOLO loaded ("
                + ", ".join(openvino_settings)
                + ")."
            )
            return
        except Exception as error:
            print(f"OpenVINO YOLO load failed; falling back to PyTorch: {error}")

    _load_pytorch_detector()
    _active_yolo_backend = "pytorch"


def detect_yolo_boxes(frame, request_id="n/a", source="default"):
    """Return current-model detections as (xyxy, confidence), with safe fallback."""
    global _active_yolo_backend

    if _active_yolo_backend == "openvino":
        try:
            return _openvino_detector.predict(frame, request_id=request_id, source=source)
        except Exception as error:
            print(f"OpenVINO YOLO inference failed; falling back to PyTorch: {error}")
            _load_pytorch_detector()
            _active_yolo_backend = "pytorch"

    options = {
        "source": frame,
        "conf": CONFIDENCE_THRESHOLD,
        "verbose": False,
        "imgsz": YOLO_IMGSZ,
    }
    if YOLO_DEVICE:
        options["device"] = YOLO_DEVICE
    results = yolo.predict(**options)
    return [
        (tuple(box.xyxy[0].tolist()), float(box.conf[0]))
        for result in results
        if result.boxes is not None
        for box in result.boxes
    ]


def get_openvino_runtime_timing():
    if _active_yolo_backend != "openvino":
        return None
    return getattr(_openvino_detector.runtime_timing, "last", None)


def warm_up_yolo_detector():
    warmup_frame = np.zeros((YOLO_IMGSZ, YOLO_IMGSZ, 3), dtype=np.uint8)
    detect_yolo_boxes(warmup_frame)
    detect_yolo_boxes(warmup_frame)


_load_selected_detector()


# ============================================================
# Load OCR
# ============================================================

def _load_paddle_ocr():
    print("Loading OCR recognition model...")
    # YOLO already isolates the plate, so use Paddle's recognition-only
    # predictor rather than loading and running a second text detector.
    recognizer = TextRecognition(
        model_name=OCR_RECOGNITION_MODEL,
        enable_mkldnn=True,
        cpu_threads=PADDLE_OCR_CPU_THREADS,
    )
    print(
        "OCR recognition model loaded "
        f"(MKL-DNN enabled, {PADDLE_OCR_CPU_THREADS} CPU threads)."
    )
    print("OCR backend: paddle")
    return recognizer


def _load_onnxruntime_ocr():
    if not (ONNX_OCR_MODEL_DIR / "inference.onnx").is_file():
        raise FileNotFoundError(f"ONNX OCR model missing: {ONNX_OCR_MODEL_DIR}")
    import onnxruntime  # Verify the optional production dependency explicitly.

    del onnxruntime
    print("Loading ONNX Runtime OCR recognition model...")
    recognizer = TextRecognition(
        model_name=OCR_RECOGNITION_MODEL,
        model_dir=str(ONNX_OCR_MODEL_DIR),
        device="cpu",
        engine="onnxruntime",
        engine_config={
            "providers": ["CPUExecutionProvider"],
            "intra_op_num_threads": ONNX_OCR_INTRA_THREADS,
            "inter_op_num_threads": 1,
            "execution_mode": "ORT_SEQUENTIAL",
        },
    )
    print(
        "OCR backend: onnxruntime "
        f"(CPU, {ONNX_OCR_INTRA_THREADS} intra-op threads, 1 inter-op thread, ORT_SEQUENTIAL)."
    )
    return recognizer


if OCR_BACKEND == "onnxruntime":
    try:
        ocr = _load_onnxruntime_ocr()
    except Exception as error:
        logger.warning(
            "ONNX Runtime OCR initialization failed; falling back to Paddle Static OCR: %s",
            error,
        )
        ocr = _load_paddle_ocr()
else:
    ocr = _load_paddle_ocr()


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
