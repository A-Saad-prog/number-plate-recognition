import math
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

PARKING_RATE_PER_MINUTE = 1.67


def calculate_parking_fee(
    entry_time: datetime,
    exit_time: datetime,
) -> tuple[float, int]:
    """
    Charge Rs 1.67 per started minute, with a minimum
    one-minute charge for even a sub-second stay.
    """

    if entry_time.tzinfo is not None:
        entry_time = entry_time.astimezone().replace(tzinfo=None)

    if exit_time.tzinfo is not None:
        exit_time = exit_time.astimezone().replace(tzinfo=None)

    duration = exit_time - entry_time
    total_seconds = max(0, duration.total_seconds())

    billed_minutes = max(1, math.ceil(total_seconds / 60))
    amount = round(billed_minutes * PARKING_RATE_PER_MINUTE, 2)

    return amount, billed_minutes


def apply_discount(amount: float, discount_percent: float) -> float:
    discount = min(100, max(0, discount_percent))
    discounted_amount = Decimal(str(amount)) * (
        Decimal("1") - Decimal(str(discount)) / Decimal("100")
    )
    return float(discounted_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
