from ultralytics import YOLO


def main():

    # Load the small pretrained YOLO model
    model = YOLO("yolo11n.pt")

    # Train on our smaller license-plate dataset
    model.train(
        data="dataset_small/data.yaml",

        # Start with 10 epochs
        epochs=10,

        # Image size
        imgsz=640,

        # Small batch size for CPU/RAM
        batch=4,

        # Use CPU
        device="cpu",

        # Avoid Windows multiprocessing issues
        workers=0,

        # Save results here
        project="runs",
        name="plate_detector_small",

        # Save checkpoints
        save=True,

        # Generate training plots
        plots=True
    )


if __name__ == "__main__":
    main()