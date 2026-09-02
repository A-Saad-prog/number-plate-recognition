from sqlalchemy.orm import Session

from app.models.admin_activity import AdminActivity


def log_admin_activity(db: Session, admin, action: str, old_value: dict | None, new_value: dict | None) -> None:
    db.add(AdminActivity(
        tenant_id=admin.tenant_id,
        admin_id=admin.id,
        action=action,
        old_value=old_value,
        new_value=new_value,
    ))
