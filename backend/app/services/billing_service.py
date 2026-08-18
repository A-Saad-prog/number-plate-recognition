import math
from datetime import datetime


PARKING_RATE_PER_HOUR = 50
MINIMUM_PARKING_FEE = 50


def calculate_parking_fee(
    entry_time: datetime,
    exit_time: datetime,
) -> tuple[float, int]:
    """
    Calculate parking duration and fee.

    Under one hour = minimum fee of 50.
    After one hour, every started hour is charged at 50.
    """

    # Make both datetimes timezone-naive.
    if entry_time.tzinfo is not None:
        entry_time = entry_time.replace(tzinfo=None)

    if exit_time.tzinfo is not None:
        exit_time = exit_time.replace(tzinfo=None)

    duration = exit_time - entry_time

    total_seconds = duration.total_seconds()

    # Always charge at least one billed hour.
    billed_hours = max(
        1,
        math.ceil(total_seconds / 3600),
    )

    amount = max(
        MINIMUM_PARKING_FEE,
        billed_hours * PARKING_RATE_PER_HOUR,
    )

    return amount, billed_hours