"""Benchmark the production YOLO checkpoint against its OpenVINO export.

This script is deliberately standalone: it does not import or modify the live
vision service. By default it looks for representative image assets in the
repository; pass an image or directory when none are present.

Examples:
    .\\.venv\\Scripts\\python.exe benchmark_yolo_openvino.py ..\\images
    .\\.venv\\Scripts\\python.exe benchmark_yolo_openvino.py plate.jpg --runs 20
"""

from __future__ import annotations

import argparse
import statistics
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

try:
    from openvino import Core
except ImportError:  # Compatibility with older OpenVINO Python packages.
    from openvino.runtime import Core


REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = REPO_ROOT / "models" / "best.pt"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
IMGSZ = 640
CONFIDENCE = 0.30  # Matches backend/app/services/plate_recognition.py.
MATERIAL_IOU = 0.50
FIXED_WIDTH = 1280
FIXED_HEIGHT = 720


def image_paths(source: Path | None) -> list[Path]:
    if source:
        if source.is_file():
            if source.suffix.lower() not in IMAGE_SUFFIXES:
                raise ValueError(f"Unsupported image type: {source}")
            return [source]
        if source.is_dir():
            return sorted(
                path for path in source.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
            )
        raise ValueError(f"Image source does not exist: {source}")

    likely_asset_dirs = ("assets", "test_assets", "tests", "test_images", "images", "samples")
    paths = []
    for directory in likely_asset_dirs:
        candidate = REPO_ROOT / directory
        if candidate.is_dir():
            paths.extend(image_paths(candidate))
    return sorted(set(paths))


def percentile(values: list[float], fraction: float) -> float:
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def run_prediction(model: YOLO, source: str | np.ndarray):
    return model.predict(source=source, imgsz=IMGSZ, conf=CONFIDENCE, batch=1, verbose=False)


@dataclass
class Prediction:
    image: Path
    run: int
    width: int
    height: int
    wall_ms: float
    inference_ms: float
    boxes: list[tuple[float, float, float, float]]
    confidences: list[float]


def predict_once(model: YOLO, image: Path, run: int) -> Prediction:
    started_at = time.perf_counter()
    result = run_prediction(model, image)[0]
    wall_ms = (time.perf_counter() - started_at) * 1000
    boxes = result.boxes
    xyxy = [] if boxes is None else [tuple(map(float, box)) for box in boxes.xyxy.cpu().tolist()]
    confidences = [] if boxes is None else [float(value) for value in boxes.conf.cpu().tolist()]
    height, width = result.orig_shape
    return Prediction(
        image=image,
        run=run,
        width=int(width),
        height=int(height),
        wall_ms=wall_ms,
        inference_ms=float(result.speed.get("inference", 0.0)),
        boxes=xyxy,
        confidences=confidences,
    )


def letterbox_camera_frame(image: np.ndarray) -> np.ndarray:
    """Fit an image into a 1280x720 camera frame without distortion."""
    height, width = image.shape[:2]
    scale = min(FIXED_WIDTH / width, FIXED_HEIGHT / height)
    resized_width = max(1, round(width * scale))
    resized_height = max(1, round(height * scale))
    resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
    pad_x = FIXED_WIDTH - resized_width
    pad_y = FIXED_HEIGHT - resized_height
    return cv2.copyMakeBorder(
        resized,
        pad_y // 2,
        pad_y - pad_y // 2,
        pad_x // 2,
        pad_x - pad_x // 2,
        cv2.BORDER_CONSTANT,
        value=(114, 114, 114),
    )


def fixed_camera_inputs(images: list[Path]) -> list[tuple[Path, np.ndarray]]:
    frames = []
    for image_path in images:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Unable to read benchmark image: {image_path}")
        frames.append((image_path, letterbox_camera_frame(image)))
    return frames


