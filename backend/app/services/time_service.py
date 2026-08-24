from datetime import datetime
from zoneinfo import ZoneInfo


PAKISTAN_TIMEZONE = ZoneInfo("Asia/Karachi")


def pakistan_now() -> datetime:
    """Return current Pakistan time without timezone metadata for the legacy DB columns."""
    return datetime.now(PAKISTAN_TIMEZONE).replace(tzinfo=None)