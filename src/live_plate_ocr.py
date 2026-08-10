import os

# Fix PaddlePaddle PIR/oneDNN compatibility issue.
# This must be set before importing PaddleOCR.
os.environ["FLAGS_enable_pir_api"] = "0"

import time
import cv2
from ultralytics import YOLO
from paddleocr import PaddleOCR


# ==========================================
# Configuration
# ==========================================

MODEL_PATH = (
    "runs/detect/runs/plate_detector_small/"
    "weights/best.pt"
)

CONFIDENCE_THRESHOLD = 0.40

# Run OCR once every X seconds.
OCR_INTERVAL = 1.0


# ==========================================
# Load models
# ==========================================

print("Loading YOLO...")

yolo = YOLO(MODEL_PATH)

print("Loading PaddleOCR...")

ocr = PaddleOCR(
    lang="en",
    enable_mkldnn=False,
)

print("Models loaded.")


# ==========================================
# Start camera
# ==========================================

camera = cv2.VideoCapture(0)

camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
camera.set(cv2.CAP_PROP_FPS, 30)


if not camera.isOpened():
    print("Could not open camera.")
    exit()


# ==========================================
# Variables
# ==========================================

last_ocr_time = 0
last_plate_text = "No plate detected"

fps_start = time.time()
fps_counter = 0
fps = 0


# ==========================================
# Main loop
# ==========================================

while True:

    success, frame = camera.read()

    if not success:
        print("Could not read camera frame.")
        break


    # --------------------------------------
    # YOLO detection
    # --------------------------------------

    results = yolo.predict(
        source=frame,
        conf=CONFIDENCE_THRESHOLD,
        device="cpu",
        verbose=False,
    )


    # --------------------------------------
    # Process detections
    # --------------------------------------

    for result in results:

        if result.boxes is None:
            continue

        for box in result.boxes:

            x1, y1, x2, y2 = box.xyxy[0].tolist()

            x1 = int(x1)
            y1 = int(y1)
            x2 = int(x2)
            y2 = int(y2)

            confidence = float(box.conf[0])


            # Draw plate bounding box
            cv2.rectangle(
                frame,
                (x1, y1),
                (x2, y2),
                (0, 255, 0),
                2,
            )


            # ----------------------------------
            # OCR only periodically
            # ----------------------------------

            current_time = time.time()

            if current_time - last_ocr_time >= OCR_INTERVAL:

                plate_crop = frame[y1:y2, x1:x2]

                if plate_crop.size > 0:

                    ocr_results = ocr.predict(
                        plate_crop
                    )


                    detected_text = []

                    for ocr_result in ocr_results:

                        data = ocr_result.json

                        texts = data["res"]["rec_texts"]
                        scores = data["res"]["rec_scores"]

                        for text, score in zip(
                            texts,
                            scores
                        ):

                            if score >= 0.50:
                                detected_text.append(text)


                    if detected_text:

                        last_plate_text = " ".join(
                            detected_text
                        )

                    else:

                        last_plate_text = "Unreadable"


                last_ocr_time = current_time


            # ----------------------------------
            # Display plate text
            # ----------------------------------

            cv2.putText(
                frame,
                last_plate_text,
                (x1, max(y1 - 10, 30)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2,
            )


    # ======================================
    # FPS calculation
    # ======================================

    fps_counter += 1

    elapsed = time.time() - fps_start

    if elapsed >= 1.0:

        fps = fps_counter / elapsed

        fps_counter = 0
        fps_start = time.time()


    cv2.putText(
        frame,
        f"FPS: {fps:.1f}",
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (0, 255, 0),
        2,
    )


    # ======================================
    # Display frame
    # ======================================

    cv2.imshow(
        "License Plate Recognition",
        frame
    )


    # Press X to exit
    key = cv2.waitKey(1) & 0xFF

    if key == ord("x"):
        break


# ==========================================
# Cleanup
# ==========================================

camera.release()
cv2.destroyAllWindows()

print("Camera stopped.")