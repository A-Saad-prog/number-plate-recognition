import unittest

import cv2
import numpy as np

from app.api.vision import (
    _exclude_decorative_left_panel,
    _exclude_top_row_year,
    _prepare_two_line_plate,
)
from app.services.plate_formats import classify_plate


def _blank(width, height, color=(255, 255, 255)):
    canvas = np.full((height, width, 3), color, dtype=np.uint8)
    return canvas


def _draw_text(canvas, text, x, y, scale, thickness=3, color=(0, 0, 0)):
    cv2.putText(
        canvas,
        text,
        (x, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        color,
        thickness,
        cv2.LINE_AA,
    )


def _legacy_two_line_plate(prefix="LER", year="20", bottom="1234", with_green_strip=True):
    """Build a synthetic legacy Punjab-style two-line plate crop:
    [ green strip ] PREFIX - YEAR
                    BOTTOM
    """
    width, height = 220, 170
    canvas = _blank(width, height)

    strip_w = int(width * 0.22)
    if with_green_strip:
        canvas[:, :strip_w] = (60, 200, 60)  # BGR-ish green

    text_x0 = strip_w + 10 if with_green_strip else 10

    # Top row: main prefix (large) + small isolated year at far right.
    _draw_text(canvas, prefix, text_x0, 65, 1.1, thickness=3)
    _draw_text(canvas, year, width - 35, 45, 0.5, thickness=2)

    # Bottom row: large registration digits, spanning most of the width.
    _draw_text(canvas, bottom, text_x0, 140, 1.1, thickness=3)

    return canvas


def _normal_two_line_plate(prefix="AB", bottom="123"):
    """A normal two-line plate with no year token and no decorative strip."""
    width, height = 160, 170
    canvas = _blank(width, height)
    _draw_text(canvas, prefix, 20, 65, 1.2, thickness=3)
    _draw_text(canvas, bottom, 20, 140, 1.2, thickness=3)
    return canvas


class DecorativeStripTests(unittest.TestCase):
    def test_removes_confident_left_green_strip(self):
        plate = _legacy_two_line_plate(with_green_strip=True)
        trimmed, removed, meta = _exclude_decorative_left_panel(plate)
        self.assertTrue(removed, meta)
        self.assertLess(trimmed.shape[1], plate.shape[1])

    def test_leaves_plate_without_green_strip_untouched(self):
        plate = _legacy_two_line_plate(with_green_strip=False)
        trimmed, removed, meta = _exclude_decorative_left_panel(plate)
        self.assertFalse(removed, meta)
        self.assertEqual(trimmed.shape, plate.shape)

    def test_leaves_normal_plate_untouched(self):
        plate = _normal_two_line_plate()
        trimmed, removed, meta = _exclude_decorative_left_panel(plate)
        self.assertFalse(removed, meta)
        np.testing.assert_array_equal(trimmed, plate)


class TopRowYearExclusionTests(unittest.TestCase):
    def _top_row(self, plate):
        gray = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY)
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 9
        )
        row_ink = np.count_nonzero(binary, axis=1)
        height = plate.shape[0]
        start, end = int(height * 0.28), int(height * 0.72)
        split_y = int(np.argmin(row_ink[start:end])) + start
        return plate[:split_y, :]

    def test_excludes_isolated_year_cluster(self):
        plate = _legacy_two_line_plate(with_green_strip=False)
        top = self._top_row(plate)
        trimmed, ignored, meta = _exclude_top_row_year(top)
        self.assertTrue(ignored, meta)
        self.assertLess(trimmed.shape[1], top.shape[1])

    def test_does_not_touch_top_row_without_isolated_second_cluster(self):
        plate = _normal_two_line_plate()
        top = self._top_row(plate)
        trimmed, ignored, meta = _exclude_top_row_year(top)
        self.assertFalse(ignored, meta)
        np.testing.assert_array_equal(trimmed, top)


class PrepareTwoLinePlateEndToEndTests(unittest.TestCase):
    def test_legacy_punjab_layout_produces_registration_only_candidate(self):
        plate = _legacy_two_line_plate(prefix="LER", year="20", bottom="1234")
        combined, meta = _prepare_two_line_plate(plate)
        self.assertTrue(meta.get("rearranged"), meta)
        self.assertTrue(meta.get("decorative_strip_removed"), meta)
        self.assertTrue(meta.get("year_region_ignored"), meta)
        # Combined image must be narrower than a naive top+bottom stitch would be
        # (i.e. the "20" and the green strip contributed no width).
        self.assertLess(combined.shape[1], plate.shape[1] * 2)

    def test_legacy_layout_generalizes_to_different_letters_and_digits(self):
        plate = _legacy_two_line_plate(prefix="ABC", year="21", bottom="5678")
        combined, meta = _prepare_two_line_plate(plate)
        self.assertTrue(meta.get("rearranged"), meta)
        self.assertTrue(meta.get("year_region_ignored"), meta)

    def test_normal_two_line_plate_path_is_unchanged(self):
        plate = _normal_two_line_plate(prefix="AB", bottom="123")
        combined, meta = _prepare_two_line_plate(plate)
        # Whatever the outcome, no decorative/year logic should have fired.
        self.assertFalse(meta.get("decorative_strip_removed", False), meta)
        self.assertFalse(meta.get("year_region_ignored", False), meta)

    def test_single_line_plate_bypasses_two_line_path_entirely(self):
        wide = _blank(400, 100)
        _draw_text(wide, "ABC1234", 10, 65, 1.6, thickness=4)
        result, meta = _prepare_two_line_plate(wide)
        self.assertFalse(meta.get("rearranged"))
        self.assertEqual(meta.get("reason"), "wide_single_line")
        np.testing.assert_array_equal(result, wide)

    def test_uncertain_geometry_falls_back_to_existing_behavior(self):
        # A crop with continuous ink/contrast across every row (no clean
        # horizontal gap between "lines") must not be forced through the
        # two-line rearrangement.
        width, height = 160, 170
        canvas = _blank(width, height)
        # Fine checkerboard gives local contrast on every row (unlike a
        # solid block, whose flat interior adaptive-thresholds to nothing).
        block = 6
        for y in range(0, height, block):
            for x in range(0, width, block):
                if ((x // block) + (y // block)) % 2 == 0:
                    cv2.rectangle(canvas, (x, y), (x + block, y + block), (0, 0, 0), -1)
        result, meta = _prepare_two_line_plate(canvas)
        self.assertFalse(meta.get("rearranged"), meta)
        np.testing.assert_array_equal(result, canvas)


class ClassifyPlateStillResolvesPrefixDashDigits(unittest.TestCase):
    def test_ler1234_resolves_to_dashed_punjab_format(self):
        result = classify_plate("LER1234", 0.9)
        self.assertIsNotNone(result)
        self.assertEqual(result["plate"], "LER-1234")

    def test_abc5678_resolves_to_dashed_punjab_format(self):
        result = classify_plate("ABC5678", 0.9)
        self.assertIsNotNone(result)
        self.assertEqual(result["plate"], "ABC-5678")


if __name__ == "__main__":
    unittest.main()