def letterbox_to_model_input(frame: np.ndarray) -> np.ndarray:
    """Match Ultralytics' 640-square letterbox preprocessing for direct OV runs."""
    height, width = frame.shape[:2]
    scale = min(IMGSZ / height, IMGSZ / width)
    resized_width = round(width * scale)
    resized_height = round(height * scale)
    resized = cv2.resize(frame, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
    pad_x = IMGSZ - resized_width
    pad_y = IMGSZ - resized_height
    padded = cv2.copyMakeBorder(
        resized,
        pad_y // 2,
        pad_y - pad_y // 2,
        pad_x // 2,
        pad_x - pad_x // 2,
        cv2.BORDER_CONSTANT,
        value=(114, 114, 114),
    )
    # BGR HWC uint8 -> RGB NCHW float32, as Ultralytics preprocessing does.
    return np.ascontiguousarray(padded.transpose(2, 0, 1)[::-1], dtype=np.float32)[None] / 255.0


def predict_fixed_once(model: YOLO, image: Path, frame: np.ndarray, run: int) -> Prediction:
    started_at = time.perf_counter()
    result = run_prediction(model, frame)[0]
    wall_ms = (time.perf_counter() - started_at) * 1000
    boxes = result.boxes
    xyxy = [] if boxes is None else [tuple(map(float, box)) for box in boxes.xyxy.cpu().tolist()]
    confidences = [] if boxes is None else [float(value) for value in boxes.conf.cpu().tolist()]
    height, width = result.orig_shape
    return Prediction(
        image=image,
        run=run,
        width=int(width),
        height=int(height),
        wall_ms=wall_ms,
        inference_ms=float(result.speed.get("inference", 0.0)),
        boxes=xyxy,
        confidences=confidences,
    )


def benchmark(name: str, model: YOLO, images: list[Path], warmup: int, runs: int) -> list[Prediction]:
    warmup_image = images[0]
    for _ in range(warmup):
        run_prediction(model, warmup_image)

    predictions: list[Prediction] = []

    for run in range(runs):
        for image in images:
            predictions.append(predict_once(model, image, run))

    wall_times_ms = [prediction.wall_ms for prediction in predictions]
    inference_times_ms = [prediction.inference_ms for prediction in predictions]
    detection_counts = [len(prediction.boxes) for prediction in predictions]

    print(f"\n{name} ({len(wall_times_ms)} predictions; {len(images)} image(s) x {runs} run(s))")
    print(
        "  wall ms: "
        f"mean={statistics.fmean(wall_times_ms):.2f} "
        f"median={statistics.median(wall_times_ms):.2f} "
        f"p95={percentile(wall_times_ms, 0.95):.2f}"
    )
    print(
        "  Ultralytics inference ms: "
        f"mean={statistics.fmean(inference_times_ms):.2f} "
        f"median={statistics.median(inference_times_ms):.2f} "
        f"p95={percentile(inference_times_ms, 0.95):.2f}"
    )
    print(f"  detections: total={sum(detection_counts)} average={statistics.fmean(detection_counts):.2f}")
    return predictions


def iou(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union else 0.0


def match_boxes(pt: Prediction, ov: Prediction) -> tuple[list[tuple[int, int, float]], set[int], set[int]]:
    candidates = sorted(
        ((iou(pt_box, ov_box), pt_index, ov_index)
         for pt_index, pt_box in enumerate(pt.boxes)
         for ov_index, ov_box in enumerate(ov.boxes)),
        reverse=True,
    )
    matches: list[tuple[int, int, float]] = []
    used_pt: set[int] = set()
    used_ov: set[int] = set()
    for overlap, pt_index, ov_index in candidates:
        if overlap < MATERIAL_IOU or pt_index in used_pt or ov_index in used_ov:
            continue
        matches.append((pt_index, ov_index, overlap))
        used_pt.add(pt_index)
        used_ov.add(ov_index)
    return matches, set(range(len(pt.boxes))) - used_pt, set(range(len(ov.boxes))) - used_ov


def format_detections(prediction: Prediction) -> tuple[str, str]:
    boxes = "[" + ", ".join(
        f"({x1:.1f}, {y1:.1f}, {x2:.1f}, {y2:.1f})"
        for x1, y1, x2, y2 in prediction.boxes
    ) + "]"
    confidence = "[" + ", ".join(f"{value:.3f}" for value in prediction.confidences) + "]"
    return boxes, confidence


def compare_models(pt_predictions: list[Prediction], ov_predictions: list[Prediction]) -> None:
    # One comparison per source image is enough; repeated timed runs are for latency.
    pt_by_image = {prediction.image: prediction for prediction in pt_predictions if prediction.run == 0}
    ov_by_image = {prediction.image: prediction for prediction in ov_predictions if prediction.run == 0}
    identical_counts = different_counts = pt_only = ov_only = 0
    confidence_differences: list[float] = []
    matched_ious: list[float] = []
    near_threshold_pt_only = near_threshold_ov_only = 0

    print("\nMaterial detection differences:")
    for image in sorted(pt_by_image):
        pt = pt_by_image[image]
        ov = ov_by_image[image]
        if len(pt.boxes) == len(ov.boxes):
            identical_counts += 1
        else:
            different_counts += 1
        if pt.boxes and not ov.boxes:
            pt_only += 1
        if ov.boxes and not pt.boxes:
            ov_only += 1

        matches, unmatched_pt, unmatched_ov = match_boxes(pt, ov)
        matched_ious.extend(overlap for _, _, overlap in matches)
        confidence_differences.extend(
            abs(pt.confidences[pt_index] - ov.confidences[ov_index])
            for pt_index, ov_index, _ in matches
        )
        near_threshold_pt_only += sum(pt.confidences[index] < CONFIDENCE + 0.05 for index in unmatched_pt)
        near_threshold_ov_only += sum(ov.confidences[index] < CONFIDENCE + 0.05 for index in unmatched_ov)

        materially_different = len(pt.boxes) != len(ov.boxes) or bool(unmatched_pt or unmatched_ov)
        if materially_different:
            pt_boxes, pt_confidence = format_detections(pt)
            ov_boxes, ov_confidence = format_detections(ov)
            print(f"\nIMAGE: {image}"); print("\nPyTorch:")
            print(f"count: {len(pt.boxes)}\nboxes: {pt_boxes}\nconfidence: {pt_confidence}")
            print("\nOpenVINO:")
            print(f"count: {len(ov.boxes)}\nboxes: {ov_boxes}\nconfidence: {ov_confidence}")

    print("\nDetection comparison summary:")
    print(f"  images with identical detection counts: {identical_counts}")
    print(f"  images with different detection counts: {different_counts}")
    print(f"  PyTorch >=1 / OpenVINO 0: {pt_only}")
    print(f"  OpenVINO >=1 / PyTorch 0: {ov_only}")
    print(f"  average confidence difference (IoU >= {MATERIAL_IOU:.2f} matches): "
          f"{statistics.fmean(confidence_differences) if confidence_differences else 0.0:.4f}")
    print(f"  average bbox IoU for matched boxes: "
          f"{statistics.fmean(matched_ious) if matched_ious else 0.0:.4f}")
    print("  interpretation: "
          f"{pt_only} OpenVINO zero-detection cases are potential real misses; "
          f"unmatched near-threshold boxes (PT={near_threshold_pt_only}, OV={near_threshold_ov_only}) "
          "are more consistent with confidence/NMS differences. Ground-truth labels are required to prove misses.")


def correlation(first: list[float], second: list[float]) -> float | None:
    if len(first) < 2:
        return None
    first_mean, second_mean = statistics.fmean(first), statistics.fmean(second)
    numerator = sum((a - first_mean) * (b - second_mean) for a, b in zip(first, second))
    denominator = (sum((a - first_mean) ** 2 for a in first) * sum((b - second_mean) ** 2 for b in second)) ** 0.5
    return numerator / denominator if denominator else None


def report_openvino_spikes(predictions: list[Prediction]) -> None:
    slowest = sorted(predictions, key=lambda prediction: prediction.wall_ms, reverse=True)[:10]
    print("\n10 slowest OpenVINO predictions:")
    for prediction in slowest:
        print(f"  {prediction.image.name} {prediction.width}x{prediction.height} "
              f"wall={prediction.wall_ms:.2f}ms inference={prediction.inference_ms:.2f}ms")

    pixels = [prediction.width * prediction.height for prediction in predictions]
    aspects = [prediction.width / prediction.height for prediction in predictions]
    walls = [prediction.wall_ms for prediction in predictions]
    slow_shapes = Counter((prediction.width, prediction.height) for prediction in slowest)
    pixel_correlation = correlation([float(value) for value in pixels], walls)
    aspect_correlation = correlation(aspects, walls)
    print("  slowest source dimensions: " + ", ".join(
        f"{width}x{height} ({count})" for (width, height), count in slow_shapes.most_common()
    ))
    print("  wall-time correlation: "
          f"pixels={pixel_correlation:.3f}" if pixel_correlation is not None else "  wall-time correlation: pixels=n/a",
          f"aspect_ratio={aspect_correlation:.3f}" if aspect_correlation is not None else "aspect_ratio=n/a")


def fixed_latency_report(name: str, model: YOLO, frames: list[tuple[Path, np.ndarray]], predictions: int) -> None:
    # Fixed mode intentionally uses exactly 10 warmups and repeats the same
    # pre-letterboxed camera-like frames. Only model execution is timed.
    for index in range(10):
        image, frame = frames[index % len(frames)]
        predict_fixed_once(model, image, frame, run=-1)

    records = [
        predict_fixed_once(model, frames[index % len(frames)][0], frames[index % len(frames)][1], run=index)
        for index in range(predictions)
    ]
    wall_times = [record.wall_ms for record in records]
    inference_times = [record.inference_ms for record in records]
    print(f"\n{name} fixed 1280x720 stability ({predictions} batch=1 predictions; 10 warmups)")
    print(
        "  wall ms: "
        f"mean={statistics.fmean(wall_times):.2f} "
        f"median={statistics.median(wall_times):.2f} "
        f"p90={percentile(wall_times, 0.90):.2f} "
        f"p95={percentile(wall_times, 0.95):.2f} "
        f"p99={percentile(wall_times, 0.99):.2f} "
        f"min={min(wall_times):.2f} max={max(wall_times):.2f}"
    )
    print(
        "  inference ms: "
        f"mean={statistics.fmean(inference_times):.2f} "
        f"median={statistics.median(inference_times):.2f} "
        f"p90={percentile(inference_times, 0.90):.2f} "
        f"p95={percentile(inference_times, 0.95):.2f} "
        f"p99={percentile(inference_times, 0.99):.2f} "
        f"min={min(inference_times):.2f} max={max(inference_times):.2f}"
    )
    print(
        "  wall thresholds: "
        f">100ms={sum(value > 100 for value in wall_times)} "
        f">200ms={sum(value > 200 for value in wall_times)} "
        f">300ms={sum(value > 300 for value in wall_times)}"
    )
    print(
        "  inference thresholds: "
        f">100ms={sum(value > 100 for value in inference_times)} "
        f">200ms={sum(value > 200 for value in inference_times)} "
        f">300ms={sum(value > 300 for value in inference_times)}"
    )


def latency_summary(times: list[float]) -> dict[str, float | int]:
    mean = statistics.fmean(times)
    standard_deviation = statistics.pstdev(times)
    return {
        "mean": mean,
        "median": statistics.median(times),
        "p90": percentile(times, 0.90),
        "p95": percentile(times, 0.95),
        "p99": percentile(times, 0.99),
        "min": min(times),
        "max": max(times),
        "stddev": standard_deviation,
        "cv": standard_deviation / mean if mean else 0.0,
        "over_100": sum(value > 100 for value in times),
        "over_200": sum(value > 200 for value in times),
        "over_300": sum(value > 300 for value in times),
    }


def print_latency_summary(name: str, summary: dict[str, float | int]) -> None:
    print(f"\n{name}")
    print(
        "  ms: "
        f"mean={summary['mean']:.2f} median={summary['median']:.2f} "
        f"p90={summary['p90']:.2f} p95={summary['p95']:.2f} p99={summary['p99']:.2f} "
        f"min={summary['min']:.2f} max={summary['max']:.2f}"
    )
    print(f"  variability: stddev={summary['stddev']:.2f}ms cv={summary['cv']:.3f}")
    print(
        "  spikes: "
        f">100ms={summary['over_100']} >200ms={summary['over_200']} >300ms={summary['over_300']}"
    )


def supported_cpu_properties(core: Core) -> set[str]:
    return {str(property_name).upper() for property_name in core.get_property("CPU", "SUPPORTED_PROPERTIES")}


def openvino_cpu_configurations() -> list[tuple[str, dict[str, str], set[str]]]:
    latency = {"PERFORMANCE_HINT": "LATENCY"}
    return [
        ("default LATENCY", latency, {"PERFORMANCE_HINT"}),
        ("LATENCY + CPU pinning", latency | {"ENABLE_CPU_PINNING": "YES"}, {"PERFORMANCE_HINT", "ENABLE_CPU_PINNING"}),
        ("LATENCY + hyper-threading disabled", latency | {"ENABLE_HYPER_THREADING": "NO"}, {"PERFORMANCE_HINT", "ENABLE_HYPER_THREADING"}),
        (
            "LATENCY + pinning + hyper-threading disabled",
            latency | {"ENABLE_CPU_PINNING": "YES", "ENABLE_HYPER_THREADING": "NO"},
            {"PERFORMANCE_HINT", "ENABLE_CPU_PINNING", "ENABLE_HYPER_THREADING"},
        ),
        ("LATENCY + 2 inference threads", latency | {"INFERENCE_NUM_THREADS": "2"}, {"PERFORMANCE_HINT", "INFERENCE_NUM_THREADS"}),
        ("LATENCY + 4 inference threads", latency | {"INFERENCE_NUM_THREADS": "4"}, {"PERFORMANCE_HINT", "INFERENCE_NUM_THREADS"}),
        ("LATENCY + 8 inference threads", latency | {"INFERENCE_NUM_THREADS": "8"}, {"PERFORMANCE_HINT", "INFERENCE_NUM_THREADS"}),
        ("LATENCY + NUM_STREAMS=1", latency | {"NUM_STREAMS": "1"}, {"PERFORMANCE_HINT", "NUM_STREAMS"}),
    ]


def benchmark_openvino_cpu_configs(openvino_path: Path, frames: list[tuple[Path, np.ndarray]], predictions: int) -> None:
    """Benchmark direct OpenVINO synchronous CPU inference with supported properties."""
    core = Core()
    supported = supported_cpu_properties(core)
    xml_files = list(openvino_path.glob("*.xml"))
    if len(xml_files) != 1:
        raise ValueError(f"Expected exactly one OpenVINO .xml model in {openvino_path}")
    model = core.read_model(str(xml_files[0]))
    inputs = [letterbox_to_model_input(frame) for _, frame in frames]
    results: list[tuple[str, dict[str, float | int]]] = []

    print("\nOpenVINO direct CPU tuning (1280x720 source -> 640 letterbox, batch=1)")
    print("Supported CPU properties: " + ", ".join(sorted(supported)))
    for name, config, required in openvino_cpu_configurations():
        unsupported = required - supported
        if unsupported:
            print(f"\n{name}: skipped (unsupported: {', '.join(sorted(unsupported))})")
            continue
        try:
            compiled_model = core.compile_model(model, "CPU", config)
            infer_request = compiled_model.create_infer_request()
            input_port = compiled_model.input(0)
            for index in range(10):
                infer_request.infer({input_port: inputs[index % len(inputs)]})
            times = []
            for index in range(predictions):
                started_at = time.perf_counter()
                infer_request.infer({input_port: inputs[index % len(inputs)]})
                times.append((time.perf_counter() - started_at) * 1000)
        except Exception as error:
            print(f"\n{name}: skipped (compile/infer failed: {error})")
            continue

        summary = latency_summary(times)
        print_latency_summary(name, summary)
        results.append((name, summary))

    if not results:
        print("\nNo requested OpenVINO CPU configuration was supported by this runtime.")
        return

    ranked = sorted(
        results,
        key=lambda item: (
            item[1]["p95"], item[1]["p99"], item[1]["over_100"],
            item[1]["over_200"], item[1]["median"],
        ),
    )
    print("\nOpenVINO CPU configuration ranking (consistency first):")
    for index, (name, summary) in enumerate(ranked, start=1):
        print(
            f"  {index}. {name}: p95={summary['p95']:.2f}ms p99={summary['p99']:.2f}ms "
            f">100ms={summary['over_100']} >200ms={summary['over_200']} "
            f"median={summary['median']:.2f}ms cv={summary['cv']:.3f}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, help="Image file or directory to benchmark")
    parser.add_argument("--warmup", type=int, default=3, help="Warm-up predictions per model (default: 3)")
    parser.add_argument("--runs", type=int, default=10, help="Timed runs over all images (default: 10)")
    parser.add_argument("--skip-export", action="store_true", help="Reuse the existing OpenVINO export")
    parser.add_argument(
        "--fixed-camera-stability",
        action="store_true",
        help="Benchmark repeated 1280x720 letterboxed frames (10 warmups, 200 predictions per model)",
    )
    parser.add_argument(
        "--fixed-predictions",
        type=int,
        default=200,
        help="Predictions per model in fixed-camera mode; minimum 200 (default: 200)",
    )
    parser.add_argument(
        "--openvino-cpu-tuning",
        action="store_true",
        help="Direct OpenVINO CPU latency/configuration benchmark on fixed 1280x720 frames",
    )
    args = parser.parse_args()

    if args.warmup < 0 or args.runs < 1:
        parser.error("--warmup must be >= 0 and --runs must be >= 1")
    if args.fixed_predictions < 200:
        parser.error("--fixed-predictions must be at least 200")
    if not MODEL_PATH.is_file():
        parser.error(f"Production checkpoint not found: {MODEL_PATH}")

    try:
        images = image_paths(args.source)
    except ValueError as error:
        parser.error(str(error))
    if not images:
        parser.error("No benchmark images found; pass an image file or directory path.")

    print(f"Checkpoint: {MODEL_PATH}")
    print(f"Settings: imgsz={IMGSZ}, conf={CONFIDENCE}, warmup={args.warmup}, runs={args.runs}")
    print("Images:")
    for image in images:
        print(f"  {image}")

    openvino_path = MODEL_PATH.with_name(f"{MODEL_PATH.stem}_openvino_model")
    if args.openvino_cpu_tuning and not openvino_path.exists():
        parser.error(f"OpenVINO export not found for CPU tuning: {openvino_path}")
    if not openvino_path.exists() and args.skip_export:
        parser.error(f"OpenVINO export not found: {openvino_path}")
    if not openvino_path.exists():
        pt_model = YOLO(str(MODEL_PATH))
        openvino_path = Path(pt_model.export(format="openvino", imgsz=IMGSZ))
    elif args.openvino_cpu_tuning:
        pt_model = None
    else:
        pt_model = YOLO(str(MODEL_PATH))

    if args.fixed_camera_stability or args.openvino_cpu_tuning:
        try:
            frames = fixed_camera_inputs(images)
        except ValueError as error:
            parser.error(str(error))
        print(f"Fixed source resolution: {FIXED_WIDTH}x{FIXED_HEIGHT} (letterboxed, batch=1)")
    if args.openvino_cpu_tuning:
        benchmark_openvino_cpu_configs(openvino_path, frames, args.fixed_predictions)
        return

    ov_model = YOLO(str(openvino_path))
    if args.fixed_camera_stability:
        assert pt_model is not None
        fixed_latency_report("PyTorch (.pt)", pt_model, frames, args.fixed_predictions)
        fixed_latency_report("OpenVINO", ov_model, frames, args.fixed_predictions)
        return

    pt_predictions = benchmark("PyTorch (.pt)", pt_model, images, args.warmup, args.runs)
    ov_predictions = benchmark("OpenVINO", ov_model, images, args.warmup, args.runs)
    compare_models(pt_predictions, ov_predictions)
    report_openvino_spikes(ov_predictions)


if __name__ == "__main__":
    main()
