"""Standalone CPU benchmark for the production PaddleOCR recognition model.

Input files must be already-cropped plate images. This script intentionally
does not perform YOLO, crop, rectification, two-line conversion, parsing, or
any production-code mutation.

Example:
    .\\.venv\\Scripts\\python.exe benchmark_paddle_ocr.py plate-crops
"""

from __future__ import annotations

import argparse
import statistics
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

# Match the production Paddle compatibility setting before importing PaddleOCR.
import os

os.environ["FLAGS_enable_pir_api"] = "0"

from paddleocr import TextRecognition


OCR_RECOGNITION_MODEL = "en_PP-OCRv5_mobile_rec"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
THREAD_COUNTS = (1, 2, 4, 8)


@dataclass(frozen=True)
class Configuration:
    name: str
    kwargs: dict
    is_production_default: bool = False


def image_paths(source: Path) -> list[Path]:
    if source.is_file():
        if source.suffix.lower() not in IMAGE_SUFFIXES:
            raise ValueError(f"Unsupported image type: {source}")
        return [source]
    if source.is_dir():
        return sorted(path for path in source.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES)
    raise ValueError(f"Image source does not exist: {source}")


def production_ocr_inputs(source: Path) -> tuple[list[tuple[Path, np.ndarray]], int]:
    """Create OCR crops with the exact current detector/crop preparation helpers."""
    # Imported only for this optional mode: these helpers are the live
    # production implementations, not benchmark copies.
    from app.api.vision import (
        _best_box,
        _exact_crop,
        _prepare_two_line_plate,
        _rectify_plate,
        _stabilize_box,
    )

    inputs = []
    for path in image_paths(source):
        frame = cv2.imread(str(path))
        if frame is None:
            print(f"Skipping unreadable source image: {path}")
            continue
        box, _ = _best_box(frame)
        if box is None:
            continue
        crop, _ = _exact_crop(frame, _stabilize_box(box, str(path)))
        if crop is None or crop.size == 0:
            continue
        rectified_crop, _ = _rectify_plate(crop)
        ocr_input, _ = _prepare_two_line_plate(rectified_crop)
        if ocr_input is not None and ocr_input.size:
            inputs.append((path, ocr_input))
    return inputs, len(image_paths(source))


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def production_output(results) -> tuple[str, float]:
    """Match app.api.vision._raw_ocr() result extraction exactly."""
    raw_parts = []
    raw_scores = []
    for result in results:
        texts = result.get("rec_text", [])
        scores = result.get("rec_score", [])
        if not isinstance(texts, (list, tuple, np.ndarray)):
            texts = [texts]
        if not isinstance(scores, (list, tuple, np.ndarray)):
            scores = [scores]
        for text, score in zip(texts, scores):
            text = str(text).strip()
            score = float(score)
            if text:
                raw_parts.append(text)
                raw_scores.append(score)
    return "\n".join(raw_parts), max(raw_scores, default=0.0)


def configurations() -> list[Configuration]:
    configs = [Configuration("production default", {}, is_production_default=True)]
    for enabled in (False, True):
        for threads in THREAD_COUNTS:
            configs.append(
                Configuration(
                    f"CPU MKL-DNN={'on' if enabled else 'off'} threads={threads}",
                    {
                        "device": "cpu",
                        "enable_mkldnn": enabled,
                        "cpu_threads": threads,
                    },
                )
            )
    return configs


def summarize(times: list[float]) -> dict[str, float | int]:
    mean = statistics.fmean(times)
    stddev = statistics.pstdev(times)
    return {
        "mean": mean,
        "median": statistics.median(times),
        "p90": percentile(times, 0.90),
        "p95": percentile(times, 0.95),
        "p99": percentile(times, 0.99),
        "min": min(times),
        "max": max(times),
        "stddev": stddev,
        "cv": stddev / mean if mean else 0.0,
        "over_100": sum(value > 100 for value in times),
        "over_200": sum(value > 200 for value in times),
        "over_300": sum(value > 300 for value in times),
    }


