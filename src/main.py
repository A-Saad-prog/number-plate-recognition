import cv2
import time


# ==============================
# Camera configuration
# ==============================

CAMERA_INDEX = 0

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720

# Number of frames we want the camera to capture per second
TARGET_FPS = 15

# Process every Nth frame
# 1 = every frame
# 2 = every second frame
# 3 = every third frame
FRAME_SKIP = 1


# ==============================
# Open camera
# ==============================

camera = cv2.VideoCapture(CAMERA_INDEX)

if not camera.isOpened():
    print("Error: Could not open camera.")
    exit()


# Try to set the camera resolution
camera.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)

# Try to set the camera FPS
camera.set(cv2.CAP_PROP_FPS, TARGET_FPS)


# Get the actual values accepted by the camera
actual_width = int(camera.get(cv2.CAP_PROP_FRAME_WIDTH))
actual_height = int(camera.get(cv2.CAP_PROP_FRAME_HEIGHT))
actual_fps = camera.get(cv2.CAP_PROP_FPS)


print("Camera started.")
print(f"Resolution: {actual_width} x {actual_height}")
print(f"Camera FPS: {actual_fps}")
print(f"Frame skip: {FRAME_SKIP}")
print("Press 'x' to quit.")


# ==============================
# FPS measurement variables
# ==============================

frame_count = 0
processed_frames = 0

start_time = time.time()
fps_start_time = start_time

display_fps = 0


# ==============================
# Main loop
# ==============================

while True:

    success, frame = camera.read()

    if not success:
        print("Error: Could not read frame.")
        break

    frame_count += 1

    # --------------------------------
    # Frame skipping
    # --------------------------------

    if frame_count % FRAME_SKIP == 0:

        # This is where our computer-vision
        # processing will eventually happen.

        processed_frames += 1

    # --------------------------------
    # Calculate processing FPS
    # --------------------------------

    current_time = time.time()
    elapsed = current_time - fps_start_time

    if elapsed >= 1.0:

        display_fps = processed_frames / elapsed

        processed_frames = 0
        fps_start_time = current_time

    # --------------------------------
    # Display information
    # --------------------------------

    cv2.putText(
        frame,
        f"Resolution: {actual_width}x{actual_height}",
        (20, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )

    cv2.putText(
        frame,
        f"Camera FPS: {actual_fps:.1f}",
        (20, 60),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )

    cv2.putText(
        frame,
        f"Processing FPS: {display_fps:.1f}",
        (20, 90),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )

    cv2.putText(
        frame,
        f"Frame Skip: {FRAME_SKIP}",
        (20, 120),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 0),
        2
    )

    cv2.imshow("Number Plate Recognition", frame)

    # Press x to quit
    if cv2.waitKey(1) & 0xFF == ord("x"):
        break


# ==============================
# Cleanup
# ==============================

camera.release()
cv2.destroyAllWindows()

print("Camera stopped.")