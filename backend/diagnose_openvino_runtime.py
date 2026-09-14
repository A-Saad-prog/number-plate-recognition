"""Measure the already-loaded production OpenVINO YOLO path outside FastAPI.

Run with YOLO_BACKEND=openvino. This intentionally reuses the production
OpenVINOYOLODetector instance and its compiled model; it does not export,
compile, or configure a second model.
"""

from __future__ import annotations

import argparse
import statistics
from pathlib import Path

import cv2

from app.services import plate_recognition


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
TIMING_FIELDS = ("preprocess_ms", "openvino_infer_ms", "postprocess_ms", "total_yolo_ms")


def image_paths(source: Path) -> list[Path]:
    if source.is_file() and source.suffix.lower() in IMAGE_SUFFIXES:
        return [source]
    if source.is_dir():
        return sorted(path for path in source.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES)
    raise ValueError(f"Image file or directory not found: {source}")


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Camera-like image file or directory")
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--predictions", type=int, default=200)
    args = parser.parse_args()
    if args.warmup < 1 or args.predictions < 1:
        parser.error("--warmup and --predictions must be positive")
    if plate_recognition._active_yolo_backend != "openvino":
        parser.error("Set YOLO_BACKEND=openvino before starting this diagnostic.")

    try:
        paths = image_paths(args.source)
    except ValueError as error:
        parser.error(str(error))
    frames = []
    for path in paths:
        frame = cv2.imread(str(path))
        if frame is not None:
            frames.append((path, frame))
    if not frames:
        parser.error("No readable images found.")

    detector = plate_recognition._openvino_detector
    for index in range(args.warmup):
        path, frame = frames[index % len(frames)]
        detector.predict(frame, request_id=f"direct-warmup-{index}", source=path.name, collect_runtime_timing=True)

    samples = {field: [] for field in TIMING_FIELDS}
    for index in range(args.predictions):
        path, frame = frames[index % len(frames)]
        detector.predict(frame, request_id=f"direct-{index}", source=path.name, collect_runtime_timing=True)
        timing = plate_recognition.get_openvino_runtime_timing()
        for field in TIMING_FIELDS:
            samples[field].append(timing[field])

    print(f"Production OpenVINO direct diagnostic: {args.predictions} predictions, {args.warmup} warmups")
    for field in TIMING_FIELDS:
        values = samples[field]
        print(
            f"{field}: mean={statistics.fmean(values):.2f}ms "
            f"median={statistics.median(values):.2f}ms p90={percentile(values, 0.90):.2f}ms "
            f"p95={percentile(values, 0.95):.2f}ms p99={percentile(values, 0.99):.2f}ms "
            f"max={max(values):.2f}ms"
        )


if __name__ == "__main__":
    main()
