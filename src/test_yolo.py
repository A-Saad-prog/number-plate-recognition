from ultralytics import YOLO


# Load a small pretrained YOLO model
model = YOLO("yolo11n.pt")

print("YOLO model loaded successfully.")