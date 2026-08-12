import os
import re
import requests

# Disable PaddlePaddle features that caused compatibility issues
os.environ["FLAGS_enable_pir_api"] = "0"

import cv2
import time
from collections import Counter

from ultralytics import YOLO
from paddleocr import PaddleOCR


# ============================================================
# Configuration
# ============================================================

CAMERA_INDEX = 0

FRAME_WIDTH = 640
FRAME_HEIGHT = 480

# Run YOLO every 3rd camera frame
FRAME_SKIP = 3

# Minimum YOLO confidence
CONFIDENCE_THRESHOLD = 0.40

# YOLO model
MODEL_PATH = "models/best.pt"

# Number of OCR readings required
OCR_READINGS_REQUIRED = 3

# Minimum OCR confidence
OCR_CONFIDENCE_THRESHOLD = 0.60

# Seconds before the system considers the vehicle gone
PLATE_LOST_TIMEOUT = 2.0

# FastAPI endpoint for detected plates
DETECTED_PLATE_API_URL = (
    "http://127.0.0.1:8000/parking/detected-plate"
)


# ============================================================
# License Plate Validation
# ============================================================

def is_valid_plate(text):
    text = text.upper().strip()

    # Remove spaces
    text = text.replace(" ", "")

    # Accept:
    # ABC-1234
    # ABC1234
    pattern = r"^[A-Z]{3}-?[0-9]{4}$"

    return bool(re.match(pattern, text))


# ============================================================
# Send Recognized Plate to FastAPI
# ============================================================

def send_detected_plate_to_backend(plate):
    try:

        response = requests.post(
            DETECTED_PLATE_API_URL,
            json={
                "license_plate": plate
            },
            timeout=2,
        )

        if response.status_code == 200:

            data = response.json()

            if data.get("success"):

                print()
                print("==============================")
                print("PLATE SENT TO BACKEND")
                print("==============================")
                print(
                    f"Plate: {data['license_plate']}"
                )
                print("==============================")
                print()

                return True

            print(
                f"Backend error: "
                f"{data.get('error')}"
            )

            return False

        print(
            f"Detected plate API returned HTTP "
            f"{response.status_code}"
        )

        return False

    except requests.exceptions.RequestException as error:

        print(
            f"Could not connect to FastAPI: "
            f"{error}"
        )

        return False


# ============================================================
# Load Models
# ============================================================

print("Loading YOLO...")

yolo = YOLO(MODEL_PATH)

print("YOLO loaded.")

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
# Camera
# ============================================================

camera = cv2.VideoCapture(CAMERA_INDEX)

camera.set(
    cv2.CAP_PROP_FRAME_WIDTH,
    FRAME_WIDTH
)

camera.set(
    cv2.CAP_PROP_FRAME_HEIGHT,
    FRAME_HEIGHT
)

if not camera.isOpened():

    print("Could not open camera.")

    exit()


actual_width = int(
    camera.get(cv2.CAP_PROP_FRAME_WIDTH)
)

actual_height = int(
    camera.get(cv2.CAP_PROP_FRAME_HEIGHT)
)

print()

print(
    f"Camera resolution: "
    f"{actual_width}x{actual_height}"
)

print("Press X to quit.")
print()


# ============================================================
# State
# ============================================================

frame_count = 0

last_boxes = []

last_plate_time = 0

ocr_results = []

recognized_plate = None

ocr_running = False


# ============================================================
# FPS
# ============================================================

fps_start = time.time()

processed_frames = 0

display_fps = 0


# ============================================================
# OCR Function
# ============================================================

def read_plate(plate_crop):

    print("Running OCR...")

    try:

        results = ocr.predict(
            plate_crop
        )

        texts = []

        scores = []


        # ====================================================
        # Extract OCR results
        # ====================================================

        for result in results:

            data = result.get(
                "rec_texts",
                []
            )

            confidence = result.get(
                "rec_scores",
                []
            )

            for text, score in zip(
                data,
                confidence
            ):

                if float(score) >= OCR_CONFIDENCE_THRESHOLD:

                    texts.append(
                        text.strip()
                    )

                    scores.append(
                        float(score)
                    )


        # ====================================================
        # No readable text
        # ====================================================

        if not texts:

            print(
                "OCR could not read plate."
            )

            return None


        # ====================================================
        # Select strongest OCR result
        # ====================================================

        best_index = scores.index(
            max(scores)
        )

        text = texts[best_index]

        confidence = scores[best_index]


        # ====================================================
        # Validate plate format
        # ====================================================

        if not is_valid_plate(text):

            print(
                f"OCR rejected: {text} "
                f"(does not look like a plate)"
            )

            return None


        # ====================================================
        # Valid plate
        # ====================================================

        print(
            f"OCR: {text} "
            f"(confidence: {confidence:.2f})"
        )

        return text


    except Exception as error:

        print(
            f"OCR error: {error}"
        )

        return None


