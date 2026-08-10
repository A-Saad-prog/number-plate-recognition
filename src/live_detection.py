import cv2
import time
from ultralytics import YOLO


# ==========================================
# Configuration
# ==========================================

CAMERA_INDEX = 0

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720

# Process every 3rd camera frame.
# Your camera is around 30 FPS, while YOLO
# currently takes about 100 ms per inference.
FRAME_SKIP = 3

# Minimum confidence required to display a detection
CONFIDENCE_THRESHOLD = 0.40

# Path to our trained model
MODEL_PATH = "runs/detect/runs/plate_detector_small/weights/best.pt"


# ==========================================
# Load YOLO model
# ==========================================

print("Loading license-plate detector...")

model = YOLO(MODEL_PATH)

print("Model loaded.")


# ==========================================
# Open camera
# ==========================================

camera = cv2.VideoCapture(CAMERA_INDEX)

if not camera.isOpened():
    print("Error: Could not open camera.")
    exit()


camera.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)


actual_width = int(camera.get(cv2.CAP_PROP_FRAME_WIDTH))
actual_height = int(camera.get(cv2.CAP_PROP_FRAME_HEIGHT))


print(f"Camera resolution: {actual_width} x {actual_height}")
print("Press 'q' to quit.")


# ==========================================
# FPS variables
# ==========================================

frame_count = 0
detection_count = 0

fps_start_time = time.time()
display_fps = 0


# Store the most recent detection
last_boxes = []


# ==========================================
# Main loop
# ==========================================

while True:

    success, frame = camera.read()

    if not success:
        print("Error: Could not read camera frame.")
        break

    frame_count += 1


    # ======================================
    # Run YOLO every Nth frame
    # ======================================

    if frame_count % FRAME_SKIP == 0:

        results = model.predict(
            source=frame,
            conf=CONFIDENCE_THRESHOLD,
            device="cpu",
            verbose=False
        )

        last_boxes = []

        for result in results:

            if result.boxes is None:
                continue

            for box in result.boxes:

                x1, y1, x2, y2 = box.xyxy[0].tolist()

                confidence = float(box.conf[0])

                last_boxes.append(
                    (
                        int(x1),
                        int(y1),
                        int(x2),
                        int(y2),
                        confidence
                    )
                )

        detection_count += 1


    # ======================================
    # Draw the most recent detections
    # ======================================

    for x1, y1, x2, y2, confidence in last_boxes:

        cv2.rectangle(
            frame,
            (x1, y1),
            (x2, y2),
            (0, 255, 0),
            2
        )

        label = f"License Plate {confidence:.2f}"

        cv2.putText(
            frame,
            label,
            (x1, max(y1 - 10, 20)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2
        )


    # ======================================
    # Calculate detection FPS
    # ======================================

    current_time = time.time()

    elapsed = current_time - fps_start_time

    if elapsed >= 1.0:

        display_fps = detection_count / elapsed

        detection_count = 0
        fps_start_time = current_time


    # ======================================
    # Display information
    # ======================================

    cv2.putText(
        frame,
        f"Detection FPS: {display_fps:.1f}",
        (20, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )

    cv2.putText(
        frame,
        f"Frame Skip: {FRAME_SKIP}",
        (20, 60),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )

    cv2.putText(
        frame,
        f"Resolution: {actual_width}x{actual_height}",
        (20, 90),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )


    # ======================================
    # Display camera
    # ======================================

    cv2.imshow(
        "Live License Plate Detection",
        frame
    )


    # ======================================
    # Quit
    # ======================================

    if cv2.waitKey(1) & 0xFF == ord("x"):
        break


# ==========================================
# Cleanup
# ==========================================

camera.release()
cv2.destroyAllWindows()

print("Camera stopped.")