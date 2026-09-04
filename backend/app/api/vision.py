import base64
import logging
import os
import re
import time
from collections import defaultdict, deque

import cv2
import numpy as np

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.plate_formats import classify_plate

from app.services.plate_recognition import (
    CONFIDENCE_THRESHOLD,
    YOLO_DEVICE,
    YOLO_IMGSZ,
    ocr,
    update_fps,
    yolo,
    _upload_accepted_frame_in_background,
)

logger = logging.getLogger(__name__)
VISION_DEBUG = os.getenv("VISION_DEBUG", "").lower() in {"1", "true", "yes"}

router = APIRouter(
    prefix="/vision",
    tags=["Vision"],
)


# ============================================================
# Request Models
# ============================================================


class PlateDetectionRequest(BaseModel):
    image: str
    source: str | None = None
    request_id: str | None = None


# ============================================================
# Plate Detection
# ============================================================


@router.post("/detect-plate")
def detect_license_plate(
    request: PlateDetectionRequest,
):
    try:

        started_at = time.perf_counter()

        if VISION_DEBUG:
            logger.info(
                "[Vision BE req] id=%s source=%s received",
                request.request_id or "n/a",
                request.source or "default",
            )

        result = _process_plate_frame(request)

        if VISION_DEBUG:
            logger.info(
                "[Vision BE] id=%s source=%s total_ms=%.1f detected=%s accepted=%s",
                request.request_id or "n/a",
                request.source or "default",
                (time.perf_counter() - started_at) * 1000,
                result.get("detected"),
                bool(result.get("license_plate")),
            )

        return {
            "success": True,
            **result,
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception:
        logger.exception("Vision processing error")

        raise HTTPException(
            status_code=500,
            detail="Plate recognition failed.",
        )


# ============================================================
# Production plate-processing helpers
# ============================================================


def _decode_image(image_data):
    image_string = image_data.split(",", 1)[1] if "," in image_data else image_data

    image_bytes = base64.b64decode(image_string)

    image_array = np.frombuffer(
        image_bytes,
        dtype=np.uint8,
    )

    frame = cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR,
    )

    if frame is None:
        raise ValueError("Unable to decode camera frame.")

    return frame


def _best_box(frame):
    options = {
        "source": frame,
        "conf": CONFIDENCE_THRESHOLD,
        "verbose": False,
        "imgsz": YOLO_IMGSZ,
    }

    if YOLO_DEVICE:
        options["device"] = YOLO_DEVICE

    results = yolo.predict(**options)

    best_box = None
    best_confidence = -1.0

    for result in results:

        if result.boxes is None:
            continue

        for box in result.boxes:

            confidence = float(box.conf[0])

            if confidence <= best_confidence:
                continue

            x1, y1, x2, y2 = map(
                int,
                box.xyxy[0].tolist(),
            )

            best_box = (
                x1,
                y1,
                x2,
                y2,
            )

            best_confidence = confidence

    return (
        best_box,
        best_confidence,
    )


def _exact_crop(
    frame,
    box,
):
    frame_height, frame_width = frame.shape[:2]

    x1, y1, x2, y2 = box

    box_width = max(
        1,
        x2 - x1,
    )

    box_height = max(
        1,
        y2 - y1,
    )

    pad_x = int(box_width * 0.04)

    pad_y = int(box_height * 0.06)

    x1 = max(
        0,
        x1 - pad_x,
    )

    y1 = max(
        0,
        y1 - pad_y,
    )

    x2 = min(
        frame_width,
        x2 + pad_x,
    )

    y2 = min(
        frame_height,
        y2 + pad_y,
    )

    crop = frame[
        y1:y2,
        x1:x2,
    ]

    return crop, {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
    }


def _order_quad(points):
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)

    return np.array(
        [
            points[np.argmin(sums)],
            points[np.argmin(diffs)],
            points[np.argmax(sums)],
            points[np.argmax(diffs)],
        ],
        dtype=np.float32,
    )


