"""Create and benchmark a calibrated INT8 OpenVINO YOLO model without changing production.

Example (from backend):
  $env:YOLO_BACKEND="openvino"
  $env:OPENVINO_INFERENCE_THREADS="4"
  ./.venv/Scripts/python.exe benchmark_openvino_int8.py

Calibration images must be real images in ../dataset. The default evaluation
set is benchmark-images. The script always excludes benchmark-image names and,
when supplied, names found in a training subset. It uses a fixed seed and never
modifies the FP OpenVINO export.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import statistics
from dataclasses import dataclass
from pathlib import Path

import cv2


os.environ.setdefault("YOLO_BACKEND", "openvino")

from app.services import plate_recognition


BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
FP_MODEL_DIR = REPO_ROOT / "models" / "best_openvino_model"
INT8_MODEL_DIR = REPO_ROOT / "models" / "best_openvino_int8_model"
DEFAULT_CALIBRATION_SOURCE = REPO_ROOT / "dataset"
DEFAULT_BENCHMARK_SOURCE = BACKEND_DIR / "benchmark-images"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
IOU_MATCH_THRESHOLD = 0.50
TIMING_FIELDS = ("preprocess_ms", "openvino_infer_ms", "postprocess_ms", "total_yolo_ms")


@dataclass
class Prediction:
    image: Path
    boxes: list[tuple[float, float, float, float]]
    confidences: list[float]
    timings: dict[str, float]


def image_paths(path: Path) -> list[Path]:
    if not path.is_dir():
        raise ValueError(f"Image directory not found: {path}")
    return sorted(
        item for item in path.rglob("*")
        if item.is_file() and item.suffix.lower() in IMAGE_SUFFIXES
    )


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def print_timing_summary(name: str, records: list[Prediction]) -> None:
    print(f"\n{name} latency ({len(records)} predictions)")
    for field in TIMING_FIELDS:
        values = [record.timings[field] for record in records]
        print(
            f"  {field}: mean={statistics.fmean(values):.2f}ms "
            f"median={statistics.median(values):.2f}ms "
            f"p90={percentile(values, .90):.2f}ms p95={percentile(values, .95):.2f}ms "
            f"p99={percentile(values, .99):.2f}ms max={max(values):.2f}ms"
        )


def iou(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> float:
    left, top = max(first[0], second[0]), max(first[1], second[1])
    right, bottom = min(first[2], second[2]), min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union else 0.0


def match_boxes(fp: Prediction, int8: Prediction):
    candidates = sorted(
        (iou(fp_box, int8_box), fp_index, int8_index)
        for fp_index, fp_box in enumerate(fp.boxes)
        for int8_index, int8_box in enumerate(int8.boxes)
    )
    matched, used_fp, used_int8 = [], set(), set()
    for overlap, fp_index, int8_index in reversed(candidates):
        if overlap < IOU_MATCH_THRESHOLD or fp_index in used_fp or int8_index in used_int8:
            continue
        matched.append((fp_index, int8_index, overlap))
        used_fp.add(fp_index)
        used_int8.add(int8_index)
    return matched, set(range(len(fp.boxes))) - used_fp, set(range(len(int8.boxes))) - used_int8


def format_prediction(prediction: Prediction) -> str:
    boxes = ", ".join("(" + ", ".join(f"{value:.1f}" for value in box) + ")" for box in prediction.boxes)
    confidences = ", ".join(f"{value:.3f}" for value in prediction.confidences)
    return f"count: {len(prediction.boxes)}\nboxes: [{boxes}]\nconfidence: [{confidences}]"


def compare_quality(fp_records: list[Prediction], int8_records: list[Prediction]) -> None:
    identical_counts = different_counts = fp_only = int8_only = 0
    confidence_differences, matched_ious = [], []
    print("\nMeaningful detection mismatches:")
    for fp, int8 in zip(fp_records, int8_records):
        if len(fp.boxes) == len(int8.boxes):
            identical_counts += 1
        else:
            different_counts += 1
        fp_only += bool(fp.boxes and not int8.boxes)
        int8_only += bool(int8.boxes and not fp.boxes)
        matched, unmatched_fp, unmatched_int8 = match_boxes(fp, int8)
        matched_ious.extend(overlap for _, _, overlap in matched)
        confidence_differences.extend(
            abs(fp.confidences[fp_index] - int8.confidences[int8_index])
            for fp_index, int8_index, _ in matched
        )
        if len(fp.boxes) != len(int8.boxes) or unmatched_fp or unmatched_int8:
            print(f"\nIMAGE: {fp.image.name}\n\nFP OpenVINO:\n{format_prediction(fp)}")
            print(f"\nINT8 OpenVINO:\n{format_prediction(int8)}")
    print("\nDetection-quality summary:")
    print(f"  total FP detections: {sum(len(item.boxes) for item in fp_records)}")
    print(f"  total INT8 detections: {sum(len(item.boxes) for item in int8_records)}")
    print(f"  images with identical detection counts: {identical_counts}")
    print(f"  images with different detection counts: {different_counts}")
    print(f"  FP >=1 / INT8 0: {fp_only}")
    print(f"  INT8 >=1 / FP 0: {int8_only}")
    print(f"  average confidence difference: {statistics.fmean(confidence_differences) if confidence_differences else 0.0:.4f}")
    print(f"  average matched bbox IoU: {statistics.fmean(matched_ious) if matched_ious else 0.0:.4f}")


def selected_calibration_images(
    source: Path,
    training_source: Path | None,
    benchmark_source: Path,
    count: int,
    seed: int,
) -> list[Path]:
    candidates = image_paths(source)
    excluded_names = (
        {path.name for path in image_paths(training_source)}
        if training_source is not None and training_source.is_dir()
        else set()
    )
    excluded_names.update(path.name for path in image_paths(benchmark_source))
    held_out = [path for path in candidates if path.name not in excluded_names]
    if len(held_out) < count:
        raise ValueError(f"Need {count} held-out calibration images; only {len(held_out)} are available.")
    return random.Random(seed).sample(held_out, count)


def create_int8_model(calibration_images: list[Path], seed: int, recreate: bool) -> None:
    if INT8_MODEL_DIR.exists() and not recreate:
        print(f"Reusing existing INT8 model: {INT8_MODEL_DIR}")
        return
    try:
        import nncf
        import openvino as ov
    except ImportError as error:
        raise RuntimeError("INT8 calibration requires nncf==3.3.0 in backend/.venv") from error
    xml_files = list(FP_MODEL_DIR.glob("*.xml"))
    if len(xml_files) != 1:
        raise ValueError(f"Expected exactly one FP OpenVINO XML in {FP_MODEL_DIR}")
    frames = []
    for path in calibration_images:
        frame = cv2.imread(str(path))
        if frame is None:
            raise ValueError(f"Unreadable calibration image: {path}")
        frames.append(frame)
    fp_model = ov.Core().read_model(str(xml_files[0]))
    calibration_dataset = nncf.Dataset(
        frames,
        lambda frame: plate_recognition.OpenVINOYOLODetector._preprocess(frame)[0],
    )
    print(f"Quantizing with {len(frames)} real held-out calibration images...")
    int8_model = nncf.quantize(fp_model, calibration_dataset)
    INT8_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    ov.save_model(int8_model, INT8_MODEL_DIR / "best_openvino_int8.xml", compress_to_fp16=False)
    (INT8_MODEL_DIR / "calibration_manifest.json").write_text(json.dumps({
        "seed": seed,
        "count": len(calibration_images),
        "images": [str(path) for path in calibration_images],
    }, indent=2), encoding="utf-8")
    print(f"INT8 model saved: {INT8_MODEL_DIR}")


def predict(detector, image: Path) -> Prediction:
    frame = cv2.imread(str(image))
    if frame is None:
        raise ValueError(f"Unreadable benchmark image: {image}")
    detections = detector.predict(frame, request_id="int8-benchmark", source=image.name, collect_runtime_timing=True)
    timing = detector.runtime_timing.last
    return Prediction(
        image=image,
        boxes=[tuple(map(float, box)) for box, _ in detections],
        confidences=[float(confidence) for _, confidence in detections],
        timings={field: float(timing[field]) for field in TIMING_FIELDS},
    )


def benchmark(detector, images: list[Path], warmups: int, runs: int) -> list[Prediction]:
    for index in range(warmups):
        predict(detector, images[index % len(images)])
    return [predict(detector, image) for _ in range(runs) for image in images]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calibration-source", type=Path, default=DEFAULT_CALIBRATION_SOURCE)
    parser.add_argument(
        "--training-source",
        type=Path,
        help="Optional prior-training image directory to exclude from calibration",
    )
    parser.add_argument("--benchmark-images", type=Path, default=DEFAULT_BENCHMARK_SOURCE)
    parser.add_argument("--calibration-count", type=int, default=300)
    parser.add_argument("--seed", type=int, default=20260913)
    parser.add_argument("--warmups", type=int, default=10)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--recreate-int8", action="store_true")
    args = parser.parse_args()
    if args.calibration_count < 1 or args.warmups < 10 or args.runs < 1:
        parser.error("--calibration-count and --runs must be positive; --warmups must be at least 10")
    if plate_recognition._active_yolo_backend != "openvino":
        parser.error("Set YOLO_BACKEND=openvino; this benchmark must use the production OpenVINO configuration.")
    if args.training_source is None:
        print(
            "WARNING: Training subset is unavailable, so calibration images may overlap "
            "with images previously used during YOLO training."
        )
    calibration_images = selected_calibration_images(
        args.calibration_source, args.training_source, args.benchmark_images,
        args.calibration_count, args.seed,
    )
    benchmark_images = image_paths(args.benchmark_images)
    print(f"Calibration images: {len(calibration_images)} (seed={args.seed})")
    print(f"Benchmark images: {len(benchmark_images)}")
    create_int8_model(calibration_images, args.seed, args.recreate_int8)
    fp_detector = plate_recognition._openvino_detector
    int8_detector = plate_recognition.OpenVINOYOLODetector(INT8_MODEL_DIR)
    fp_records = benchmark(fp_detector, benchmark_images, args.warmups, args.runs)
    int8_records = benchmark(int8_detector, benchmark_images, args.warmups, args.runs)
    print_timing_summary("FP OpenVINO", fp_records)
    print_timing_summary("INT8 OpenVINO", int8_records)
    compare_quality(fp_records[:len(benchmark_images)], int8_records[:len(benchmark_images)])


if __name__ == "__main__":
    main()
