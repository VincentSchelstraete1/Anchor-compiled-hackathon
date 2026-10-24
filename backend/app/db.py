import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import DATABASE_PATH

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
