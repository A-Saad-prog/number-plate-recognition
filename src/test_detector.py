from ultralytics import YOLO
from pathlib import Path


# Load our trained license-plate detector
model = YOLO("runs/detect/runs/plate_detector_small/weights/best.pt")


# Pick an image from the test dataset
test_images = list(Path("dataset_small/test/images").glob("*.jpg"))

if not test_images:
    print("No test images found.")
    exit()


image = str(test_images[0])

print(f"Testing image: {image}")


# Run detection
results = model.predict(
    source=image,
    conf=0.25,
    save=True,
    device="cpu"
)


# Display detection information
for result in results:

    if result.boxes is None or len(result.boxes) == 0:
        print("No license plate detected.")
        continue

    print(f"Detected {len(result.boxes)} license plate(s).")

    for box in result.boxes:
        confidence = float(box.conf[0])

        print(f"Confidence: {confidence:.2f}")


print()
print("Result image saved by Ultralytics.")