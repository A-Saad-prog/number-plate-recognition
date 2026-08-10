import random
import shutil
from pathlib import Path


# ==========================================
# Configuration
# ==========================================

SOURCE_DATASET = Path("dataset")
OUTPUT_DATASET = Path("dataset_small")

NUMBER_OF_TRAIN_IMAGES = 1000

RANDOM_SEED = 42


# ==========================================
# Helper function
# ==========================================

def copy_image_and_label(image_path, source_labels, output_images, output_labels):
    """
    Copy an image and its corresponding YOLO label.
    """

    label_path = source_labels / f"{image_path.stem}.txt"

    # Make sure the annotation exists
    if not label_path.exists():
        return False

    shutil.copy2(
        image_path,
        output_images / image_path.name
    )

    shutil.copy2(
        label_path,
        output_labels / label_path.name
    )

    return True


# ==========================================
# Create directories
# ==========================================

train_images_source = SOURCE_DATASET / "train" / "images"
train_labels_source = SOURCE_DATASET / "train" / "labels"

train_images_output = OUTPUT_DATASET / "train" / "images"
train_labels_output = OUTPUT_DATASET / "train" / "labels"

valid_images_source = SOURCE_DATASET / "valid" / "images"
valid_labels_source = SOURCE_DATASET / "valid" / "labels"

valid_images_output = OUTPUT_DATASET / "valid" / "images"
valid_labels_output = OUTPUT_DATASET / "valid" / "labels"

test_images_source = SOURCE_DATASET / "test" / "images"
test_labels_source = SOURCE_DATASET / "test" / "labels"

test_images_output = OUTPUT_DATASET / "test" / "images"
test_labels_output = OUTPUT_DATASET / "test" / "labels"


for directory in [
    train_images_output,
    train_labels_output,
    valid_images_output,
    valid_labels_output,
    test_images_output,
    test_labels_output,
]:
    directory.mkdir(parents=True, exist_ok=True)


# ==========================================
# Select training images
# ==========================================

random.seed(RANDOM_SEED)

all_training_images = list(train_images_source.glob("*.jpg"))

random.shuffle(all_training_images)

selected_images = all_training_images[:NUMBER_OF_TRAIN_IMAGES]


# ==========================================
# Copy training images
# ==========================================

copied_training = 0

for image_path in selected_images:

    success = copy_image_and_label(
        image_path,
        train_labels_source,
        train_images_output,
        train_labels_output
    )

    if success:
        copied_training += 1


# ==========================================
# Copy validation set
# ==========================================

copied_validation = 0

for image_path in valid_images_source.glob("*.jpg"):

    success = copy_image_and_label(
        image_path,
        valid_labels_source,
        valid_images_output,
        valid_labels_output
    )

    if success:
        copied_validation += 1


# ==========================================
# Copy test set
# ==========================================

copied_test = 0

for image_path in test_images_source.glob("*.jpg"):

    success = copy_image_and_label(
        image_path,
        test_labels_source,
        test_images_output,
        test_labels_output
    )

    if success:
        copied_test += 1


# ==========================================
# Create data.yaml
# ==========================================

data_yaml = """train: train/images
val: valid/images
test: test/images

nc: 1
names: ['License_Plate']
"""

with open(OUTPUT_DATASET / "data.yaml", "w") as file:
    file.write(data_yaml)


# ==========================================
# Summary
# ==========================================

print("Small dataset created successfully.")
print()
print(f"Training images:   {copied_training}")
print(f"Validation images: {copied_validation}")
print(f"Test images:       {copied_test}")
print()
print(f"Location: {OUTPUT_DATASET}")