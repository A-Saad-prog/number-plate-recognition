import re
from difflib import SequenceMatcher
from itertools import product

PLATE_FORMATS = {
    "AJK": {
        "car": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "motorcycle": [("AAAA999", r"^[A-Z]{4}[0-9]{3}$")],
        "public_transport": [("AAAA999", r"^[A-Z]{4}[0-9]{3}$")],
        "government": [("AAAA999", r"^[A-Z]{4}[0-9]{3}$")],
    },
    "Balochistan": {
        "car": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "motorcycle": [("AA9999", r"^[A-Z]{2}[0-9]{4}$")],
        "public_transport": [("AA9999", r"^[A-Z]{2}[0-9]{4}$")],
        "government": [("AAAA999", r"^[A-Z]{4}[0-9]{3}$")],
    },
    "Gilgit-Baltistan": {
        "car": [("AAA99", r"^[A-Z]{3}[0-9]{2}$")],
    },
    "Islamabad": {
        "car": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "motorcycle": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "public_transport": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
    },
    "Khyber Pakhtunkhwa": {
        "car": [("AA9999", r"^[A-Z]{2}[0-9]{4}$")],
        "motorcycle": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "public_transport": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
        "government": [("AA999", r"^[A-Z]{2}[0-9]{3}$")],
    },
    "Punjab": {
        "car": [
            ("AA999", r"^[A-Z]{2}[0-9]{3}$"),
            ("A9999", r"^[A-Z][0-9]{4}$"),
            ("AA9999", r"^[A-Z]{2}[0-9]{4}$"),
            ("AAA9999", r"^[A-Z]{3}[0-9]{4}$"),
        ],
        "motorcycle": [
            ("AAA9999", r"^[A-Z]{3}[0-9]{4}$"),
            ("AA9999", r"^[A-Z]{2}[0-9]{4}$"),
            ("A9999", r"^[A-Z][0-9]{4}$"),
        ],
        "public_transport": [("AAA999", r"^[A-Z]{3}[0-9]{3}$")],
    },
    "Sindh": {
        "government": [("SINDH_GOV", r"^(?:GS|GP|GL|HC|SP)[0-9]{1,4}$")],
        "car": [
            ("AAA999", r"^[A-Z]{3}[0-9]{3}$"),
            ("AAA9999", r"^[A-Z]{3}[0-9]{4}$"),
        ],
        "motorcycle": [("AAA9999", r"^[A-Z]{3}[0-9]{4}$")],
        "public_transport": [("AA9999", r"^[A-Z]{2}[0-9]{4}$")],
    },
}

GENERIC_PLATE_FORMATS = [
    ("SINDH_GOV", r"^(?:GS|GP|GL|HC|SP)[0-9]{1,4}$"),
    ("AA999", r"^[A-Z]{2}[0-9]{3}$"),
    ("AA9999", r"^[A-Z]{2}[0-9]{4}$"),
    ("AAA99", r"^[A-Z]{3}[0-9]{2}$"),
    ("AAA999", r"^[A-Z]{3}[0-9]{3}$"),
    ("AAA9999", r"^[A-Z]{3}[0-9]{4}$"),
    ("AAAA999", r"^[A-Z]{4}[0-9]{3}$"),
    ("A9999", r"^[A-Z][0-9]{4}$"),
]

PLATE_PROVINCES = {
    "AZADJAMMUKASHMIR": "AJK",
    "AZADJAMMUANDKASHMIR": "AJK",
    "AJK": "AJK",
    "AJ&K": "AJK",
    "BALOCHISTAN": "Balochistan",
    "GILGITBALTISTAN": "Gilgit-Baltistan",
    "GB": "Gilgit-Baltistan",
    "ISLAMABAD": "Islamabad",
    "ICTISLAMABAD": "Islamabad",
    "ICT": "Islamabad",
    "KHYBERPAKHTUNKHWA": "Khyber Pakhtunkhwa",
    "KPK": "Khyber Pakhtunkhwa",
    "KP": "Khyber Pakhtunkhwa",
    "PUNJAB": "Punjab",
    "SINDH": "Sindh",
}

FUZZY_PROVINCE_LABELS = {
    "BALOCHISTAN": "Balochistan",
    "GILGITBALTISTAN": "Gilgit-Baltistan",
    "ISLAMABAD": "Islamabad",
    "KHYBERPAKHTUNKHWA": "Khyber Pakhtunkhwa",
    "PUNJAB": "Punjab",
    "SINDH": "Sindh",
    "AZADJAMMUKASHMIR": "AJK",
}

