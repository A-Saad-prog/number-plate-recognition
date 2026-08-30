from sqlalchemy.orm import Session

from app.models.admin_settings import AdminSettings


DEFAULT_GARAGE_SETTINGS = {
    "level_count": 0,
    "spaces_per_level": 0,
    "levels": [],
}
DEFAULT_CAMERA_CONFIG = {
    "entry_lane_cameras": 1,
    "exit_lane_cameras": 1,
}
DEFAULT_BILLING_CONFIG = {
    "payments_enabled": False,
    "cash_enabled": False,
    "card_enabled": False,
}


def get_admin_settings(db: Session, create: bool = False) -> AdminSettings | None:
    settings = db.query(AdminSettings).first()
    if settings is None and create:
        settings = AdminSettings(
            garage_settings=DEFAULT_GARAGE_SETTINGS.copy(),
            camera_config=DEFAULT_CAMERA_CONFIG.copy(),
            billing_config=DEFAULT_BILLING_CONFIG.copy(),
        )
        db.add(settings)
        db.flush()
    return settings


def settings_response(settings: AdminSettings | None) -> dict:
    if settings is None:
        return {
            "garage_settings": DEFAULT_GARAGE_SETTINGS,
            "camera_config": DEFAULT_CAMERA_CONFIG,
            "billing_config": DEFAULT_BILLING_CONFIG,
        }

    return {
        "garage_settings": settings.garage_settings,
        "camera_config": settings.camera_config,
        "billing_config": settings.billing_config,
        "updated_at": settings.updated_at,
    }
