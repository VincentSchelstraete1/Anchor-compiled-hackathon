import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import ANCHOR_TIMEZONE, DATABASE_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    relationship TEXT NOT NULL,
    description TEXT NOT NULL,
    photo_url TEXT
);
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER REFERENCES people(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    start_time TEXT NOT NULL,
    person_id INTEGER REFERENCES people(id) ON DELETE RESTRICT,
    reminder_minutes INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled'))
);
CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS handoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caregiver_person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    question TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'delivered', 'cancelled')),
    response TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT,
    delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_memories_person ON memories(person_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_time);
CREATE INDEX IF NOT EXISTS idx_handoffs_status ON handoffs(status);
CREATE TABLE IF NOT EXISTS companion_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    timezone TEXT NOT NULL,
    quiet_hours_start TEXT,
    quiet_hours_end TEXT
);
CREATE TABLE IF NOT EXISTS check_ins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    time_of_day TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminder_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('event', 'check_in', 'demo')),
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    check_in_id INTEGER REFERENCES check_ins(id) ON DELETE CASCADE,
    occurrence_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    due_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'acknowledged')),
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminder_notifications_due
ON reminder_notifications(status, due_at);
"""


def utc_text(value: datetime | None = None) -> str:
    current = value or datetime.now(UTC)
    return current.astimezone(UTC).isoformat().replace("+00:00", "Z")


def get_connection(path: Path | str = DATABASE_PATH) -> sqlite3.Connection:
    connection = sqlite3.connect(path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def get_db(path: Path | str = DATABASE_PATH) -> Iterator[sqlite3.Connection]:
    connection = get_connection(path)
    try:
        yield connection
    finally:
        connection.close()


def initialize_database(path: Path | str = DATABASE_PATH, *, seed: bool = True) -> None:
    connection = get_connection(path)
    try:
        connection.executescript(SCHEMA)
        connection.execute(
            """INSERT OR IGNORE INTO companion_settings(
            id, timezone, quiet_hours_start, quiet_hours_end
            ) VALUES (1, ?, NULL, NULL)""",
            (ANCHOR_TIMEZONE,),
        )
        if seed and connection.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 0:
            _seed_demo(connection)
        connection.commit()
    finally:
        connection.close()


def _seed_demo(connection: sqlite3.Connection) -> None:
    cursor = connection.execute(
        "INSERT INTO people(name, relationship, description, photo_url) VALUES (?, ?, ?, ?)",
        (
            "Elena",
            "daughter",
            "Margaret's daughter and primary caregiver.",
            "/images/elena.jpg",
        ),
    )
    elena_id = cursor.lastrowid
    connection.execute(
        """INSERT INTO memories(person_id, title, content, category, created_at)
        VALUES (?, ?, ?, ?, ?)""",
        (
            elena_id,
            "Sunday garden",
            "Margaret and Elena enjoy tending the garden together on Sundays.",
            "family",
            utc_text(),
        ),
    )
    connection.execute(
        """INSERT INTO events(title, description, start_time, person_id, reminder_minutes, status)
        VALUES (?, ?, ?, ?, ?, ?)""",
        (
            "Elena visits",
            "Elena is scheduled to visit Margaret.",
            utc_text(datetime.now(UTC) + timedelta(hours=1)),
            elena_id,
            30,
            "scheduled",
        ),
    )
    connection.executemany(
        """INSERT INTO memories(person_id, title, content, category, created_at)
        VALUES (?, ?, ?, ?, ?)""",
        (
            (
                None,
                "Morning routine",
                "Margaret likes to have tea and breakfast by the window in the morning.",
                "routine",
                utc_text(),
            ),
            (
                None,
                "Favorite music",
                "Margaret enjoys listening to gentle jazz.",
                "preference",
                utc_text(),
            ),
        ),
    )
    connection.execute(
        """INSERT INTO check_ins(title, prompt, time_of_day, enabled, created_at)
        VALUES (?, ?, ?, 1, ?)""",
        (
            "Afternoon check-in",
            "Good afternoon. How are you feeling, and is there anything you need?",
            "15:00",
            utc_text(),
        ),
    )