LONG_DECORATIVE_LABELS = {
    "BALOCHISTAN", "GILGITBALTISTAN", "ISLAMABAD",
    "KHYBERPAKHTUNKHWA", "PUNJAB", "SINDH",
    "AZADJAMMUKASHMIR", "AZADJAMMUANDKASHMIR",
    "MIRPUR", "PESHAWAR", "QUETTA", "LAHORE", "KARACHI",
    "MUZAFFARABAD", "RAWALPINDI", "FAISALABAD", "MULTAN",
    "GUJRANWALA", "SIALKOT", "HYDERABAD", "SUKKUR",
    "ABBOTTABAD", "GILGIT", "SKARDU", "CHITRAL", "BAHAWALPUR",
}

LETTER_TO_DIGIT = {
    "O": "0", "I": "1", "L": "1", "Z": "2",
    "S": "5", "G": "6", "B": "8",
}
DIGIT_TO_LETTERS = {
    "0": ("O",), "1": ("I", "L"), "2": ("Z",),
    "5": ("S",), "6": ("G",), "8": ("B",),
}

def _compact(value):
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())

def _province_key(value):
    return re.sub(r"[^A-Z0-9&]", "", (value or "").upper())

def _best_fuzzy_prefix_length(value, label, threshold=0.72):
    value = _compact(value)
    label = _compact(label)
    best = None
    for size in range(max(4, len(label) - 2), min(len(value), len(label) + 2) + 1):
        ratio = SequenceMatcher(None, value[:size], label).ratio()
        if ratio >= threshold and (best is None or ratio > best[0]):
            best = (ratio, size)
    return best[1] if best else 0

def _fuzzy_contains(text, label, threshold=0.74):
    text = _compact(text)
    label = _compact(label)
    if label in text:
        return True
    minimum = max(4, len(label) - 2)
    maximum = min(len(text), len(label) + 2)
    for size in range(minimum, maximum + 1):
        for start in range(0, len(text) - size + 1):
            if SequenceMatcher(None, text[start:start + size], label).ratio() >= threshold:
                return True
    return False

def _plate_province(raw_text):
    raw_upper = (raw_text or "").upper()

    for line in raw_upper.splitlines():
        key = _province_key(line)
        if key in PLATE_PROVINCES:
            return PLATE_PROVINCES[key]

        for label, province in sorted(
            PLATE_PROVINCES.items(),
            key=lambda item: -len(_province_key(item[0]))
        ):
            label_key = _province_key(label)
            if len(label_key) >= 4 and label_key in key:
                return province

    compact = _compact(raw_upper)
    for label, province in sorted(
        FUZZY_PROVINCE_LABELS.items(),
        key=lambda item: -len(item[0])
    ):
        if _fuzzy_contains(compact, label):
            return province

    return None

def _strip_decorative_from_long(value, province):
    value = _compact(value)
    if len(value) <= 7:
        return value

    original = value

    # Exact long labels can be removed safely; short tokens such as KP/AJK/ICT
    # are intentionally not included because they can be genuine plate prefixes.
    for label in sorted(LONG_DECORATIVE_LABELS, key=len, reverse=True):
        value = value.replace(_compact(label), "")

    # Real OCR often misspells a long province label by 1-2 characters.
    # Only strip a fuzzy label from the START, where province text is printed.
    if province:
        province_labels = [
            label for label, mapped in FUZZY_PROVINCE_LABELS.items()
            if mapped == province
        ]
        for label in sorted(province_labels, key=len, reverse=True):
            prefix_len = _best_fuzzy_prefix_length(value, label)
            if prefix_len:
                value = value[prefix_len:]
                break

        # If exact-removal already changed the string, also try the original
        # for fuzzy province prefix to handle BALOCHSTAN / BALOCNSTAN.
        if value == original:
            for label in sorted(province_labels, key=len, reverse=True):
                prefix_len = _best_fuzzy_prefix_length(original, label)
                if prefix_len:
                    value = original[prefix_len:]
                    break

    # Remove exact long city/location labels once more after fuzzy prefix strip.
    for label in sorted(LONG_DECORATIVE_LABELS, key=len, reverse=True):
        value = value.replace(_compact(label), "")

    return value

