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
CREATE TABLE IF NOT EXISTS demo_seeds (
    key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
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
            seed_demo(connection)
        connection.commit()
    finally:
        connection.close()


def seed_demo(connection: sqlite3.Connection) -> bool:
    seed_key = "margaret-fictional-v1"
    if connection.execute("SELECT 1 FROM demo_seeds WHERE key = ?", (seed_key,)).fetchone():
        return False

    people: dict[str, int] = {}
    for name, relationship, description in (
        (
            "Margaret",
            "Self",
            "Fictional demo — Margaret is the person using Anchor. This profile is sample data for the hackathon demonstration.",
        ),
        (
            "Elena",
            "Daughter",
            "Fictional demo — Margaret's daughter, primary caregiver, and caregiver-approved contact.",
        ),
        (
            "Sophie",
            "Granddaughter",
            "Fictional demo — Margaret's granddaughter. They enjoy baking together.",
        ),
        (
            "Dr. Chen",
            "Primary care doctor",
            "Fictional demo — Margaret's doctor and a caregiver-approved contact for appointment information.",
        ),
    ):
        cursor = connection.execute(
            "INSERT INTO people(name, relationship, description, photo_url) VALUES (?, ?, ?, ?)",
            (name, relationship, description, None),
        )
        people[name] = int(cursor.lastrowid)

    created_at = utc_text()
    memories = (
        (
            "Margaret's favorite pastimes",
            "Margaret enjoys gardening, baking, and listening to classical music, especially in the afternoon.",
            "Demo · Hobbies",
        ),
        (
            "Afternoon tea",
            "Margaret enjoys afternoon tea at about 3:00 PM, usually with Earl Grey tea and a plain biscuit.",
            "Demo · Important preference",
        ),
        (
            "Morning routine",
            "Margaret likes to open the bedroom curtains after breakfast and check the garden from the window.",
            "Demo · Daily routine",
        ),
        (
            "Evening routine",
            "Margaret usually listens to classical music in the sitting room after dinner before getting ready for bed.",
            "Demo · Daily routine",
        ),
        (
            "Where Margaret keeps her glasses",
            "Margaret usually keeps her glasses on the bedside table next to the lamp.",
            "Demo · Important item location",
        ),
        (
            "Where Margaret keeps her keys",
            "Margaret's keys are usually in the top kitchen drawer beside the tea towels.",
            "Demo · Important item location",
        ),
        (
            "A favorite garden activity",
            "Margaret especially enjoys tending her roses and checking whether the tomatoes are ready to pick.",
            "Demo · Favorite activity",
        ),
        (
            "Baking with Sophie",
            "Margaret and Sophie enjoy baking lemon drizzle cake together. Sophie measures the flour while Margaret prepares the lemons.",
            "Demo · Favorite activity",
        ),
        (
            "The family trip to Yosemite",
            "Margaret remembers a family trip to Yosemite when Elena was young. They picnicked near the valley and watched the light change on Half Dome.",
            "Demo · Meaningful memory",
        ),
        (
            "Elena and Sophie",
            "Elena is Margaret's daughter, and Sophie is Elena's daughter and Margaret's granddaughter.",
            "Demo · Family",
        ),
    )
    connection.executemany(
        """INSERT INTO memories(person_id, title, content, category, created_at)
        VALUES (?, ?, ?, ?, ?)""",
        [
            (people["Margaret"], title, content, category, created_at)
            for title, content, category in memories
        ],
    )

    now = datetime.now(UTC)
    events = (
        (
            "Elena visits later",
            "Fictional demo — Elena is scheduled to visit Margaret. This is an expected visit, not a confirmed arrival.",
            now + timedelta(hours=2),
            people["Elena"],
            30,
        ),
        (
            "Appointment with Dr. Chen",
            "Fictional demo — routine check-up at the neighborhood clinic.",
            now + timedelta(days=1, hours=1),
            people["Dr. Chen"],
            60,
        ),
        (
            "Sophie visits",
            "Fictional demo — Sophie is scheduled to visit and bake with Margaret.",
            now + timedelta(days=3),
            people["Sophie"],
            60,
        ),
        (
            "Afternoon tea reminder",
            "Fictional demo — it is nearly time for Margaret's usual afternoon tea.",
            now + timedelta(hours=4),
            people["Margaret"],
            15,
        ),
        (
            "Put glasses on the bedside table",
            "Fictional demo — a gentle evening reminder for Margaret's usual glasses location.",
            now + timedelta(hours=8),
            people["Margaret"],
            10,
        ),
    )
    connection.executemany(
        """INSERT INTO events(title, description, start_time, person_id, reminder_minutes, status)
        VALUES (?, ?, ?, ?, ?, 'scheduled')""",
        [
            (title, description, utc_text(start_time), person_id, reminder_minutes)
            for title, description, start_time, person_id, reminder_minutes in events
        ],
    )
    connection.execute(
        "INSERT INTO demo_seeds(key, created_at) VALUES (?, ?)",
        (seed_key, created_at),
    )
    return True
