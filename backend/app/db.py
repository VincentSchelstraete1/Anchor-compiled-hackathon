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
CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    dosage TEXT NOT NULL,
    frequency TEXT NOT NULL,
    location TEXT NOT NULL,
    refill_date TEXT,
    notes TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_medications_person ON medications(person_id);
CREATE INDEX IF NOT EXISTS idx_medications_refill ON medications(refill_date);
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
        if seed:
            if connection.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 0:
                seed_demo(connection)
            _seed_default_check_in(connection)
        connection.commit()
    finally:
        connection.close()


def seed_demo(connection: sqlite3.Connection) -> bool:
    seed_key = "margaret-fictional-v1"
    if connection.execute("SELECT 1 FROM demo_seeds WHERE key = ?", (seed_key,)).fetchone():
        return _seed_demo_medications(connection)

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
    _seed_demo_medications(connection, people["Margaret"])
    return True


def _seed_demo_medications(connection: sqlite3.Connection, margaret_id: int | None = None) -> bool:
    seed_key = "margaret-fictional-medications-v1"
    if connection.execute("SELECT 1 FROM demo_seeds WHERE key = ?", (seed_key,)).fetchone():
        return _seed_default_check_in(connection)
    if margaret_id is None:
        row = connection.execute(
            """SELECT id FROM people
            WHERE name = 'Margaret' AND description LIKE 'Fictional demo —%' ORDER BY id LIMIT 1"""
        ).fetchone()
        if row is None:
            return False
        margaret_id = int(row["id"])

    today = datetime.now(UTC).date()
    created_at = utc_text()
    medications = (
        (
            "Lisinopril",
            "Fictional demo — blood pressure medicine.",
            "10 mg",
            "Once each morning with breakfast",
            "Top shelf of the kitchen medicine cabinet, in the labeled morning organizer",
            (today + timedelta(days=12)).isoformat(),
            "Fictional demo only. Confirm all medicine details against the prescription label.",
        ),
        (
            "Vitamin D3",
            "Fictional demo — daily vitamin supplement.",
            "1,000 IU",
            "Once each morning",
            "Top shelf of the kitchen medicine cabinet, beside the morning organizer",
            (today + timedelta(days=28)).isoformat(),
            "Fictional demo only. Caregiver recorded this from the current bottle label.",
        ),
        (
            "Atorvastatin",
            "Fictional demo — cholesterol medicine.",
            "20 mg",
            "Once each evening after dinner",
            "Second shelf of the kitchen medicine cabinet, in the labeled evening organizer",
            (today + timedelta(days=8)).isoformat(),
            "Fictional demo only. Refill is coming up soon.",
        ),
    )
    connection.executemany(
        """INSERT INTO medications(
            person_id, name, purpose, dosage, frequency, location,
            refill_date, notes, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)""",
        [
            (
                margaret_id,
                name,
                purpose,
                dosage,
                frequency,
                location,
                refill_date,
                notes,
                created_at,
            )
            for name, purpose, dosage, frequency, location, refill_date, notes in medications
        ],
    )
    connection.execute(
        "INSERT INTO demo_seeds(key, created_at) VALUES (?, ?)",
        (seed_key, created_at),
    )
    _seed_default_check_in(connection)
    return True


def _seed_default_check_in(connection: sqlite3.Connection) -> bool:
    title = "Afternoon check-in"
    if connection.execute("SELECT 1 FROM check_ins WHERE title = ?", (title,)).fetchone():
        return False
    connection.execute(
        """INSERT INTO check_ins(title, prompt, time_of_day, enabled, created_at)
        VALUES (?, ?, ?, 1, ?)""",
        (
            title,
            "Good afternoon. How are you feeling, and is there anything you need?",
            "15:00",
            utc_text(),
        ),
    )
    return True