# ============================================================
# Main Loop
# ============================================================

while True:

    success, frame = camera.read()

    if not success:

        print(
            "Could not read camera."
        )

        break


    frame_count += 1


    # ========================================================
    # YOLO Detection
    # ========================================================

    if frame_count % FRAME_SKIP == 0:

        results = yolo.predict(
            source=frame,
            conf=CONFIDENCE_THRESHOLD,
            device="cpu",
            verbose=False,
        )


        last_boxes = []


        for result in results:

            if result.boxes is None:

                continue


            for box in result.boxes:

                x1, y1, x2, y2 = (
                    box.xyxy[0].tolist()
                )

                confidence = float(
                    box.conf[0]
                )


                last_boxes.append(
                    (
                        int(x1),
                        int(y1),
                        int(x2),
                        int(y2),
                        confidence
                    )
                )


        # ====================================================
        # Plate Detected
        # ====================================================

        if last_boxes:

            last_plate_time = time.time()


            # Only run OCR if we do not
            # already have a recognized plate

            if (
                recognized_plate is None
                and not ocr_running
            ):

                x1, y1, x2, y2, confidence = (
                    last_boxes[0]
                )


                # Add a small margin around
                # the detected plate

                padding = 10


                x1 = max(
                    0,
                    x1 - padding
                )

                y1 = max(
                    0,
                    y1 - padding
                )

                x2 = min(
                    actual_width,
                    x2 + padding
                )

                y2 = min(
                    actual_height,
                    y2 + padding
                )


                plate_crop = frame[
                    y1:y2,
                    x1:x2
                ]


                if plate_crop.size > 0:

                    ocr_running = True


                    # ========================================
                    # Clear old OCR readings
                    # ========================================

                    ocr_results = []


                    # ========================================
                    # Collect multiple OCR readings
                    # ========================================

                    for _ in range(
                        OCR_READINGS_REQUIRED
                    ):

                        result = read_plate(
                            plate_crop
                        )


                        if result:

                            ocr_results.append(
                                result
                            )


                    ocr_running = False


                    # ========================================
                    # Determine final plate
                    # ========================================

                    if ocr_results:

                        counts = Counter(
                            ocr_results
                        )


                        recognized_plate = (
                            counts.most_common(1)[0][0]
                        )


                        print()

                        print(
                            "=============================="
                        )

                        print(
                            f"RECOGNIZED PLATE: "
                            f"{recognized_plate}"
                        )

                        print(
                            "=============================="
                        )

                        print()


                        # ====================================
                        # Send detected plate to FastAPI
                        #
                        # IMPORTANT:
                        # This does NOT create a parking entry.
                        # It only tells FastAPI what the camera
                        # detected.
                        # ====================================

                        send_detected_plate_to_backend(
                            recognized_plate
                        )


    # ========================================================
    # Check Whether Vehicle Disappeared
    # ========================================================

    if (
        recognized_plate is not None
        and time.time() - last_plate_time
        > PLATE_LOST_TIMEOUT
    ):

        print(
            f"Vehicle left camera: "
            f"{recognized_plate}"
        )


        # Reset the system so the next
        # vehicle can be recognized

        recognized_plate = None

        ocr_results = []

        last_boxes = []


    # ========================================================
    # Draw YOLO Detections
    # ========================================================

    for (
        x1,
        y1,
        x2,
        y2,
        confidence
    ) in last_boxes:

        cv2.rectangle(
            frame,
            (x1, y1),
            (x2, y2),
            (0, 255, 0),
            2
        )


        label = (
            f"Plate "
            f"{confidence:.2f}"
        )


        cv2.putText(
            frame,
            label,
            (
                x1,
                max(y1 - 10, 20)
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2
        )


    # ========================================================
    # Display Recognized Plate
    # ========================================================

    if recognized_plate:

        cv2.putText(
            frame,
            f"PLATE: {recognized_plate}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 255, 0),
            3
        )

    elif ocr_running:

        cv2.putText(
            frame,
            "READING PLATE...",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 255),
            2
        )

    else:

        cv2.putText(
            frame,
            "SEARCHING...",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 255),
            2
        )


    # ========================================================
    # FPS
    # ========================================================

    processed_frames += 1

    elapsed = (
        time.time()
        - fps_start
    )


    if elapsed >= 1:

        display_fps = (
            processed_frames
            / elapsed
        )

        processed_frames = 0

        fps_start = time.time()


    cv2.putText(
        frame,
        f"FPS: {display_fps:.1f}",
        (20, 75),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )


    # ========================================================
    # Display
    # ========================================================

    cv2.imshow(
        "License Plate Recognition",
        frame
    )


    # ========================================================
    # Exit
    # ========================================================

    if (
        cv2.waitKey(1) & 0xFF
        == ord("x")
    ):

        break


# ============================================================
# Cleanup
# ============================================================

camera.release()

cv2.destroyAllWindows()

print("Camera stopped.")