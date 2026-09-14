"""Compare supported CPU inference engines for the production OCR model.

Examples (from backend):
  ./.venv/Scripts/python.exe benchmark_paddle_ocr_engines.py --source-images benchmark-images
  ./.venv/Scripts/python.exe benchmark_paddle_ocr_engines.py plate-crops

This is benchmark-only. It reuses the existing benchmark's production crop
generation and OCR result extraction; it never changes the live OCR pipeline.
"""

from __future__ import annotations

import argparse
import importlib.util
import statistics
import time
from dataclasses import dataclass
from pathlib import Path

import cv2

from benchmark_paddle_ocr import (
    OCR_RECOGNITION_MODEL,
    image_paths,
    percentile,
    production_ocr_inputs,
    production_output,
)
from paddleocr import TextRecognition


@dataclass(frozen=True)
class Engine:
    name: str
    kwargs: dict
    needs_onnxruntime: bool = False


def engines() -> list[Engine]:
    return [
        Engine(
            "paddle_static (production default)",
            {"device": "cpu", "enable_mkldnn": True, "cpu_threads": 2},
        ),
        Engine(
            "onnxruntime (TextRecognition engine)",
            {"device": "cpu", "engine": "onnxruntime", "enable_mkldnn": True, "cpu_threads": 2},
            needs_onnxruntime=True,
        ),
    ]


def summary(values: list[float]) -> dict[str, float]:
    return {
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "p90": percentile(values, .90),
        "p95": percentile(values, .95),
        "p99": percentile(values, .99),
        "max": max(values),
    }


def print_summary(name: str, init_ms: float, values: list[float]) -> None:
    stats = summary(values)
    print(
        f"\n{name}\n"
        f"  initialization: {init_ms:.2f}ms (excluded from prediction latency)\n"
        f"  latency: mean={stats['mean']:.2f}ms median={stats['median']:.2f}ms "
        f"p90={stats['p90']:.2f}ms p95={stats['p95']:.2f}ms "
        f"p99={stats['p99']:.2f}ms max={stats['max']:.2f}ms"
    )


def create_recognizer(engine: Engine) -> tuple[TextRecognition, float]:
    started = time.perf_counter()
    recognizer = TextRecognition(model_name=OCR_RECOGNITION_MODEL, **engine.kwargs)
    return recognizer, (time.perf_counter() - started) * 1000


def run_engine(
    engine: Engine,
    inputs: list[tuple[Path, object]],
    warmups: int,
    predictions: int,
    baseline: dict[Path, tuple[str, float]] | None,
) -> tuple[dict[Path, tuple[str, float]], list[float], int, list[float]]:
    recognizer, init_ms = create_recognizer(engine)
    for index in range(warmups):
        recognizer.predict(inputs[index % len(inputs)][1])

    # One output per crop, outside the latency samples, guarantees parity is
    # assessed on every input even when there are more crops than predictions.
    outputs = {
        path: production_output(recognizer.predict(image))
        for path, image in inputs
    }
    times = []
    for index in range(predictions):
        _, image = inputs[index % len(inputs)]
        started = time.perf_counter()
        recognizer.predict(image)  # batch_size=1, identical crop every engine.
        times.append((time.perf_counter() - started) * 1000)

    print_summary(engine.name, init_ms, times)
    if baseline is None:
        return outputs, times, 0, []

    mismatches = 0
    confidence_differences = []
    for path, actual in outputs.items():
        expected = baseline[path]
        confidence_differences.append(abs(expected[1] - actual[1]))
        if actual[0] != expected[0]:
            mismatches += 1
            print(
                f"  TEXT MISMATCH {path.name}: "
                f"paddle_static text={expected[0]!r} confidence={expected[1]:.4f}; "
                f"{engine.name} text={actual[0]!r} confidence={actual[1]:.4f}"
            )
    exact_matches = len(outputs) - mismatches
    print(
        f"  output parity: exact_text_matches={exact_matches}/{len(outputs)} "
        f"mismatches={mismatches} "
        f"mean_confidence_difference={statistics.fmean(confidence_differences) if confidence_differences else 0.0:.4f}"
    )
    return outputs, times, mismatches, confidence_differences


def load_inputs(args: argparse.Namespace) -> list[tuple[Path, object]]:
    if args.source_images:
        inputs, source_count = production_ocr_inputs(args.source_images)
        print(f"Source images: {source_count}; valid production OCR crops: {len(inputs)}")
        return inputs
    inputs = []
    for path in image_paths(args.source):
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f"Unable to read OCR crop: {path}")
        inputs.append((path, image))
    print(f"Pre-cropped OCR inputs: {len(inputs)}")
    return inputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, help="Pre-cropped plate image or directory")
    parser.add_argument("--source-images", type=Path, help="Camera images processed with current production helpers")
    parser.add_argument("--warmups", type=int, default=10)
    parser.add_argument("--predictions", type=int, default=200)
    args = parser.parse_args()
    if args.warmups < 10 or args.predictions < 200:
        parser.error("--warmups must be at least 10 and --predictions must be at least 200")
    if bool(args.source) == bool(args.source_images):
        parser.error("provide exactly one of source or --source-images")
    try:
        inputs = load_inputs(args)
    except ValueError as error:
        parser.error(str(error))
    if not inputs:
        parser.error("No valid OCR crops were produced.")

    print(f"Model: {OCR_RECOGNITION_MODEL}; CPU; batch_size=1; warmups={args.warmups}; timed_predictions={args.predictions}")
    baseline = None
    results = []
    for engine in engines():
        if engine.needs_onnxruntime and importlib.util.find_spec("onnxruntime") is None:
            print(f"\n{engine.name}: SKIPPED (benchmark-only package onnxruntime is not installed)")
            results.append((engine.name, "SKIPPED", None, None))
            continue
        try:
            outputs, times, mismatches, confidence_differences = run_engine(
                engine, inputs, args.warmups, args.predictions, baseline
            )
        except Exception as error:
            print(f"\n{engine.name}: SKIPPED (engine unavailable: {error})")
            results.append((engine.name, "SKIPPED", None, None))
            continue
        if baseline is None:
            baseline = outputs
            results.append((engine.name, "BASELINE", 0, summary(times)))
        else:
            result = "PASS" if mismatches == 0 and summary(times)["median"] < summary_baseline["median"] else "FAIL"
            results.append((engine.name, result, mismatches, summary(times)))
        if baseline is outputs:
            summary_baseline = summary(times)

    print("\nRecommendation (parity first, then materially lower median/p95):")
    for name, result, mismatches, stats in results:
        if stats is None:
            print(f"  {name}: {result}")
        elif result == "BASELINE":
            print(f"  {name}: BASELINE median={stats['median']:.2f}ms p95={stats['p95']:.2f}ms")
        else:
            print(f"  {name}: {result} mismatches={mismatches} median={stats['median']:.2f}ms p95={stats['p95']:.2f}ms")


if __name__ == "__main__":
    main()
