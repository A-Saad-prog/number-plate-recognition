import cv2
import time

from app.vision.plate_tracker import (
    LicensePlateRecognizer,
)


# ============================================================
# Camera configuration
# ============================================================

CAMERA_INDEX = 0

FRAME_WIDTH = 640
FRAME_HEIGHT = 480


# ============================================================
# Initialize recognizer
# ============================================================

recognizer = LicensePlateRecognizer()


# ============================================================
# Initialize camera
# ============================================================

camera = cv2.VideoCapture(
    CAMERA_INDEX
)


camera.set(
    cv2.CAP_PROP_FRAME_WIDTH,
    FRAME_WIDTH
)

camera.set(
    cv2.CAP_PROP_FRAME_HEIGHT,
    FRAME_HEIGHT
)


if not camera.isOpened():

    print(
        "Could not open camera."
    )

    raise SystemExit(1)


actual_width = int(
    camera.get(
        cv2.CAP_PROP_FRAME_WIDTH
    )
)

actual_height = int(
    camera.get(
        cv2.CAP_PROP_FRAME_HEIGHT
    )
)


print()

print(
    f"Camera resolution: "
    f"{actual_width}x{actual_height}"
)

print(
    "Press X to quit."
)

print()


# ============================================================
# FPS
# ============================================================

fps_start = time.time()

processed_frames = 0

display_fps = 0


# ============================================================
# Main loop
# ============================================================

while True:

    success, frame = camera.read()


    if not success:

        print(
            "Could not read camera."
        )

        break


    # --------------------------------------------------------
    # Process frame
    # --------------------------------------------------------

    result = recognizer.process_frame(
        frame
    )


    # --------------------------------------------------------
    # Draw YOLO/OCR information
    # --------------------------------------------------------

    frame = recognizer.draw_detections(
        frame,
        result,
    )


    # --------------------------------------------------------
    # FPS
    # --------------------------------------------------------

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
        2,
    )


    # --------------------------------------------------------
    # Display
    # --------------------------------------------------------

    cv2.imshow(
        "License Plate Recognition",
        frame,
    )


    # --------------------------------------------------------
    # Exit
    # --------------------------------------------------------

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

print(
    "Camera stopped."
)