# SAFE_RECTIFICATION_V3
def _rectify_plate(crop):
    if crop is None or crop.size == 0:
        return crop, {"rectified": False, "reason": "empty_crop"}

    height, width = crop.shape[:2]

    if width < 60 or height < 28:
        return crop, {"rectified": False, "reason": "crop_too_small"}

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 60, 170)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(
        edges,
        cv2.RETR_LIST,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    crop_area = float(width * height)
    crop_diag = max((width * width + height * height) ** 0.5, 1.0)
    candidates = []

    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue

        polygon = cv2.approxPolyDP(contour, 0.025 * perimeter, True)

        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue

        quad = polygon.reshape(4, 2).astype(np.float32)
        area_ratio = abs(float(cv2.contourArea(quad))) / crop_area

        # V2 accepted internal contours too easily.
        if not 0.48 <= area_ratio <= 0.95:
            continue

        ordered = _order_quad(quad)
        tl, tr, br, bl = ordered

        top_width = float(np.linalg.norm(tr - tl))
        bottom_width = float(np.linalg.norm(br - bl))
        left_height = float(np.linalg.norm(bl - tl))
        right_height = float(np.linalg.norm(br - tr))

        target_width = max(top_width, bottom_width)
        target_height = max(left_height, right_height)

        if target_width < 55 or target_height < 24:
            continue

        aspect_ratio = target_width / max(target_height, 1.0)

        if not 1.65 <= aspect_ratio <= 6.5:
            continue

        width_skew = abs(top_width - bottom_width) / max(target_width, 1.0)
        height_skew = abs(left_height - right_height) / max(target_height, 1.0)

        if width_skew > 0.38 or height_skew > 0.38:
            continue

        left_edge = min(tl[0], bl[0])
        right_edge = max(tr[0], br[0])
        top_edge = min(tl[1], tr[1])
        bottom_edge = max(bl[1], br[1])

        left_gap = max(0.0, float(left_edge)) / width
        right_gap = max(0.0, float(width - 1 - right_edge)) / width
        top_gap = max(0.0, float(top_edge)) / height
        bottom_gap = max(0.0, float(height - 1 - bottom_edge)) / height

        # Outer-border safety: reject likely internal rectangles.
        if left_gap > 0.16 or right_gap > 0.16:
            continue
        if top_gap > 0.24 or bottom_gap > 0.24:
            continue

        quad_center = ordered.mean(axis=0)
        crop_center = np.array([width / 2.0, height / 2.0], dtype=np.float32)
        center_offset = float(np.linalg.norm(quad_center - crop_center)) / crop_diag

        if center_offset > 0.12:
            continue

        output_area_ratio = (target_width * target_height) / crop_area
        if output_area_ratio < 0.42:
            continue

        gap_total = left_gap + right_gap + top_gap + bottom_gap

        candidates.append(
            (
                area_ratio,
                -center_offset,
                -gap_total,
                ordered,
                target_width,
                target_height,
                {
                    "left_gap": round(left_gap, 3),
                    "right_gap": round(right_gap, 3),
                    "top_gap": round(top_gap, 3),
                    "bottom_gap": round(bottom_gap, 3),
                    "center_offset": round(center_offset, 3),
                },
            )
        )

    if not candidates:
        return crop, {
            "rectified": False,
            "reason": "no_safe_outer_quad",
        }

    candidates.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)

    area_ratio, _, _, ordered, target_width, target_height, geometry = candidates[0]
    tl, tr, br, bl = ordered

    top_angle = abs(float(np.degrees(np.arctan2(tr[1] - tl[1], tr[0] - tl[0]))))
    bottom_angle = abs(float(np.degrees(np.arctan2(br[1] - bl[1], br[0] - bl[0]))))

    top_angle = min(top_angle, abs(180.0 - top_angle))
    bottom_angle = min(bottom_angle, abs(180.0 - bottom_angle))

    perspective_strength = max(
        abs(top_width - bottom_width) / max(target_width, 1.0),
        abs(left_height - right_height) / max(target_height, 1.0),
    )

    if top_angle < 2.5 and bottom_angle < 2.5 and perspective_strength < 0.06:
        return crop, {
            "rectified": False,
            "reason": "already_straight",
            "area_ratio": round(area_ratio, 4),
            **geometry,
        }

    if top_angle > 22.0 or bottom_angle > 22.0 or perspective_strength > 0.32:
        return crop, {
            "rectified": False,
            "reason": "warp_too_aggressive",
            "area_ratio": round(area_ratio, 4),
            **geometry,
        }

    output_width = int(round(target_width))
    output_height = int(round(target_height))

    if output_width < int(width * 0.68) or output_height < int(height * 0.48):
        return crop, {
            "rectified": False,
            "reason": "warp_loses_too_much_crop",
            "area_ratio": round(area_ratio, 4),
            **geometry,
        }

    destination = np.array(
        [
            [0, 0],
            [output_width - 1, 0],
            [output_width - 1, output_height - 1],
            [0, output_height - 1],
        ],
        dtype=np.float32,
    )

    matrix = cv2.getPerspectiveTransform(ordered, destination)

    rectified = cv2.warpPerspective(
        crop,
        matrix,
        (output_width, output_height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )

    if rectified is None or rectified.size == 0:
        return crop, {"rectified": False, "reason": "bad_warp_output"}

    return rectified, {
        "rectified": True,
        "reason": "safe_outer_quad_warp",
        "area_ratio": round(area_ratio, 4),
        "input_size": [width, height],
        "output_size": [output_width, output_height],
        "top_angle": round(top_angle, 2),
        "bottom_angle": round(bottom_angle, 2),
        "perspective_strength": round(perspective_strength, 3),
        **geometry,
    }


# CUSTOM_NUMERIC_CANDIDATE_V2
def _custom_numeric_candidate(raw_text, raw_confidence):
    """Return a high-confidence, 1-4 digit custom registration."""
    if raw_text is None:
        return None

    cleaned = re.sub(r"[\s\-]+", "", str(raw_text)).upper()

    if not re.fullmatch(r"\d{1,4}", cleaned):
        return None

    try:
        confidence = float(raw_confidence or 0)
    except (TypeError, ValueError):
        return None

    # Prevent noisy tiny OCR fragments from entering temporal voting.
    if confidence < 0.80:
        return None

    return cleaned


# GENERIC_TWO_LINE_PLATE_V2
def _prepare_two_line_plate(crop):
    # Format-agnostic.
    # Detect a clear two-row layout, rearrange top+bottom side-by-side,
    # then use the SAME single OCR pass. classify_plate() still validates format.
    if crop is None or crop.size == 0:
        return crop, {"rearranged": False, "reason": "empty_crop"}

    height, width = crop.shape[:2]
    aspect_ratio = width / max(height, 1)

    if aspect_ratio >= 1.80:
        return crop, {
            "rearranged": False,
            "reason": "wide_single_line",
            "aspect_ratio": round(aspect_ratio, 3),
        }

    if height < 42 or width < 40:
        return crop, {
            "rearranged": False,
            "reason": "too_small",
            "aspect_ratio": round(aspect_ratio, 3),
        }

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        21,
        9,
    )

    row_ink = np.count_nonzero(binary, axis=1).astype(np.float32)
    search_start = max(2, int(height * 0.28))
    search_end = min(height - 2, int(height * 0.72))

    if search_end <= search_start:
        return crop, {
            "rearranged": False,
            "reason": "invalid_gap_search",
            "aspect_ratio": round(aspect_ratio, 3),
        }

    middle = row_ink[search_start:search_end]
    split_y = search_start + int(np.argmin(middle))
    local_peak = max(float(np.max(row_ink)), 1.0)
    gap_strength = float(row_ink[split_y]) / local_peak

    if gap_strength > 0.34:
        return crop, {
            "rearranged": False,
            "reason": "no_clear_two_line_gap",
            "aspect_ratio": round(aspect_ratio, 3),
            "split_y": int(split_y),
            "gap_strength": round(gap_strength, 3),
        }

    margin = max(1, int(height * 0.025))
    top = crop[: max(split_y - margin, 1), :]
    bottom = crop[min(split_y + margin, height - 1) :, :]

    if top.size == 0 or bottom.size == 0 or top.shape[0] < 12 or bottom.shape[0] < 12:
        return crop, {
            "rearranged": False,
            "reason": "bad_two_line_split",
            "aspect_ratio": round(aspect_ratio, 3),
            "split_y": int(split_y),
        }

    def _trim_registration_row(line):
        row_gray = cv2.cvtColor(line, cv2.COLOR_BGR2GRAY)
        row_mask = cv2.adaptiveThreshold(
            row_gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            21,
            9,
        )
        ys, xs = np.where(row_mask > 0)
        if len(xs) == 0 or len(ys) == 0:
            return line
        x1 = max(int(xs.min()) - 3, 0)
        x2 = min(int(xs.max()) + 4, line.shape[1])
        y1 = max(int(ys.min()) - 3, 0)
        y2 = min(int(ys.max()) + 4, line.shape[0])
        trimmed = line[y1:y2, x1:x2]
        return trimmed if trimmed.size else line

    top = _trim_registration_row(top)
    bottom = _trim_registration_row(bottom)

    if top.shape[1] < 8 or bottom.shape[1] < 8:
        return crop, {
            "rearranged": False,
            "reason": "empty_registration_row",
            "aspect_ratio": round(aspect_ratio, 3),
        }

    target_h = max(top.shape[0], bottom.shape[0], 24)

    def _resize_row(line):
        scale = target_h / max(line.shape[0], 1)
        target_w = max(1, int(round(line.shape[1] * scale)))
        return cv2.resize(line, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

    top = _resize_row(top)
    bottom = _resize_row(bottom)
    separator_w = max(6, int(target_h * 0.22))
    separator = np.full((target_h, separator_w, 3), 255, dtype=np.uint8)

    # Layout examples only: AB-/123, TAB-/123, ABC-/1234, etc.
    combined = np.hstack([top, separator, bottom])
    combined_ratio = combined.shape[1] / max(combined.shape[0], 1)

    if combined_ratio < 1.85:
        return crop, {
            "rearranged": False,
            "reason": "combined_not_ocr_line_like",
            "aspect_ratio": round(aspect_ratio, 3),
            "combined_ratio": round(combined_ratio, 3),
        }

    return combined, {
        "rearranged": True,
        "reason": "generic_two_line_to_single_line",
        "aspect_ratio": round(aspect_ratio, 3),
        "split_y": int(split_y),
        "gap_strength": round(gap_strength, 3),
        "input_size": [width, height],
        "output_size": [int(combined.shape[1]), int(combined.shape[0])],
    }


def _raw_ocr(crop):
    raw_parts = []
    raw_scores = []

    try:

        results = ocr.predict(crop)

        for result in results:

            texts = result.get(
                "rec_text",
                [],
            )

            scores = result.get(
                "rec_score",
                [],
            )

            if not isinstance(
                texts,
                (list, tuple, np.ndarray),
            ):
                texts = [texts]

            if not isinstance(
                scores,
                (list, tuple, np.ndarray),
            ):
                scores = [scores]

            for text, score in zip(
                texts,
                scores,
            ):

                text = str(text).strip()

                score = float(score)

                if text:
                    raw_parts.append(text)

                    raw_scores.append(score)

    except Exception as error:
        logger.exception(
            "Plate OCR failed: %s",
            error,
        )

    return (
        "\n".join(raw_parts),
        max(
            raw_scores,
            default=0.0,
        ),
    )


_BOX_HISTORY = defaultdict(lambda: deque(maxlen=3))


def _stabilize_box(box, source):
    source_key = source or "default"
    history = _BOX_HISTORY[source_key]
    history.append(tuple(int(round(v)) for v in box))

    if len(history) == 1:
        return history[0]

    return (
        min(item[0] for item in history),
        min(item[1] for item in history),
        max(item[2] for item in history),
        max(item[3] for item in history),
    )


def _reset_box_history(source):
    _BOX_HISTORY.pop(source or "default", None)


def _process_plate_frame(
    request: PlateDetectionRequest,
):
    started_at = time.perf_counter()

    try:

        frame = _decode_image(request.image)
        fps = update_fps()

        box, yolo_confidence = _best_box(frame)

        if box is None:
            _reset_box_history(request.source)

            logger.info(
                "[Vision] id=%s source=%s detected=False total=%.1fms",
                request.request_id or "n/a",
                request.source or "default",
                (time.perf_counter() - started_at) * 1000,
            )

            return {
                "detected": False,
                "license_plate": None,
                "plate_metadata": None,
                "plate_image": None,
                "confidence": 0.0,
                "raw_ocr": "",
                "raw_ocr_confidence": 0.0,
                "box": None,
                "fps": fps,
            }

        stabilized_box = _stabilize_box(
            box,
            request.source,
        )

        crop, response_box = _exact_crop(
            frame,
            stabilized_box,
        )

        if crop.size == 0:
            raise ValueError("Detected plate crop is empty.")

        # ============================================
        # ONE OCR PASS ONLY
        # ============================================

        ocr_crop, rectification = _rectify_plate(crop)

        logger.info(
            "[Vision rectify V3] source=%s rectified=%s reason=%s area_ratio=%s input=%s output=%s",
            request.source or "default",
            rectification.get("rectified"),
            rectification.get("reason"),
            rectification.get("area_ratio"),
            rectification.get("input_size"),
            rectification.get("output_size"),
        )

        ocr_input, line_layout = _prepare_two_line_plate(ocr_crop)

        logger.info(
            "[Vision layout V2] source=%s rearranged=%s reason=%s aspect=%s split=%s gap=%s input=%s output=%s",
            request.source or "default",
            line_layout.get("rearranged"),
            line_layout.get("reason"),
            line_layout.get("aspect_ratio"),
            line_layout.get("split_y"),
            line_layout.get("gap_strength"),
            line_layout.get("input_size"),
            line_layout.get("output_size"),
        )

        raw_text, raw_confidence = _raw_ocr(ocr_input)

        # Parser works directly on the OCR result.
        # We DO NOT call read_plate() again.
        parsed = (
            classify_plate(
                raw_text,
                raw_confidence,
            )
            if raw_text
            else None
        )

        plate = parsed.get("plate") if parsed else None

        # CUSTOM_NUMERIC_CANDIDATE_V2
        # If normal Pakistani parsing rejects a clean 1-3 digit OCR result,
        # allow it into temporal confirmation as a premium/custom candidate.
        if plate is None:
            plate = _custom_numeric_candidate(
                raw_text,
                raw_confidence,
            )

        # OCR quality gate.
        # Decorative province/city text can produce low-confidence,
        # valid-looking false candidates. Keep high-confidence embedded
        # registrations (e.g. FB1234PESHAWAR -> FB-1234), but stop weak
        # mixed OCR from entering frontend temporal voting.
        is_custom_numeric_plate = bool(plate and re.fullmatch(r"\d{1,4}", str(plate)))

        if plate and not is_custom_numeric_plate and float(raw_confidence or 0) < 0.60:
            logger.info(
                "[Vision quality gate] source=%s raw=%r conf=%.4f rejected_plate=%s reason=low_ocr_confidence",
                request.source or "default",
                raw_text,
                float(raw_confidence or 0),
                plate,
            )
            plate = None

        plate_metadata = parsed if plate and parsed else None
        if plate and plate_metadata is None:
            plate_metadata = {"plate": plate, "confidence": float(raw_confidence)}
        if plate_metadata:
            _upload_accepted_frame_in_background(frame.copy(), plate_metadata)

        accepted_confidence = (
            float(
                parsed.get(
                    "confidence",
                    raw_confidence,
                )
            )
            if parsed
            else float(raw_confidence or 0.0) if plate else 0.0
        )

        logger.info(
            "[Vision] id=%s source=%s yolo=%.2f raw=%r raw_conf=%.2f plate=%s accepted_conf=%.2f total=%.1fms",
            request.request_id or "n/a",
            request.source or "default",
            yolo_confidence,
            raw_text,
            raw_confidence,
            plate or "NONE",
            accepted_confidence,
            (time.perf_counter() - started_at) * 1000,
        )

        return {
            "detected": True,
            "license_plate": plate,
            "plate_metadata": plate_metadata,
            "plate_image": None,
            "confidence": accepted_confidence,
            "raw_ocr": raw_text,
            "raw_ocr_confidence": raw_confidence,
            "yolo_confidence": yolo_confidence,
            "box": response_box,
            "fps": fps,
        }

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception:
        logger.exception("Vision processing failed")

        raise HTTPException(
            status_code=500,
            detail="Plate recognition failed.",
        )
