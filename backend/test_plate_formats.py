import unittest
from app.services.plate_formats import classify_plate, normalize_plate

class PakistanPlateFormatTests(unittest.TestCase):
    def assertPlate(self, raw, expected):
        result = classify_plate(raw, 0.95)
        self.assertIsNotNone(result, raw)
        self.assertEqual(result["plate"], expected, raw)

    def test_core_formats(self):
        cases = {
            "AB123": "AB-123",
            "AB1234": "AB-1234",
            "ABC12": "ABC-12",
            "ABC123": "ABC-123",
            "ABC1234": "ABC-1234",
            "ABCD123": "ABCD-123",
            "L1234": "L-1234",
            "KH5708": "KH-5708",
            "GS123": "GS-123",
            "SP4567": "SP-4567",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertPlate(raw, expected)

    def test_decorative_text(self):
        cases = {
            "SINDH\nKMJ-9427\nKARACHI": "KMJ-9427",
            "AJK\nAB-123\nMIRPUR": "AB-123",
            "BALOCHISTAN\nQU-5678\nQUETTA": "QU-5678",
            "ICT-ISLAMABAD\nAB-123": "AB-123",
            "KP\nAB-1234\nPESHAWAR": "AB-1234",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertPlate(raw, expected)

    def test_short_region_token_can_be_real_plate(self):
        self.assertPlate("KP-3456", "KP-3456")

    def test_multiline_layouts(self):
        self.assertPlate("AB\n1234", "AB-1234")
        self.assertPlate("AA\nBB\n123", "AABB-123")
        self.assertPlate("ABC\n1234", "ABC-1234")

    def test_position_aware_ocr_correction(self):
        self.assertPlate("AB12O4", "AB-1204")
        self.assertPlate("0B1234", "OB-1234")
        self.assertPlate("KMJ94Z7", "KMJ-9427")

    def test_sindh_government(self):
        for raw in ("GS123", "GP123", "GL123", "HC123", "SP4567"):
            result = classify_plate("SINDH\n" + raw, 0.95)
            self.assertIsNotNone(result)
            self.assertEqual(result["province"], "Sindh")
            self.assertEqual(result["vehicle_type"], "government")

    def test_invalid(self):
        for raw in (
            "A12", "A123", "AB12", "ABC1", "12345",
            "123456", "ABCDE12345", "ABCDEF", "A1B2C3",
        ):
            with self.subTest(raw=raw):
                self.assertIsNone(classify_plate(raw, 0.95))

    def test_normalize(self):
        self.assertEqual(normalize_plate("KH 5708"), "KH-5708")


    def test_real_camera_concatenated_ocr(self):
        cases = [
            ("BALOCHISTANAB-1234", "AB-1234"),
            ("BALOCHSTANAB-1234", "AB-1234"),
            ("BALOCNSTANAB-1234", "AB-1234"),
            ("BALOCHISTANAB-1234QUETTA", "AB-1234"),
            ("SINDHKMJ9427KARACHI", "KMJ-9427"),
            ("PUNJABLER1234LAHORE", "LER-1234"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertPlate(raw, expected)

    def test_real_camera_spaced_ocr(self):
        self.assertPlate("AD 1234 PESHAWAR", "AD-1234")
        self.assertPlate("AD 1234 A PESHAWAR", "AD-1234")

    def test_correction_metadata(self):
        result = classify_plate("A8-1254", 0.71)
        self.assertIsNotNone(result)
        self.assertEqual(result["plate"], "AB-1254")
        self.assertLessEqual(result["corrections"], 1)

    def test_embedded_junk_does_not_create_numeric_plate(self):
        for raw in [
            "BALOCHISTAN12345QUETTA",
            "PUNJAB123456LAHORE",
            "SINDH12345KARACHI",
        ]:
            with self.subTest(raw=raw):
                self.assertIsNone(classify_plate(raw, 0.95))


    def test_unknown_long_alphanumeric_never_sliding_scans(self):
        for raw in [
            "ABCDE12345",
            "ZZZZZ12345",
            "RANDOMAB1234TEXT",
        ]:
            with self.subTest(raw=raw):
                self.assertIsNone(classify_plate(raw, 0.95))

    def test_decorative_suffix_cannot_become_plate_prefix(self):
        for raw in [
            "BALOCHISTAN12345QUETTA",
            "PUNJAB123456LAHORE",
            "SINDH12345KARACHI",
        ]:
            with self.subTest(raw=raw):
                self.assertIsNone(classify_plate(raw, 0.95))

if __name__ == "__main__":
    unittest.main()