def _candidate_strings(raw_text, province):
    raw_upper = (raw_text or "").upper()
    tokens = re.findall(r"[A-Z0-9]+", raw_upper)
    candidates = []

    def add(value, source_rank=0):
        value = _compact(value)
        if 5 <= len(value) <= 7:
            item = (value, source_rank)
            if item not in candidates:
                candidates.append(item)

    # Normal OCR: full lines/tokens.
    for line in raw_upper.splitlines():
        add(line, 0)
    for token in tokens:
        add(token, 0)

    # Multiline plates: combine adjacent tokens only.
    for start in range(len(tokens)):
        combined = ""
        windows = []
        for end in range(start, min(len(tokens), start + 4)):
            combined += tokens[end]
            if len(combined) > 7:
                break
            if 5 <= len(combined) <= 7:
                windows.append(combined)
        for value in sorted(windows, key=len, reverse=True):
            add(value, 1)

    # Long concatenated OCR is NOT sliding-window scanned.
    # First strip trusted decorative labels; only validate the exact remainder.
    long_values = [_compact(line) for line in raw_upper.splitlines()]
    long_values += [_compact(token) for token in tokens]
    for value in long_values:
        if len(value) <= 7:
            continue
        cleaned = _strip_decorative_from_long(value, province)
        add(cleaned, 2)

    return candidates

def _template_for(format_name, value):
    if format_name == "SINDH_GOV":
        return "AA" + ("9" * (len(value) - 2)) if len(value) >= 3 else None
    return format_name

def _correct_variants(value, format_name, limit=16):
    value = _compact(value)
    template = _template_for(format_name, value)
    if not template or len(value) != len(template):
        return [(value, 0)]

    if template.count("A") and not any(ch.isalpha() for ch in value):
        return [(value, 0)]

    choices = []
    for character, expected in zip(value, template):
        options = [(character, 0)]
        if expected == "9" and character.isalpha() and character in LETTER_TO_DIGIT:
            options = [(LETTER_TO_DIGIT[character], 1)]
        elif expected == "A" and character.isdigit() and character in DIGIT_TO_LETTERS:
            options = [(letter, 1) for letter in DIGIT_TO_LETTERS[character]]
        choices.append(options)

    variants = []
    for parts in product(*choices):
        candidate = "".join(part[0] for part in parts)
        corrections = sum(part[1] for part in parts)
        item = (candidate, corrections)
        if item not in variants:
            variants.append(item)
        if len(variants) >= limit:
            break
    return variants or [(value, 0)]

def _display_plate(value):
    match = re.fullmatch(r"([A-Z]+)([0-9]+)", value)
    return f"{match.group(1)}-{match.group(2)}" if match else value

def _matching_options(province):
    if province and province in PLATE_FORMATS:
        return [
            (vehicle_type, format_name, pattern)
            for vehicle_type, formats in PLATE_FORMATS[province].items()
            for format_name, pattern in formats
        ]
    return [
        ("unknown", format_name, pattern)
        for format_name, pattern in GENERIC_PLATE_FORMATS
    ]

def _raw_shape_score(raw_candidate, format_name):
    value = _compact(raw_candidate)
    template = _template_for(format_name, value)
    if not template or len(value) != len(template):
        return 999

    score = 0
    for ch, expected in zip(value, template):
        if expected == "A":
            if ch.isalpha():
                continue
            score += 1 if ch in DIGIT_TO_LETTERS else 10
        elif expected == "9":
            if ch.isdigit():
                continue
            score += 1 if ch in LETTER_TO_DIGIT else 10
    return score

def classify_plate(text, confidence=0.0):
    raw_text = text or ""
    province = _plate_province(raw_text)
    candidates = _candidate_strings(raw_text, province)

    option_groups = [_matching_options(province)]
    if province:
        option_groups.append(_matching_options(None))

    matches = []

    for group_index, options in enumerate(option_groups):
        for candidate_index, (candidate, source_rank) in enumerate(candidates):
            for option_index, (vehicle_type, format_name, pattern) in enumerate(options):
                for normalized, corrections in _correct_variants(candidate, format_name):
                    if not re.fullmatch(pattern, normalized):
                        continue

                    resolved_province = province or "unknown"
                    resolved_vehicle_type = vehicle_type

                    if format_name == "SINDH_GOV":
                        resolved_province = "Sindh"
                        resolved_vehicle_type = "government"

                    matches.append((
                        group_index,
                        corrections,
                        _raw_shape_score(candidate, format_name),
                        source_rank,
                        candidate_index,
                        option_index,
                        {
                            "raw_text": raw_text,
                            "plate": _display_plate(normalized),
                            "province": resolved_province,
                            "vehicle_type": resolved_vehicle_type,
                            "format": format_name,
                            "confidence": round(max(0.0, min(1.0, float(confidence))), 4),
                            "corrections": corrections,
                            "embedded": source_rank == 2,
                        }
                    ))

    if not matches:
        return None

    matches.sort(key=lambda item: item[:6])
    return matches[0][6]

def is_valid_plate(text):
    return classify_plate(text, 1.0) is not None

def normalize_plate(text):
    result = classify_plate(text, 1.0)
    return result["plate"] if result else ""
