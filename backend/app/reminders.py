import sqlite3
from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.db import utc_text


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(UTC)


def get_settings(database: sqlite3.Connection) -> dict[str, str | None]:
    row = database.execute("SELECT * FROM companion_settings WHERE id = 1").fetchone()
    if row is None:
        raise RuntimeError("companion settings have not been initialized")
    return {
        "timezone": row["timezone"],
        "quiet_hours_start": row["quiet_hours_start"],
        "quiet_hours_end": row["quiet_hours_end"],
    }


def is_quiet_time(at: datetime, settings: dict[str, str | None]) -> bool:
    start_value = settings["quiet_hours_start"]
    end_value = settings["quiet_hours_end"]
    if not start_value or not end_value:
        return False
    local_time = at.astimezone(ZoneInfo(str(settings["timezone"]))).time().replace(tzinfo=None)
    start = time.fromisoformat(start_value)
    end = time.fromisoformat(end_value)
    if start < end:
        return start <= local_time < end
    return local_time >= start or local_time < end


def _event_occurrence_key(row: sqlite3.Row) -> str:
    return f"event:{row['id']}:{row['start_time']}:{row['reminder_minutes']}"


def _check_in_occurrence_key(
    row: sqlite3.Row, local_date: date, timezone: str
) -> str:
    return f"check_in:{row['id']}:{local_date.isoformat()}:{row['time_of_day']}:{timezone}"


def _insert_event_occurrences(database: sqlite3.Connection) -> None:
    rows = database.execute(
        "SELECT * FROM events WHERE status = 'scheduled'"
    ).fetchall()
    created_at = utc_text()
    for row in rows:
        start = parse_timestamp(row["start_time"])
        due_at = start - timedelta(minutes=row["reminder_minutes"])
        database.execute(
            """INSERT OR IGNORE INTO reminder_notifications(
                kind, event_id, check_in_id, occurrence_key, title, message,
                due_at, expires_at, status, created_at
            ) VALUES ('event', ?, NULL, ?, ?, ?, ?, ?, 'pending', ?)""",
            (
                row["id"],
                _event_occurrence_key(row),
                row["title"],
                f"Reminder: {row['title']}. {row['description']}".strip(),
                utc_text(due_at),
                utc_text(start),
                created_at,
            ),
        )


