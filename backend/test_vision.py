import base64

from app.services.plate_recognition import detect_plate


IMAGE_PATH = "test_plate.jpg"


with open(IMAGE_PATH, "rb") as file:
    image_base64 = base64.b64encode(
        file.read()
    ).decode("utf-8")


result = detect_plate(
    image_base64
)


print()
print("==============================")
print("VISION TEST RESULT")
print("==============================")
print(f"Detected: {result['detected']}")
print(f"Plate: {result['license_plate']}")
print(f"Confidence: {result['confidence']:.2f}")
print(f"Box: {result['box']}")
print("==============================")