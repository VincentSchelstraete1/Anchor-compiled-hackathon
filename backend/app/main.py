import re
import sqlite3
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.assistant import answer_message
from app.config import DATABASE_PATH, FRONTEND_ORIGINS, UPLOADS_PATH
from app.db import get_connection, initialize_database, seed_demo, utc_text
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ConversationContext,
    ConversationMessage,
    DemoSeedResult,
    Event,
    EventCreate,
    EventStatus,
    EventUpdate,
    Handoff,
    HandoffAnswer,
    HandoffCreate,
    HandoffStatus,
    Medication,
    MedicationCreate,
    MedicationUpdate,
    Memory,
    MemoryCreate,
    MemoryUpdate,
    Person,
    PersonCreate,
    PersonUpdate,
    PhotoUpload,
    SpeechRequest,
)
from app.speech import SpeechUnavailableError, generate_speech

MAX_PHOTO_BYTES = 5 * 1024 * 1024
PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


class HealthResponse(BaseModel):
    status: str


def _error(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def _not_found(kind: str) -> HTTPException:
    return HTTPException(status_code=404, detail=_error("not_found", f"{kind} not found"))


def _row(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def _person_exists(db: sqlite3.Connection, person_id: int | None) -> None:
    if (
        person_id is not None
        and db.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is None
    ):
        raise _not_found("Person")


def _iso(value: datetime) -> str:
    return utc_text(value)


def _normalized_question(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def _photo_content_type(content: bytes) -> str | None:
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def create_app(
    database_path: Path | str = DATABASE_PATH,
    *,
    seed: bool = True,
    uploads_path: Path | str = UPLOADS_PATH,
) -> FastAPI:
    upload_root = Path(uploads_path)
    photo_root = upload_root / "person-photos"

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        initialize_database(database_path, seed=seed)
        yield

    application = FastAPI(title="Anchor API", version="0.1.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=FRONTEND_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def database() -> Iterator[sqlite3.Connection]:
        connection = get_connection(database_path)
        try:
            yield connection
        finally:
            connection.close()

    @application.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for error in exc.errors():
            item = dict(error)
            item.pop("ctx", None)
            details.append(item)
        return JSONResponse(
            status_code=422,
            content=_error("validation_error", "Request validation failed", details),
        )

    @application.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        content = (
            exc.detail if isinstance(exc.detail, dict) else _error("http_error", str(exc.detail))
        )
        return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)

    @application.get("/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @application.post("/demo/seed", response_model=DemoSeedResult, tags=["demo"])
    def seed_fictional_demo(db: sqlite3.Connection = Depends(database)) -> DemoSeedResult:
        seeded = seed_demo(db)
        db.commit()
        people = db.execute(
            "SELECT COUNT(*) FROM people WHERE description LIKE 'Fictional demo —%'"
        ).fetchone()[0]
        memories = db.execute(
            "SELECT COUNT(*) FROM memories WHERE category LIKE 'Demo · %'"
        ).fetchone()[0]
        events = db.execute(
            "SELECT COUNT(*) FROM events WHERE description LIKE 'Fictional demo —%'"
        ).fetchone()[0]
        medications = db.execute(
            "SELECT COUNT(*) FROM medications WHERE purpose LIKE 'Fictional demo —%'"
        ).fetchone()[0]
        return DemoSeedResult(
            seeded=seeded,
            people=people,
            memories=memories,
            events=events,
            medications=medications,
        )

    @application.get("/people")
    def list_people(db: sqlite3.Connection = Depends(database)) -> dict[str, list[Person]]:
        rows = db.execute("SELECT * FROM people ORDER BY name, id").fetchall()
        return {"items": [Person(**_row(row)) for row in rows]}

    @application.post("/uploads/person-photo", response_model=PhotoUpload, status_code=201)
    async def upload_person_photo(file: UploadFile = File(...)) -> PhotoUpload:
        declared_type = (file.content_type or "").lower()
        if declared_type not in PHOTO_TYPES:
            raise HTTPException(
                status_code=422,
                detail=_error("invalid_file_type", "Choose a JPEG, PNG, or WebP photo."),
            )
        content = await file.read(MAX_PHOTO_BYTES + 1)
        await file.close()
        if len(content) > MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=_error("file_too_large", "Photo must be 5 MB or smaller."),
            )
        detected_type = _photo_content_type(content)
        if detected_type is None or detected_type != declared_type:
            raise HTTPException(
                status_code=422,
                detail=_error(
                    "invalid_file_type",
                    "This file does not appear to be a valid JPEG, PNG, or WebP photo.",
                ),
            )
        photo_root.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid4().hex}.{PHOTO_TYPES[detected_type]}"
        (photo_root / filename).write_bytes(content)
        return PhotoUpload(photo_url=f"/uploads/person-photos/{filename}")

    @application.post("/people", response_model=Person, status_code=201)
    def create_person(payload: PersonCreate, db: sqlite3.Connection = Depends(database)) -> Person:
        cursor = db.execute(
            "INSERT INTO people(name, relationship, description, photo_url) VALUES (?, ?, ?, ?)",
            (payload.name, payload.relationship, payload.description, payload.photo_url),
        )
        db.commit()
        row = db.execute("SELECT * FROM people WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return Person(**_row(row))

    @application.get("/people/{person_id}", response_model=Person)
    def get_person(person_id: int, db: sqlite3.Connection = Depends(database)) -> Person:
        row = db.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone()
        if row is None:
            raise _not_found("Person")
        return Person(**_row(row))

    @application.patch("/people/{person_id}", response_model=Person)
    def update_person(
        person_id: int, payload: PersonUpdate, db: sqlite3.Connection = Depends(database)
    ) -> Person:
        if db.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is None:
            raise _not_found("Person")
        values = payload.model_dump(exclude_unset=True)
        assignments = ", ".join(f"{key} = ?" for key in values)
        db.execute(
            f"UPDATE people SET {assignments} WHERE id = ?",
            (*values.values(), person_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM people WHERE id = ?", (person_id,)).fetchone()
        return Person(**_row(row))

    @application.delete("/people/{person_id}", status_code=204)
    def delete_person(person_id: int, db: sqlite3.Connection = Depends(database)) -> Response:
        if db.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is None:
            raise _not_found("Person")
        try:
            db.execute("DELETE FROM people WHERE id = ?", (person_id,))
            db.commit()
        except sqlite3.IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail=_error("conflict", "Person is still referenced"),
            ) from exc
        return Response(status_code=204)

    @application.get("/memories")
    def list_memories(
        person_id: int | None = Query(default=None, gt=0),
        category: str | None = None,
        db: sqlite3.Connection = Depends(database),
    ) -> dict[str, list[Memory]]:
        clauses: list[str] = []
        params: list[Any] = []
        if person_id is not None:
            clauses.append("person_id = ?")
            params.append(person_id)
        if category is not None:
            clauses.append("category = ?")
            params.append(category.strip())
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = db.execute(
            f"SELECT * FROM memories{where} ORDER BY created_at DESC, id DESC", params
        ).fetchall()
        return {"items": [Memory(**_row(row)) for row in rows]}

    @application.post("/memories", response_model=Memory, status_code=201)
    def create_memory(payload: MemoryCreate, db: sqlite3.Connection = Depends(database)) -> Memory:
        _person_exists(db, payload.person_id)
        cursor = db.execute(
            """INSERT INTO memories(person_id, title, content, category, created_at)
            VALUES (?, ?, ?, ?, ?)""",
            (payload.person_id, payload.title, payload.content, payload.category, utc_text()),
        )
        db.commit()
        row = db.execute("SELECT * FROM memories WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return Memory(**_row(row))

    @application.get("/memories/{memory_id}", response_model=Memory)
    def get_memory(memory_id: int, db: sqlite3.Connection = Depends(database)) -> Memory:
        row = db.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        if row is None:
            raise _not_found("Memory")
        return Memory(**_row(row))

    @application.patch("/memories/{memory_id}", response_model=Memory)
    def update_memory(
        memory_id: int, payload: MemoryUpdate, db: sqlite3.Connection = Depends(database)
    ) -> Memory:
        if db.execute("SELECT 1 FROM memories WHERE id = ?", (memory_id,)).fetchone() is None:
            raise _not_found("Memory")
        values = payload.model_dump(exclude_unset=True)
        _person_exists(db, values.get("person_id"))
        assignments = ", ".join(f"{key} = ?" for key in values)
        db.execute(
            f"UPDATE memories SET {assignments} WHERE id = ?",
            (*values.values(), memory_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return Memory(**_row(row))

    @application.delete("/memories/{memory_id}", status_code=204)
    def delete_memory(memory_id: int, db: sqlite3.Connection = Depends(database)) -> Response:
        cursor = db.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        if cursor.rowcount == 0:
            raise _not_found("Memory")
        db.commit()
        return Response(status_code=204)

    @application.get("/medications")
    def list_medications(
        person_id: int | None = Query(default=None, gt=0),
        active: bool | None = None,
        db: sqlite3.Connection = Depends(database),
    ) -> dict[str, list[Medication]]:
        clauses: list[str] = []
        params: list[Any] = []
        if person_id is not None:
            clauses.append("person_id = ?")
            params.append(person_id)
        if active is not None:
            clauses.append("active = ?")
            params.append(int(active))
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = db.execute(
            f"""SELECT * FROM medications{where}
            ORDER BY active DESC, refill_date IS NULL, refill_date, name, id""",
            params,
        ).fetchall()
        return {"items": [Medication(**_row(row)) for row in rows]}

    @application.post("/medications", response_model=Medication, status_code=201)
    def create_medication(
        payload: MedicationCreate,
        db: sqlite3.Connection = Depends(database),
    ) -> Medication:
        _person_exists(db, payload.person_id)
        values = payload.model_dump(mode="json")
        cursor = db.execute(
            """INSERT INTO medications(
                person_id, name, purpose, dosage, frequency, location,
                refill_date, notes, active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                values["person_id"],
                values["name"],
                values["purpose"],
                values["dosage"],
                values["frequency"],
                values["location"],
                values["refill_date"],
                values["notes"],
                int(values["active"]),
                utc_text(),
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM medications WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return Medication(**_row(row))

    @application.get("/medications/{medication_id}", response_model=Medication)
    def get_medication(
        medication_id: int,
        db: sqlite3.Connection = Depends(database),
    ) -> Medication:
        row = db.execute("SELECT * FROM medications WHERE id = ?", (medication_id,)).fetchone()
        if row is None:
            raise _not_found("Medication")
        return Medication(**_row(row))

    @application.patch("/medications/{medication_id}", response_model=Medication)
    def update_medication(
        medication_id: int,
        payload: MedicationUpdate,
        db: sqlite3.Connection = Depends(database),
    ) -> Medication:
        if (
            db.execute("SELECT 1 FROM medications WHERE id = ?", (medication_id,)).fetchone()
            is None
        ):
            raise _not_found("Medication")
        values = payload.model_dump(exclude_unset=True, mode="json")
        _person_exists(db, values.get("person_id"))
        if "active" in values:
            values["active"] = int(values["active"])
        assignments = ", ".join(f"{key} = ?" for key in values)
        db.execute(
            f"UPDATE medications SET {assignments} WHERE id = ?",
            (*values.values(), medication_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM medications WHERE id = ?", (medication_id,)).fetchone()
        return Medication(**_row(row))

    @application.delete("/medications/{medication_id}", status_code=204)
    def delete_medication(
        medication_id: int,
        db: sqlite3.Connection = Depends(database),
    ) -> Response:
        cursor = db.execute("DELETE FROM medications WHERE id = ?", (medication_id,))
        if cursor.rowcount == 0:
            raise _not_found("Medication")
        db.commit()
        return Response(status_code=204)

    @application.get("/events")
    def list_events(
        from_time: datetime | None = Query(default=None, alias="from"),
        to_time: datetime | None = Query(default=None, alias="to"),
        event_status: EventStatus | None = Query(default=None, alias="status"),
        db: sqlite3.Connection = Depends(database),
    ) -> dict[str, list[Event]]:
        clauses: list[str] = []
        params: list[Any] = []
        for field, value, operator in (
            ("start_time", from_time, ">="),
            ("start_time", to_time, "<="),
            ("status", event_status, "="),
        ):
            if value is not None:
                if isinstance(value, datetime):
                    if value.tzinfo is None:
                        raise HTTPException(
                            422, detail=_error("validation_error", "Timestamp needs an offset")
                        )
                    value = _iso(value)
                clauses.append(f"{field} {operator} ?")
                params.append(value)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = db.execute(f"SELECT * FROM events{where} ORDER BY start_time, id", params).fetchall()
        return {"items": [Event(**_row(row)) for row in rows]}

    @application.post("/events", response_model=Event, status_code=201)
    def create_event(payload: EventCreate, db: sqlite3.Connection = Depends(database)) -> Event:
        _person_exists(db, payload.person_id)
        cursor = db.execute(
            """INSERT INTO events(title, description, start_time, person_id,
            reminder_minutes, status) VALUES (?, ?, ?, ?, ?, ?)""",
            (
                payload.title,
                payload.description,
                _iso(payload.start_time),
                payload.person_id,
                payload.reminder_minutes,
                payload.status,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM events WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return Event(**_row(row))

    @application.get("/events/{event_id}", response_model=Event)
    def get_event(event_id: int, db: sqlite3.Connection = Depends(database)) -> Event:
        row = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise _not_found("Event")
        return Event(**_row(row))

    @application.patch("/events/{event_id}", response_model=Event)
    def update_event(
        event_id: int, payload: EventUpdate, db: sqlite3.Connection = Depends(database)
    ) -> Event:
        if db.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
            raise _not_found("Event")
        values = payload.model_dump(exclude_unset=True)
        _person_exists(db, values.get("person_id"))
        if isinstance(values.get("start_time"), datetime):
            values["start_time"] = _iso(values["start_time"])
        assignments = ", ".join(f"{key} = ?" for key in values)
        db.execute(
            f"UPDATE events SET {assignments} WHERE id = ?",
            (*values.values(), event_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return Event(**_row(row))

    @application.delete("/events/{event_id}", status_code=204)
    def delete_event(event_id: int, db: sqlite3.Connection = Depends(database)) -> Response:
        cursor = db.execute("DELETE FROM events WHERE id = ?", (event_id,))
        if cursor.rowcount == 0:
            raise _not_found("Event")
        db.commit()
        return Response(status_code=204)

    @application.get("/reminders/due")
    def due_reminders(
        at: datetime | None = None, db: sqlite3.Connection = Depends(database)
    ) -> dict[str, list[Event]]:
        current = at or datetime.now(UTC)
        if current.tzinfo is None:
            raise HTTPException(422, detail=_error("validation_error", "Timestamp needs an offset"))
        rows = db.execute(
            "SELECT * FROM events WHERE status = 'scheduled' ORDER BY start_time, id"
        ).fetchall()
        due = []
        for row in rows:
            item = _row(row)
            start = datetime.fromisoformat(item["start_time"])
            if start - timedelta(minutes=item["reminder_minutes"]) <= current < start:
                due.append(Event(**item))
        return {"items": due}

    @application.get("/conversation/messages")
    def conversation_messages(
        limit: int = Query(default=12, ge=1, le=50),
        db: sqlite3.Connection = Depends(database),
    ) -> dict[str, list[ConversationMessage]]:
        rows = db.execute(
            """SELECT * FROM (
                SELECT * FROM conversation_messages ORDER BY id DESC LIMIT ?
            ) ORDER BY id""",
            (limit,),
        ).fetchall()
        return {"items": [ConversationMessage(**_row(row)) for row in rows]}

    @application.delete("/conversation/messages", status_code=204)
    def clear_conversation(db: sqlite3.Connection = Depends(database)) -> Response:
        db.execute("DELETE FROM conversation_messages")
        db.commit()
        return Response(status_code=204)

    @application.get("/conversation/context", response_model=ConversationContext)
    def conversation_context(db: sqlite3.Connection = Depends(database)) -> ConversationContext:
        now = datetime.now(UTC)
        messages = db.execute(
            """SELECT * FROM (
                SELECT * FROM conversation_messages ORDER BY id DESC LIMIT 12
            ) ORDER BY id"""
        ).fetchall()
        people = db.execute("SELECT * FROM people ORDER BY name, id").fetchall()
        memories = db.execute("SELECT * FROM memories ORDER BY created_at DESC, id DESC").fetchall()
        medications = db.execute(
            """SELECT * FROM medications
            ORDER BY active DESC, refill_date IS NULL, refill_date, name, id"""
        ).fetchall()
        events = db.execute(
            """SELECT * FROM events WHERE status = 'scheduled' AND start_time >= ?
            AND start_time <= ? ORDER BY start_time, id""",
            (_iso(now), _iso(now + timedelta(days=7))),
        ).fetchall()
        handoffs = db.execute(
            "SELECT * FROM handoffs WHERE status IN ('pending', 'answered') ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return ConversationContext(
            messages=[ConversationMessage(**_row(row)) for row in messages],
            people=[Person(**_row(row)) for row in people],
            memories=[Memory(**_row(row)) for row in memories],
            medications=[Medication(**_row(row)) for row in medications],
            upcoming_events=[Event(**_row(row)) for row in events],
            pending_handoffs=[Handoff(**_row(row)) for row in handoffs],
        )

    @application.post("/chat", response_model=ChatResponse)
    def chat(payload: ChatRequest, db: sqlite3.Connection = Depends(database)) -> ChatResponse:
        db.execute(
            "INSERT INTO conversation_messages(role, content, created_at) VALUES ('user', ?, ?)",
            (payload.message, utc_text()),
        )
        history_rows = db.execute(
            "SELECT role, content FROM conversation_messages ORDER BY id DESC LIMIT 12"
        ).fetchall()
        people = [_row(row) for row in db.execute("SELECT * FROM people").fetchall()]
        memories = [_row(row) for row in db.execute("SELECT * FROM memories").fetchall()]
        medications = [_row(row) for row in db.execute("SELECT * FROM medications").fetchall()]
        events = [
            _row(row)
            for row in db.execute("SELECT * FROM events ORDER BY start_time LIMIT 50").fetchall()
        ]
        handoffs = [_row(row) for row in db.execute("SELECT * FROM handoffs").fetchall()]
        result = answer_message(
            payload.message,
            people=people,
            memories=memories,
            medications=medications,
            events=events,
            handoffs=handoffs,
            history=[_row(row) for row in reversed(history_rows)],
        )
        cursor = db.execute(
            "INSERT INTO conversation_messages(role, content, created_at) VALUES ('assistant', ?, ?)",
            (result.content, utc_text()),
        )
        db.execute(
            """DELETE FROM conversation_messages WHERE id NOT IN (
                SELECT id FROM conversation_messages ORDER BY id DESC LIMIT 50
            )"""
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM conversation_messages WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
        return ChatResponse(
            message=ConversationMessage(**_row(row)),
            grounded=result.grounded,
            sources=result.sources,
            handoff_offered=result.handoff_offered,
        )

    @application.post("/speech", response_class=Response)
    def speech(payload: SpeechRequest) -> Response:
        try:
            audio = generate_speech(payload.text)
        except SpeechUnavailableError as exc:
            raise HTTPException(
                status_code=503,
                detail=_error(
                    "speech_unavailable",
                    "OpenAI speech is temporarily unavailable; use browser speech fallback",
                ),
            ) from exc
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-store",
                "X-Anchor-Voice-Disclosure": "AI-generated voice",
            },
        )

    @application.get("/handoffs")
    def list_handoffs(
        handoff_status: HandoffStatus | None = Query(default=None, alias="status"),
        db: sqlite3.Connection = Depends(database),
    ) -> dict[str, list[Handoff]]:
        if handoff_status:
            rows = db.execute(
                "SELECT * FROM handoffs WHERE status = ? ORDER BY created_at DESC, id DESC",
                (handoff_status,),
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM handoffs ORDER BY created_at DESC, id DESC").fetchall()
        return {"items": [Handoff(**_row(row)) for row in rows]}

    @application.post("/handoffs", response_model=Handoff, status_code=201)
    def create_handoff(
        payload: HandoffCreate, db: sqlite3.Connection = Depends(database)
    ) -> Handoff:
        _person_exists(db, payload.caregiver_person_id)
        active = db.execute(
            """SELECT * FROM handoffs WHERE caregiver_person_id = ?
            AND status IN ('pending', 'answered') ORDER BY id DESC""",
            (payload.caregiver_person_id,),
        ).fetchall()
        duplicate = next(
            (
                row
                for row in active
                if _normalized_question(row["question"]) == _normalized_question(payload.question)
            ),
            None,
        )
        if duplicate is not None:
            raise HTTPException(
                409,
                detail=_error(
                    "conflict",
                    "An active handoff already exists for this question",
                    {"handoff_id": duplicate["id"]},
                ),
            )
        cursor = db.execute(
            """INSERT INTO handoffs(caregiver_person_id, question, status, response,
            created_at, answered_at, delivered_at) VALUES (?, ?, 'pending', NULL, ?, NULL, NULL)""",
            (payload.caregiver_person_id, payload.question, utc_text()),
        )
        db.commit()
        row = db.execute("SELECT * FROM handoffs WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return Handoff(**_row(row))

    @application.get("/handoffs/{handoff_id}", response_model=Handoff)
    def get_handoff(handoff_id: int, db: sqlite3.Connection = Depends(database)) -> Handoff:
        row = db.execute("SELECT * FROM handoffs WHERE id = ?", (handoff_id,)).fetchone()
        if row is None:
            raise _not_found("Handoff")
        return Handoff(**_row(row))

    def transition(
        handoff_id: int,
        expected: Literal["pending", "answered"],
        target: HandoffStatus,
        db: sqlite3.Connection,
        *,
        response: str | None = None,
    ) -> Handoff:
        row = db.execute("SELECT * FROM handoffs WHERE id = ?", (handoff_id,)).fetchone()
        if row is None:
            raise _not_found("Handoff")
        if row["status"] != expected:
            raise HTTPException(
                409,
                detail=_error(
                    "conflict", f"Cannot transition handoff from {row['status']} to {target}"
                ),
            )
        if target == "answered":
            db.execute(
                "UPDATE handoffs SET status = ?, response = ?, answered_at = ? WHERE id = ?",
                (target, response, utc_text(), handoff_id),
            )
        elif target == "delivered":
            db.execute(
                "UPDATE handoffs SET status = ?, delivered_at = ? WHERE id = ?",
                (target, utc_text(), handoff_id),
            )
        else:
            db.execute("UPDATE handoffs SET status = ? WHERE id = ?", (target, handoff_id))
        db.commit()
        updated = db.execute("SELECT * FROM handoffs WHERE id = ?", (handoff_id,)).fetchone()
        return Handoff(**_row(updated))

    @application.post("/handoffs/{handoff_id}/answer", response_model=Handoff)
    def answer_handoff(
        handoff_id: int,
        payload: HandoffAnswer,
        db: sqlite3.Connection = Depends(database),
    ) -> Handoff:
        return transition(handoff_id, "pending", "answered", db, response=payload.response)

    @application.post("/handoffs/{handoff_id}/deliver", response_model=Handoff)
    def deliver_handoff(handoff_id: int, db: sqlite3.Connection = Depends(database)) -> Handoff:
        return transition(handoff_id, "answered", "delivered", db)

    @application.post("/handoffs/{handoff_id}/cancel", response_model=Handoff)
    def cancel_handoff(handoff_id: int, db: sqlite3.Connection = Depends(database)) -> Handoff:
        return transition(handoff_id, "pending", "cancelled", db)

    application.mount(
        "/uploads", StaticFiles(directory=upload_root, check_dir=False), name="uploads"
    )
    return application


app = create_app()
