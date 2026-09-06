import os
import re
import time
import threading
from datetime import datetime
from uuid import uuid4

import cv2
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

CONFIDENCE_THRESHOLD = 0.30
YOLO_IMGSZ = int(os.getenv("YOLO_IMGSZ", "640"))
YOLO_DEVICE = os.getenv("YOLO_DEVICE") or None

OCR_RECOGNITION_MODEL = os.getenv(
    "OCR_RECOGNITION_MODEL", "en_PP-OCRv5_mobile_rec"
)


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
