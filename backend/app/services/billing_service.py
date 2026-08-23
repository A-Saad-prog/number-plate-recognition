import math
from datetime import datetime

PARKING_RATE_PER_MINUTE = 1.67


def calculate_parking_fee(
    entry_time: datetime,
    exit_time: datetime,
) -> tuple[float, int]:
    """
    Charge Rs 1.67 for every started parking minute.
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