def print_summary(name: str, summary: dict[str, float | int], mismatches: int) -> None:
    print(f"\n{name}")
    print(
        "  ms: "
        f"mean={summary['mean']:.2f} median={summary['median']:.2f} "
        f"p90={summary['p90']:.2f} p95={summary['p95']:.2f} p99={summary['p99']:.2f} "
        f"min={summary['min']:.2f} max={summary['max']:.2f}"
    )
    print(f"  stability: stddev={summary['stddev']:.2f}ms cv={summary['cv']:.3f}")
    print(
        "  spikes: "
        f">100ms={summary['over_100']} >200ms={summary['over_200']} >300ms={summary['over_300']}"
    )
    print(f"  output mismatches versus production default: {mismatches}")


def benchmark_configuration(
    config: Configuration,
    inputs: list[tuple[Path, np.ndarray]],
    warmup: int,
    predictions: int,
    baseline_outputs: dict[Path, tuple[str, float]] | None,
) -> tuple[dict[str, float | int], dict[Path, tuple[str, float]], int]:
    recognizer = TextRecognition(model_name=OCR_RECOGNITION_MODEL, **config.kwargs)
    for index in range(warmup):
        recognizer.predict(inputs[index % len(inputs)][1])

    times = []
    outputs: dict[Path, tuple[str, float]] = {}
    mismatches = 0
    compared = set()
    for index in range(predictions):
        path, image = inputs[index % len(inputs)]
        started_at = time.perf_counter()
        results = recognizer.predict(image)  # Exact production recognition call.
        times.append((time.perf_counter() - started_at) * 1000)
        output = production_output(results)
        outputs.setdefault(path, output)
        if baseline_outputs is not None and path not in compared:
            compared.add(path)
            if output != baseline_outputs[path]:
                mismatches += 1
                print(
                    f"  OUTPUT MISMATCH {path.name}: "
                    f"default={baseline_outputs[path]!r} configured={output!r}"
                )
    return summarize(times), outputs, mismatches


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, help="Pre-cropped plate image file or directory")
    parser.add_argument(
        "--source-images",
        type=Path,
        help="Original camera-image folder; create OCR inputs with production YOLO/crop/rectification helpers",
    )
    parser.add_argument("--warmup", type=int, default=10, help="Warmups per configuration (minimum: 10)")
    parser.add_argument("--predictions", type=int, default=200, help="Timed predictions per configuration (minimum: 200)")
    args = parser.parse_args()
    if args.warmup < 10 or args.predictions < 200:
        parser.error("--warmup must be >= 10 and --predictions must be >= 200")
    if bool(args.source) == bool(args.source_images):
        parser.error("provide exactly one of source or --source-images")

    try:
        if args.source_images:
            inputs, source_count = production_ocr_inputs(args.source_images)
            print(f"Source images: {source_count}; valid production OCR crops: {len(inputs)}")
        else:
            paths = image_paths(args.source)
            inputs = []
            for path in paths:
                image = cv2.imread(str(path))
                if image is None:
                    parser.error(f"Unable to read image: {path}")
                inputs.append((path, image))
    except ValueError as error:
        parser.error(str(error))
    if not inputs:
        parser.error("No valid OCR input images found.")

    print(f"Model: {OCR_RECOGNITION_MODEL}")
    print(f"CPU recognition-only; {len(inputs)} crop(s), {args.warmup} warmups, {args.predictions} timed predictions/config")

    rankings = []
    baseline_outputs = None
    for config in configurations():
        summary, outputs, mismatches = benchmark_configuration(
            config, inputs, args.warmup, args.predictions, baseline_outputs
        )
        print_summary(config.name, summary, mismatches)
        if config.is_production_default:
            baseline_outputs = outputs
        rankings.append((config.name, summary, mismatches))

    rankings.sort(
        key=lambda item: (item[2], item[1]["p95"], item[1]["p99"], item[1]["over_100"], item[1]["median"])
    )
    print("\nRanking (output parity, then latency consistency):")
    for index, (name, summary, mismatches) in enumerate(rankings, start=1):
        print(
            f"  {index}. {name}: mismatches={mismatches} p95={summary['p95']:.2f}ms "
            f"p99={summary['p99']:.2f}ms >100ms={summary['over_100']} median={summary['median']:.2f}ms"
        )


if __name__ == "__main__":
    main()
