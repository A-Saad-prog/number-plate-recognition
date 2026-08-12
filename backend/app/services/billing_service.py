import math
from datetime import datetime


PARKING_RATE_PER_HOUR = 100


def calculate_parking_fee(
    entry_time: datetime,
    exit_time: datetime,
) -> tuple[float, int]:
    """
    Calculate parking duration and fee.

    Any partial hour is rounded up.
    """

    # Make both datetimes timezone-naive.
    # PostgreSQL currently stores our timestamps without timezone.
    if entry_time.tzinfo is not None:
        entry_time = entry_time.replace(tzinfo=None)

    if exit_time.tzinfo is not None:
        exit_time = exit_time.replace(tzinfo=None)

    duration = exit_time - entry_time

    total_seconds = duration.total_seconds()

    billed_hours = max(
        1,
        math.ceil(total_seconds / 3600),
    )

    amount = billed_hours * PARKING_RATE_PER_HOUR

    return amount, billed_hours