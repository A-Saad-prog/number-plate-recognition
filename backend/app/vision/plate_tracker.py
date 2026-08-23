import os
import re
import time
from collections import Counter
from pathlib import Path

import cv2
from ultralytics import YOLO
from paddleocr import PaddleOCR

# ============================================================
# PaddlePaddle compatibility
# ============================================================

os.environ["FLAGS_enable_pir_api"] = "0"


# ============================================================
# Project paths
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[3]

MODEL_PATH = PROJECT_ROOT / "models" / "best.pt"


# ============================================================
# Configuration
# ============================================================

FRAME_SKIP = 3

CONFIDENCE_THRESHOLD = 0.40

OCR_READINGS_REQUIRED = 3

OCR_CONFIDENCE_THRESHOLD = 0.60

PLATE_LOST_TIMEOUT = 2.0


# ============================================================
# License Plate Recognizer
# ============================================================


class LicensePlateRecognizer:
    """
    YOLO + PaddleOCR license plate recognition engine.

    This class does NOT open a camera.

    A video frame is supplied through process_frame().
    This makes the recognizer usable from:

        - OpenCV
        - FastAPI
        - WebSockets
        - AWS
        - browser video streams

    """

    def __init__(
        self,
        model_path=MODEL_PATH,
        frame_skip=FRAME_SKIP,
        confidence_threshold=CONFIDENCE_THRESHOLD,
        ocr_readings_required=OCR_READINGS_REQUIRED,
        ocr_confidence_threshold=OCR_CONFIDENCE_THRESHOLD,
        plate_lost_timeout=PLATE_LOST_TIMEOUT,
    ):

        self.model_path = Path(model_path)

        self.frame_skip = frame_skip

        self.confidence_threshold = confidence_threshold

        self.ocr_readings_required = ocr_readings_required

        self.ocr_confidence_threshold = ocr_confidence_threshold

        self.plate_lost_timeout = plate_lost_timeout

        # --------------------------------------------------------
        # State
        # --------------------------------------------------------

        self.frame_count = 0

        self.last_boxes = []

        self.last_plate_time = 0

        self.ocr_results = []

        self.recognized_plate = None

        self.ocr_running = False

        # --------------------------------------------------------
        # Load YOLO
        # --------------------------------------------------------

        print("Loading YOLO...")

        self.yolo = YOLO(str(self.model_path))

        print("YOLO loaded.")

        # --------------------------------------------------------
        # Load PaddleOCR
        # --------------------------------------------------------

        print("Loading OCR...")

        self.ocr = PaddleOCR(
            lang="en",
            enable_mkldnn=False,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

        print("OCR loaded.")

        print(f"YOLO model: {self.model_path}")

    # ============================================================
    # Plate validation
    # ============================================================

    @staticmethod
    def is_valid_plate(text):
        """
        Validate Pakistani-style plate format.

        Accepted:

            ABC-1234
            ABC1234
        """

        if not text:
            return False

        return bool(
            re.match(
                r"^[A-Z]{3}-?[0-9]{4}$",
                text.upper().strip().replace(" ", ""),
            )
        )

    # ============================================================
    # OCR
    # ============================================================

    def read_plate(self, plate_crop):

        print("Running OCR...")

        try:

            results = self.ocr.predict(plate_crop)

            texts = []

            scores = []

            # ----------------------------------------------------
            # Extract OCR results
            # ----------------------------------------------------

            for result in results:

                data = result.get("rec_texts", [])

                confidence = result.get("rec_scores", [])

                for text, score in zip(data, confidence):

                    score = float(score)

                    if score >= self.ocr_confidence_threshold:

                        texts.append(text.strip())

                        scores.append(score)

            # ----------------------------------------------------
            # No readable text
            # ----------------------------------------------------

            if not texts:

                print("OCR could not read plate.")

                return None

            # ----------------------------------------------------
            # Select strongest OCR result
            # ----------------------------------------------------

            best_index = scores.index(max(scores))

            text = texts[best_index]

            confidence = scores[best_index]

            # ----------------------------------------------------
            # Validate plate
            # ----------------------------------------------------

            if not self.is_valid_plate(text):

                print(f"OCR rejected: {text} " f"(does not look like a plate)")

                return None

            # ----------------------------------------------------
            # Normalize plate
            # ----------------------------------------------------

            text = text.upper().strip()

            text = text.replace(" ", "")

            if len(text) == 7 and text[3] != "-":
                text = text[:3] + "-" + text[3:]

            print(f"OCR: {text} " f"(confidence: {confidence:.2f})")

            return text

        except Exception as error:

            print(f"OCR error: {error}")

            return None

    # ============================================================
    # Process one frame
    # ============================================================

    def process_frame(self, frame):
        """
        Process a single OpenCV frame.

        Returns:

            {
                "plate": "ABC-1234",
                "boxes": [...],
                "ocr_running": False,
                "plate_detected": True,
            }

        """

        if frame is None:

            return {
                "plate": None,
                "boxes": [],
                "ocr_running": False,
                "plate_detected": False,
            }

        self.frame_count += 1

        actual_height, actual_width = frame.shape[:2]

        # ========================================================
        # YOLO
        # ========================================================

        if self.frame_count % self.frame_skip == 0:

            results = self.yolo.predict(
                source=frame,
                conf=self.confidence_threshold,
                device="cpu",
                verbose=False,
            )

            self.last_boxes = []

            for result in results:

                if result.boxes is None:

                    continue

                for box in result.boxes:

                    x1, y1, x2, y2 = box.xyxy[0].tolist()

                    confidence = float(box.conf[0])

                    self.last_boxes.append(
                        (
                            int(x1),
                            int(y1),
                            int(x2),
                            int(y2),
                            confidence,
                        )
                    )

            # ====================================================
            # Plate detected
            # ====================================================

            if self.last_boxes:

                self.last_plate_time = time.time()

                # ------------------------------------------------
                # Run OCR only if we don't already have
                # a recognized plate
                # ------------------------------------------------

                if self.recognized_plate is None and not self.ocr_running:

                    self._run_ocr(
                        frame,
                        actual_width,
                        actual_height,
                    )

        # ========================================================
        # Check whether plate disappeared
        # ========================================================

        if self.recognized_plate is not None and (
            time.time() - self.last_plate_time > self.plate_lost_timeout
        ):

            print(f"Vehicle left camera: " f"{self.recognized_plate}")

            self.recognized_plate = None

            self.ocr_results = []

            self.last_boxes = []

        # ========================================================
        # Return result
        # ========================================================

        return {
            "plate": self.recognized_plate,
            "boxes": self.last_boxes,
            "ocr_running": self.ocr_running,
            "plate_detected": bool(self.last_boxes),
        }

    # ============================================================
    # OCR processing
    # ============================================================

    def _run_ocr(
        self,
        frame,
        actual_width,
        actual_height,
    ):

        x1, y1, x2, y2, confidence = self.last_boxes[0]

        # --------------------------------------------------------
        # Add padding around detected plate
        # --------------------------------------------------------

        padding = 10

        x1 = max(0, x1 - padding)

        y1 = max(0, y1 - padding)

        x2 = min(actual_width, x2 + padding)

        y2 = min(actual_height, y2 + padding)

        plate_crop = frame[y1:y2, x1:x2]

        if plate_crop.size <= 0:

            return

        self.ocr_running = True

        self.ocr_results = []

        try:

            # ----------------------------------------------------
            # Multiple OCR readings
            # ----------------------------------------------------

            for _ in range(self.ocr_readings_required):

                result = self.read_plate(plate_crop)

                if result:

                    self.ocr_results.append(result)

            # ----------------------------------------------------
            # Determine final plate
            # ----------------------------------------------------

            if self.ocr_results:

                counts = Counter(self.ocr_results)

                self.recognized_plate = counts.most_common(1)[0][0]

                print()

                print("==============================")

                print("RECOGNIZED PLATE:")

                print(self.recognized_plate)

                print("==============================")

                print()

        finally:

            self.ocr_running = False

    # ============================================================
    # Reset recognizer
    # ============================================================

    def reset(self):
        """
        Completely reset the recognizer state.

        Useful when the application wants to explicitly
        start looking for a new vehicle.
        """

        self.frame_count = 0

        self.last_boxes = []

        self.last_plate_time = 0

        self.ocr_results = []

        self.recognized_plate = None

        self.ocr_running = False

    # ============================================================
    # Draw detections
    # ============================================================

    def draw_detections(
        self,
        frame,
        result=None,
    ):

        if result is None:

            result = {
                "plate": self.recognized_plate,
                "boxes": self.last_boxes,
                "ocr_running": self.ocr_running,
            }

        # --------------------------------------------------------
        # YOLO boxes
        # --------------------------------------------------------

        for (
            x1,
            y1,
            x2,
            y2,
            confidence,
        ) in result["boxes"]:

            cv2.rectangle(
                frame,
                (x1, y1),
                (x2, y2),
                (0, 255, 0),
                2,
            )

            label = f"Plate " f"{confidence:.2f}"

            cv2.putText(
                frame,
                label,
                (
                    x1,
                    max(y1 - 10, 20),
                ),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0),
                2,
            )

        # --------------------------------------------------------
        # Plate status
        # --------------------------------------------------------

        plate = result["plate"]

        if plate:

            cv2.putText(
                frame,
                f"PLATE: {plate}",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 255, 0),
                3,
            )

        elif result["ocr_running"]:

            cv2.putText(
                frame,
                "READING PLATE...",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 255),
                2,
            )

        else:

            cv2.putText(
                frame,
                "SEARCHING...",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 255),
                2,
            )

        return frame
