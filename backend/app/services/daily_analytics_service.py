from collections import Counter
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.daily_parking_analytics import DailyParkingAnalytics
from app.models.parking_session import ParkingSession
from app.services.time_service import pakistan_now


def _day_sessions(db: Session, tenant_id: int, day: date):
    return db.query(ParkingSession).filter(
        ParkingSession.tenant_id == tenant_id,
        ParkingSession.entry_time >= day,
        ParkingSession.entry_time < day + timedelta(days=1),
    ).all()


def rollup_day(db: Session, tenant_id: int, day: date) -> DailyParkingAnalytics:
    sessions = _day_sessions(db, tenant_id, day)
    completed = db.query(ParkingSession).filter(
        ParkingSession.tenant_id == tenant_id,
        ParkingSession.status == "completed",
        ParkingSession.exit_time >= day,
        ParkingSession.exit_time < day + timedelta(days=1),
    ).all()
    durations = [(item.exit_time - item.entry_time).total_seconds() for item in completed]
    hours = Counter(item.entry_time.hour for item in sessions)
    rush_hour, peak_count = (hours.most_common(1)[0] if hours else (None, 0))
    row = db.query(DailyParkingAnalytics).filter(
        DailyParkingAnalytics.tenant_id == tenant_id,
        DailyParkingAnalytics.analytics_date == day,
    ).first()
    if row is None:
        row = DailyParkingAnalytics(tenant_id=tenant_id, analytics_date=day)
        db.add(row)
    row.total_earnings = round(sum(float(item.amount or 0) for item in completed), 2)
    row.total_entries = len(sessions)
    row.completed_sessions = len(completed)
    row.average_duration_seconds = sum(durations) / len(durations) if durations else 0
    row.rush_hour_start = rush_hour
    row.peak_hour_vehicle_count = peak_count
    return row


def backfill_completed_days(db: Session, tenant_id: int) -> None:
    today = pakistan_now().date()
    completed = db.query(ParkingSession).filter(
        ParkingSession.tenant_id == tenant_id,
        ParkingSession.status == "completed",
        ParkingSession.exit_time.isnot(None),
    ).all()
    dates = {item.exit_time.date() for item in completed if item.exit_time.date() < today}
    for day in dates:
        rollup_day(db, tenant_id, day)
    db.commit()


def live_day_metrics(db: Session, tenant_id: int, day: date) -> dict:
    sessions = _day_sessions(db, tenant_id, day)
    completed = db.query(ParkingSession).filter(
        ParkingSession.tenant_id == tenant_id,
        ParkingSession.status == "completed",
        ParkingSession.exit_time >= day,
        ParkingSession.exit_time < day + timedelta(days=1),
    ).all()
    durations = [(item.exit_time - item.entry_time).total_seconds() for item in completed]
    hours = Counter(item.entry_time.hour for item in sessions)
    rush_hour, peak_count = (hours.most_common(1)[0] if hours else (None, 0))
    return {"date": day.isoformat(), "earnings": round(sum(float(item.amount or 0) for item in completed), 2), "vehicles": len(sessions), "completed_sessions": len(completed), "average_duration_seconds": sum(durations) / len(durations) if durations else 0, "rush_hour_start": rush_hour, "peak_hour_vehicle_count": peak_count}
