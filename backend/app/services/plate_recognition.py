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

PLATE_FORMATS = {
    "AJK": {
        "car": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "motorcycle": [("AABB000", r"^[A-Z]{4}[0-9]{3}$")],
        "public_transport": [("AABB000", r"^[A-Z]{4}[0-9]{3}$")],
        "government": [("AABB000", r"^[A-Z]{4}[0-9]{3}$")],
    },
    "Balochistan": {
        "car": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "motorcycle": [("AA0000", r"^[A-Z]{2}[0-9]{4}$")],
        "public_transport": [("AA0000", r"^[A-Z]{2}[0-9]{4}$")],
        "government": [("AAAA000", r"^[A-Z]{4}[0-9]{3}$")],
    },
    "Gilgit-Baltistan": {
        "car": [("AAA00", r"^[A-Z]{3}[0-9]{2}$")],
    },
    "Islamabad": {
        "car": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "motorcycle": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "government": [("alphanumeric", r"^[A-Z0-9]+$")],
    },
    "Khyber Pakhtunkhwa": {
        "car": [("AA9999", r"^[A-Z]{2}[0-9]{4}$")],
        "motorcycle": [("AA000", r"^[A-Z]{2}[0-9]{3}$")],
        "public_transport": [("AA000", r"^[A-Z]{2}[0-9]{3}$")],
        "government": [("AA000", r"^[A-Z]{2}[0-9]{3}$")],
    },
    "Punjab": {
        "car": [
            ("AA999", r"^[A-Z]{2}[0-9]{3}$"),
            ("A9999", r"^[A-Z][0-9]{4}$"),
        ],
        "motorcycle": [("AA/AAA0000", r"^[A-Z]{2,3}[0-9]{4}$")],
        "public_transport": [("AAA000", r"^[A-Z]{3}[0-9]{3}$")],
        "government": [("alphanumeric", r"^[A-Z0-9]+$")],
    },
    "Sindh": {
        "car": [("AAA000", r"^[A-Z]{3}[0-9]{3}$")],
        "motorcycle": [("AAA0000", r"^[A-Z]{3}[0-9]{4}$")],
        "public_transport": [("AA0000", r"^[A-Z]{2}[0-9]{4}$")],
        "government": [("AA000", r"^[A-Z]{2}[0-9]{3}$")],
    },
}

GENERIC_PLATE_FORMATS = [
    ("AA999", r"^[A-Z]{2}[0-9]{3}$"),
    ("AA9999", r"^[A-Z]{2}[0-9]{4}$"),
    ("AAA00", r"^[A-Z]{3}[0-9]{2}$"),
    ("AAA000", r"^[A-Z]{3}[0-9]{3}$"),
    ("AAA0000", r"^[A-Z]{3}[0-9]{4}$"),
    ("AABB000", r"^[A-Z]{4}[0-9]{3}$"),
    ("A9999", r"^[A-Z][0-9]{4}$"),
    ("AA/AAA0000", r"^[A-Z]{2,3}[0-9]{4}$"),
]

PLATE_PROVINCES = {
    "AJK": "AJK",
    "AJ&K": "AJK",
    "BALOCHISTAN": "Balochistan",
    "GILGITBALTISTAN": "Gilgit-Baltistan",
    "GB": "Gilgit-Baltistan",
    "ISLAMABAD": "Islamabad",
    "ICT": "Islamabad",
    "PUNJAB": "Punjab",
    "SINDH": "Sindh",
    "KP": "Khyber Pakhtunkhwa",
    "KPK": "Khyber Pakhtunkhwa",
    "KHYBERPAKHTUNKHWA": "Khyber Pakhtunkhwa",
}

