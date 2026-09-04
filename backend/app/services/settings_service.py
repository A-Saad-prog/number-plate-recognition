from sqlalchemy.orm import Session

from app.models.admin_settings import AdminSettings


DEFAULT_GARAGE_SETTINGS = {
    "mode": "parking",
    "level_count": 0,
    "spaces_per_level": 0,
    "levels": [],
    "automatic_entry": False,
    "local_image_saving": False,
}
DEFAULT_CAMERA_CONFIG = {
    "entry_lane_cameras": 1,
    "exit_lane_cameras": 1,
}
DEFAULT_BILLING_CONFIG = {
    "payments_enabled": False,
    "cash_enabled": False,
    "card_enabled": False,
    "rate_per_minute": 1.67,
    "rate_unit": "minute",
}


def get_admin_settings(db: Session, tenant_id: int, create: bool = False) -> AdminSettings | None:
    settings = db.query(AdminSettings).filter(AdminSettings.tenant_id == tenant_id).first()
    if settings is None and create:
        settings = AdminSettings(
            tenant_id=tenant_id,
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

    billing_config = DEFAULT_BILLING_CONFIG.copy()
    billing_config.update(settings.billing_config or {})

    garage_settings = DEFAULT_GARAGE_SETTINGS.copy()
    garage_settings.update(settings.garage_settings or {})
    return {
        "garage_settings": garage_settings,
        "camera_config": settings.camera_config,
        "billing_config": billing_config,
        "updated_at": settings.updated_at,
    }