def _insert_check_in_occurrences(
    database: sqlite3.Connection, at: datetime, settings: dict[str, str | None]
) -> None:
    timezone = str(settings["timezone"])
    zone = ZoneInfo(timezone)
    local_date = at.astimezone(zone).date()
    rows = database.execute("SELECT * FROM check_ins WHERE enabled = 1").fetchall()
    created_at = utc_text()
    for row in rows:
        local_due = datetime.combine(
            local_date, time.fromisoformat(row["time_of_day"]), tzinfo=zone
        )
        expires = datetime.combine(local_date + timedelta(days=1), time(), tzinfo=zone)
        database.execute(
            """INSERT OR IGNORE INTO reminder_notifications(
                kind, event_id, check_in_id, occurrence_key, title, message,
                due_at, expires_at, status, created_at
            ) VALUES ('check_in', NULL, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (
                row["id"],
                _check_in_occurrence_key(row, local_date, timezone),
                row["title"],
                row["prompt"],
                utc_text(local_due),
                utc_text(expires),
                created_at,
            ),
        )


def ensure_occurrences(database: sqlite3.Connection, at: datetime) -> None:
    settings = get_settings(database)
    _insert_event_occurrences(database)
    _insert_check_in_occurrences(database, at, settings)
    database.commit()


def _is_current_occurrence(
    database: sqlite3.Connection,
    row: sqlite3.Row,
    at: datetime,
    settings: dict[str, str | None],
) -> bool:
    if row["kind"] == "demo":
        return True
    if row["kind"] == "event":
        event = database.execute(
            "SELECT * FROM events WHERE id = ? AND status = 'scheduled'",
            (row["event_id"],),
        ).fetchone()
        return event is not None and row["occurrence_key"] == _event_occurrence_key(event)
    check_in = database.execute(
        "SELECT * FROM check_ins WHERE id = ? AND enabled = 1",
        (row["check_in_id"],),
    ).fetchone()
    if check_in is None:
        return False
    timezone = str(settings["timezone"])
    local_date = at.astimezone(ZoneInfo(timezone)).date()
    return row["occurrence_key"] == _check_in_occurrence_key(
        check_in, local_date, timezone
    )


def due_notifications(database: sqlite3.Connection, at: datetime) -> list[dict]:
    ensure_occurrences(database, at)
    settings = get_settings(database)
    if is_quiet_time(at, settings):
        return []
    rows = database.execute(
        """SELECT * FROM reminder_notifications
        WHERE status = 'pending' AND due_at <= ? AND expires_at > ?
        ORDER BY due_at, id""",
        (utc_text(at), utc_text(at)),
    ).fetchall()
    return [dict(row) for row in rows if _is_current_occurrence(database, row, at, settings)]


def day_notifications(
    database: sqlite3.Connection, at: datetime, start: datetime, end: datetime
) -> list[dict]:
    ensure_occurrences(database, at)
    settings = get_settings(database)
    rows = database.execute(
        """SELECT * FROM reminder_notifications WHERE due_at >= ? AND due_at < ?
        AND status != 'acknowledged' ORDER BY due_at, id""",
        (utc_text(start), utc_text(end)),
    ).fetchall()
    return [dict(row) for row in rows if _is_current_occurrence(database, row, at, settings)]


def create_demo_notification(
    database: sqlite3.Connection,
    *,
    at: datetime,
    kind: str,
    title: str | None,
    message: str | None,
) -> dict:
    defaults = {
        "check_in": (
            "Demo check-in",
            "This is a demo check-in. How are you feeling right now?",
        ),
        "appointment": (
            "Demo appointment",
            "This is a demo appointment reminder.",
        ),
    }
    default_title, default_message = defaults[kind]
    cursor = database.execute(
        """INSERT INTO reminder_notifications(
            kind, event_id, check_in_id, occurrence_key, title, message,
            due_at, expires_at, status, created_at
        ) VALUES ('demo', NULL, NULL, ?, ?, ?, ?, ?, 'pending', ?)""",
        (
            f"demo:{uuid4()}",
            title or default_title,
            message or default_message,
            utc_text(at),
            utc_text(at + timedelta(hours=1)),
            utc_text(at),
        ),
    )
    database.commit()
    return dict(
        database.execute(
            "SELECT * FROM reminder_notifications WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    )


def update_notification_status(
    database: sqlite3.Connection, notification_id: int, action: str, at: datetime
) -> dict | None:
    row = database.execute(
        "SELECT * FROM reminder_notifications WHERE id = ?", (notification_id,)
    ).fetchone()
    if row is None:
        return None
    now = utc_text(at)
    if action == "delivered" and row["status"] == "pending":
        database.execute(
            """UPDATE reminder_notifications
            SET status = 'delivered', delivered_at = ? WHERE id = ?""",
            (now, notification_id),
        )
    elif action == "acknowledged" and row["status"] != "acknowledged":
        database.execute(
            """UPDATE reminder_notifications SET status = 'acknowledged',
            delivered_at = COALESCE(delivered_at, ?), acknowledged_at = ? WHERE id = ?""",
            (now, now, notification_id),
        )
    database.commit()
    return dict(
        database.execute(
            "SELECT * FROM reminder_notifications WHERE id = ?", (notification_id,)
        ).fetchone()
    )


def local_day_bounds(at: datetime, timezone: str) -> tuple[datetime, datetime, date]:
    zone = ZoneInfo(timezone)
    local_date = at.astimezone(zone).date()
    start = datetime.combine(local_date, time(), tzinfo=zone).astimezone(UTC)
    end = datetime.combine(local_date + timedelta(days=1), time(), tzinfo=zone).astimezone(
        UTC
    )
    return start, end, local_date