PLATE_LABELS = set(PLATE_PROVINCES) | {
    "PARKING",
    "POLICE",
    "GOVERNMENT",
    "DEPARTMENT",
    "EXCISE",
    "ETNC",
    "TRANSPORT",
    "MOTOR",
    "VEHICLE",
    "REGISTRATION",
    "LAHORE",
    "KARACHI",
    "RAWALPINDI",
    "FAISALABAD",
    "MULTAN",
    "GUJRANWALA",
    "SIALKOT",
    "HYDERABAD",
    "SUKKUR",
    "QUETTA",
    "PESHAWAR",
    "ABBOTTABAD",
    "GILGIT",
    "MUZAFFARABAD",
    "SKARDU",
    "CHITRAL",
    "BAHAWALPUR",
}

OCR_CONFUSIONS = {"O": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2", "G": "6"}


def _plate_province(raw_text):
    compact_text = re.sub(r"[\s\-./]+", "", raw_text.upper())
    for label, province in sorted(
        PLATE_PROVINCES.items(), key=lambda item: -len(item[0])
    ):
        if re.sub(r"[\s\-./]+", "", label) in compact_text:
            return province
    return None


def _plate_tokens(raw_text):
    tokens = re.findall(r"[A-Z0-9]+", raw_text.upper())
    return [token for token in tokens if token not in PLATE_LABELS]


def _correct_for_format(value, format_name):
    template = re.sub(r"[^A-Z0-9]", "", format_name)
    if len(value) != len(template):
        return value

    corrected = []
    for character, expected in zip(value, template):
        if expected == "0" and character in OCR_CONFUSIONS:
            character = OCR_CONFUSIONS[character]
        elif expected == "A":
            reverse = {digit: letter for letter, digit in OCR_CONFUSIONS.items()}
            character = reverse.get(character, character)
        corrected.append(character)
    return "".join(corrected)


def _display_plate(value):
    """Add the visual separator between the letter and number sections."""
    match = re.fullmatch(r"([A-Z]+)([0-9]+)", value)
    return f"{match.group(1)}-{match.group(2)}" if match else value


def classify_plate(text: str, confidence: float = 0.0) -> dict | None:
    """Normalize OCR text and match the supplied Pakistani plate formats."""
    raw_text = text or ""
    province = _plate_province(raw_text)
    tokens = _plate_tokens(raw_text)
    candidates = list(dict.fromkeys(tokens + (["".join(tokens)] if tokens else [])))
    options = (
        [item for values in PLATE_FORMATS[province].values() for item in values]
        if province
        else GENERIC_PLATE_FORMATS
    )

    for candidate in candidates:
        for format_name, pattern in options:
            normalized = _correct_for_format(
                re.sub(r"[\s\-./]+", "", candidate), format_name
            )
            if re.fullmatch(pattern, normalized):
                display_plate = _display_plate(normalized)
                matching_types = [
                    vehicle_type
                    for vehicle_type, formats in PLATE_FORMATS.get(province, {}).items()
                    if any(
                        name == format_name and re.fullmatch(regex, normalized)
                        for name, regex in formats
                    )
                ]
                return {
                    "raw_text": raw_text,
                    "plate": display_plate,
                    "province": province or "unknown",
                    "vehicle_type": (
                        matching_types[0] if len(matching_types) == 1 else "unknown"
                    ),
                    "format": format_name,
                    "confidence": round(max(0.0, min(1.0, float(confidence))), 4),
                }
    return None


def is_valid_plate(text: str) -> bool:
    return classify_plate(text, 1.0) is not None


# ============================================================
# Normalize Plate
# ============================================================


def normalize_plate(text: str) -> str:
    result = classify_plate(text, 1.0)
    return result["plate"] if result else ""


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

        result = classify_plate("\n".join(texts), max(scores))

        if result is None:

            print(f"OCR rejected: {' '.join(texts)}")

            return None

        print(f"OCR: {result['plate']} (confidence: {result['confidence']:.2f})")

        return result

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
    plate_metadata = None

    if ocr_results:

        counts = Counter(result["plate"] for result in ocr_results)

        recognized_plate = counts.most_common(1)[0][0]
        plate_metadata = next(
            result for result in ocr_results if result["plate"] == recognized_plate
        )

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
        "plate_metadata": plate_metadata,
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
