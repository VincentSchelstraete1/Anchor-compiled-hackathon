import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from app.db import utc_text

ACTION_TYPES = {
    "SMS_REQUESTED",
    "CALL_REQUESTED",
    "CAREGIVER_ASSISTANCE",
    "URGENT_HELP_REQUESTED",
}
CONFIRMATIONS = {
    "confirm",
    "go ahead",
    "please do",
    "prepare it",
    "yes",
    "yes please",
}
CANCELLATIONS = {"cancel", "do not", "don t", "never mind", "no", "no thanks", "stop"}
EMERGENCY_PHRASES = {
    "can t breathe",
    "cannot breathe",
    "chest pain",
    "call 911",
    "call emergency services",
    "fell and can t get up",
    "fallen and can t get up",
    "severe bleeding",
    "someone is in the house",
    "unconscious",
    "overdose",
    "signs of a stroke",
}
URGENT_HELP_PHRASES = {"get help now", "help me now", "need urgent help"}
ASSISTANCE_PHRASES = {
    "can someone help me",
    "could my caregiver help",
    "i need caregiver help",
    "i need help getting",
    "i need someone to help",
    "please ask my caregiver for help",
}


@dataclass
class CommunicationTurnResult:
    content: str
    action_id: int | None = None


def normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def _approved_people(database: sqlite3.Connection) -> list[sqlite3.Row]:
    return database.execute(
        "SELECT * FROM people WHERE contact_approved = 1 ORDER BY id"
    ).fetchall()


def _mentioned_person(
    message: str, people: list[sqlite3.Row]
) -> tuple[sqlite3.Row | None, bool]:
    normalized = normalize(message)
    padded = f" {normalized} "
    all_people = people
    mentioned = next(
        (person for person in all_people if f" {normalize(person['name'])} " in padded), None
    )
    return mentioned, mentioned is not None


def resolve_recipient(
    database: sqlite3.Connection, message: str
) -> tuple[sqlite3.Row | None, bool]:
    all_people = database.execute("SELECT * FROM people ORDER BY id").fetchall()
    mentioned, had_named_person = _mentioned_person(message, all_people)
    if mentioned is not None:
        return (mentioned if mentioned["contact_approved"] else None), had_named_person

    approved = _approved_people(database)
    normalized = normalize(message)
    relationship_matches = [
        person
        for person in approved
        if set(normalize(person["relationship"]).split()) & set(normalized.split())
    ]
    if len(relationship_matches) == 1:
        return relationship_matches[0], False
    if "caregiver" in normalized:
        caregiver = next(
            (
                person
                for person in approved
                if "caregiver"
                in normalize(f"{person['relationship']} {person['description']}").split()
            ),
            None,
        )
        if caregiver:
            return caregiver, False
    target = re.search(r"\b(?:call|message|text)\s+([a-z0-9]+)", normalized)
    if target and target.group(1) not in {
        "a",
        "caregiver",
        "family",
        "my",
        "someone",
        "the",
    }:
        return None, True
    if len(approved) == 1:
        return approved[0], False
    return None, had_named_person


def _find_duplicate(
    database: sqlite3.Connection,
    *,
    action_type: str,
    recipient_person_id: int | None,
    reason: str,
    proposed_content: str | None,
    is_demo: bool,
) -> sqlite3.Row | None:
    rows = database.execute(
        """SELECT * FROM communication_actions WHERE action_type = ?
        AND recipient_person_id IS ? AND is_demo = ? AND status != 'CANCELLED'
        ORDER BY id DESC""",
        (action_type, recipient_person_id, is_demo),
    ).fetchall()
    normalized_reason = normalize(reason)
    normalized_content = normalize(proposed_content or "")
    return next(
        (
            row
            for row in rows
            if normalize(row["reason"]) == normalized_reason
            and normalize(row["proposed_content"] or "") == normalized_content
        ),
        None,
    )


def create_action(
    database: sqlite3.Connection,
    *,
    action_type: str,
    recipient_person_id: int | None,
    reason: str,
    proposed_content: str | None,
    source_conversation_message_id: int | None,
    is_demo: bool = False,
) -> tuple[dict[str, Any], bool]:
    if action_type not in ACTION_TYPES:
        raise ValueError("unsupported communication action type")
    duplicate = _find_duplicate(
        database,
        action_type=action_type,
        recipient_person_id=recipient_person_id,
        reason=reason,
        proposed_content=proposed_content,
        is_demo=is_demo,
    )
    if duplicate is not None:
        return dict(duplicate), False
    now = utc_text()
    if is_demo:
        status = "SIMULATED"
        confirmation_status = "CONFIRMED"
        execution_status = "SIMULATED"
        confirmed_at = now
        simulated_at = now
    else:
        status = "PROPOSED"
        confirmation_status = "PENDING"
        execution_status = "NOT_EXECUTED"
        confirmed_at = None
        simulated_at = None
    cursor = database.execute(
        """INSERT INTO communication_actions(
            action_type, recipient_person_id, reason, proposed_content, status,
            confirmation_status, execution_status, source_conversation_message_id,
            is_demo, created_at, confirmed_at, simulated_at, cancelled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
        (
            action_type,
            recipient_person_id,
            reason,
            proposed_content,
            status,
            confirmation_status,
            execution_status,
            source_conversation_message_id,
            is_demo,
            now,
            confirmed_at,
            simulated_at,
        ),
    )
    database.commit()
    row = database.execute(
        "SELECT * FROM communication_actions WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return dict(row), True


def transition_action(
    database: sqlite3.Connection, action_id: int, target: str
) -> dict[str, Any] | None:
    row = database.execute(
        "SELECT * FROM communication_actions WHERE id = ?", (action_id,)
    ).fetchone()
    if row is None:
        return None
    now = utc_text()
    if target == "CONFIRMED" and row["status"] == "PROPOSED":
        if row["action_type"] in {"SMS_REQUESTED", "CALL_REQUESTED"} and not row[
            "proposed_content"
        ]:
            raise ValueError("message or call purpose is required before confirmation")
        database.execute(
            """UPDATE communication_actions SET status = 'CONFIRMED',
            confirmation_status = 'CONFIRMED', confirmed_at = ? WHERE id = ?""",
            (now, action_id),
        )
    elif target == "SIMULATED" and row["status"] == "CONFIRMED":
        database.execute(
            """UPDATE communication_actions SET status = 'SIMULATED',
            execution_status = 'SIMULATED', simulated_at = ? WHERE id = ?""",
            (now, action_id),
        )
    elif target == "CANCELLED" and row["status"] in {"PROPOSED", "CONFIRMED"}:
        database.execute(
            """UPDATE communication_actions SET status = 'CANCELLED',
            confirmation_status = 'CANCELLED', cancelled_at = ? WHERE id = ?""",
            (now, action_id),
        )
    elif row["status"] != target:
        raise ValueError(f"cannot transition communication action from {row['status']} to {target}")
    database.commit()
    return dict(
        database.execute(
            "SELECT * FROM communication_actions WHERE id = ?", (action_id,)
        ).fetchone()
    )


def _active_proposal(database: sqlite3.Connection) -> sqlite3.Row | None:
    return database.execute(
        """SELECT * FROM communication_actions WHERE status = 'PROPOSED' AND is_demo = 0
        AND action_type != 'URGENT_HELP_REQUESTED'
        ORDER BY id DESC LIMIT 1"""
    ).fetchone()


def _recipient_name(database: sqlite3.Connection, person_id: int | None) -> str:
    if person_id is None:
        return "your caregiver"
    row = database.execute("SELECT name FROM people WHERE id = ?", (person_id,)).fetchone()
    return row["name"] if row else "your caregiver"


def _request_kind(message: str) -> str | None:
    normalized = normalize(message)
    words = set(normalized.split())
    if normalized.startswith(("text ", "message ")) or (
        words & {"text", "message"}
        and words & {"can", "could", "need", "please", "want", "would"}
    ):
        return "SMS_REQUESTED"
    if normalized.startswith("call ") or (
        "call" in words and words & {"can", "could", "need", "please", "want", "would"}
    ):
        return "CALL_REQUESTED"
    return None


def _is_status_question(message: str) -> bool:
    normalized = normalize(message)
    return normalized.startswith(("did you ", "have you ")) or "already" in normalized.split()


def _extract_purpose(message: str, action_type: str, recipient_name: str) -> str | None:
    escaped_name = re.escape(recipient_name)
    if action_type == "SMS_REQUESTED":
        pattern = rf"\b(?:text|message)\s+{escaped_name}\s+(?:that|to say|and say)\s+(.+)"
    else:
        pattern = rf"\bcall\s+{escaped_name}\s+(?:about|to discuss|because)\s+(.+)"
    match = re.search(pattern, message, flags=re.IGNORECASE)
    if match is None and action_type == "SMS_REQUESTED":
        match = re.search(
            r"\b(?:text|message)\b.+?\b(?:that|to say|and say)\s+(.+)",
            message,
            flags=re.IGNORECASE,
        )
    if match is None and action_type == "CALL_REQUESTED":
        match = re.search(
            r"\bcall\b.+?\b(?:about|to discuss|because)\s+(.+)",
            message,
            flags=re.IGNORECASE,
        )
    return match.group(1).strip(" .?!") if match else None


def _proposal_prompt(action_type: str, recipient_name: str, has_content: bool) -> str:
    if not has_content:
        if action_type == "SMS_REQUESTED":
            return f"Of course. What would you like me to tell {recipient_name}?"
        return f"Of course. What would you like the call with {recipient_name} to be about?"
    noun = "message" if action_type == "SMS_REQUESTED" else "call request"
    return f"Would you like me to prepare that {noun} for {recipient_name}?"


def process_communication_turn(
    database: sqlite3.Connection, message: str, source_message_id: int
) -> CommunicationTurnResult | None:
    normalized = normalize(message)
    urgent = any(phrase in normalized for phrase in EMERGENCY_PHRASES | URGENT_HELP_PHRASES)
    if urgent:
        recipient, _ = resolve_recipient(database, "caregiver")
        action, _ = create_action(
            database,
            action_type="URGENT_HELP_REQUESTED",
            recipient_person_id=recipient["id"] if recipient else None,
            reason=message,
            proposed_content="Urgent human assistance requested; no external contact was made.",
            source_conversation_message_id=source_message_id,
        )
        return CommunicationTurnResult(
            "This may be an emergency. Please call 911 or your local emergency number now, or ask "
            "someone nearby for immediate help. I recorded an urgent flag for the caregiver "
            "portal, but no call or message was sent.",
            action["id"],
        )

    active = _active_proposal(database)
    if active is not None:
        recipient_name = _recipient_name(database, active["recipient_person_id"])
        if _is_status_question(message):
            return CommunicationTurnResult(
                "No. Nothing has been sent or called. The request is still only a proposal.",
                active["id"],
            )
        if normalized in CANCELLATIONS or "cancel" in normalized.split():
            action = transition_action(database, active["id"], "CANCELLED")
            return CommunicationTurnResult(
                f"Alright. I cancelled that request for {recipient_name}. Nothing was sent or placed.",
                action["id"],
            )
        if normalized in CONFIRMATIONS:
            if not active["proposed_content"]:
                return CommunicationTurnResult(
                    "I still need to know what you would like me to prepare.", active["id"]
                )
            confirmed = transition_action(database, active["id"], "CONFIRMED")
            if active["action_type"] in {"SMS_REQUESTED", "CALL_REQUESTED"}:
                action = transition_action(database, confirmed["id"], "SIMULATED")
                noun = "message" if active["action_type"] == "SMS_REQUESTED" else "call request"
                ending = "sent" if active["action_type"] == "SMS_REQUESTED" else "placed"
                return CommunicationTurnResult(
                    f"I've prepared the {noun} for {recipient_name}. It hasn't been {ending}.",
                    action["id"],
                )
            return CommunicationTurnResult(
                f"I've recorded that you would like help from {recipient_name}. No message was sent.",
                confirmed["id"],
            )
        repeated_kind = _request_kind(message)
        if repeated_kind == active["action_type"]:
            repeated_recipient, _ = resolve_recipient(database, message)
            if repeated_recipient is not None and repeated_recipient["id"] == active[
                "recipient_person_id"
            ]:
                return CommunicationTurnResult(
                    _proposal_prompt(
                        active["action_type"],
                        recipient_name,
                        bool(active["proposed_content"]),
                    ),
                    active["id"],
                )
        if active["proposed_content"] is None:
            database.execute(
                "UPDATE communication_actions SET proposed_content = ? WHERE id = ?",
                (message, active["id"]),
            )
            database.commit()
            return CommunicationTurnResult(
                _proposal_prompt(active["action_type"], recipient_name, True), active["id"]
            )

    action_type = _request_kind(message)
    if action_type and not _is_status_question(message):
        recipient, named_but_unapproved = resolve_recipient(database, message)
        if recipient is None:
            if named_but_unapproved:
                return CommunicationTurnResult(
                    "I can only prepare contact requests for a caregiver-approved person."
                )
            return CommunicationTurnResult("Who would you like me to contact?")
        proposed_content = _extract_purpose(message, action_type, recipient["name"])
        action, created = create_action(
            database,
            action_type=action_type,
            recipient_person_id=recipient["id"],
            reason=f"User requested a simulated {action_type.lower().replace('_', ' ')}.",
            proposed_content=proposed_content,
            source_conversation_message_id=source_message_id,
        )
        if not created:
            if action["status"] == "SIMULATED":
                return CommunicationTurnResult(
                    "That simulated request is already prepared. Nothing was sent or placed.",
                    action["id"],
                )
            if action["status"] == "CONFIRMED":
                return CommunicationTurnResult(
                    "That request is already confirmed. Nothing was sent or placed.",
                    action["id"],
                )
            return CommunicationTurnResult(
                _proposal_prompt(action_type, recipient["name"], bool(action["proposed_content"])),
                action["id"],
            )
        return CommunicationTurnResult(
            _proposal_prompt(action_type, recipient["name"], proposed_content is not None),
            action["id"],
        )

    if normalized in {"i need help", "please help me"} or any(
        phrase in normalized for phrase in ASSISTANCE_PHRASES
    ):
        recipient, _ = resolve_recipient(database, "caregiver")
        if recipient is None:
            return CommunicationTurnResult(
                "I can record that you need help, but there isn't an approved caregiver contact yet."
            )
        action, created = create_action(
            database,
            action_type="CAREGIVER_ASSISTANCE",
            recipient_person_id=recipient["id"],
            reason=message,
            proposed_content=f"Caregiver assistance requested: {message}",
            source_conversation_message_id=source_message_id,
        )
        if not created and action["status"] == "CONFIRMED":
            return CommunicationTurnResult(
                f"That assistance request for {recipient['name']} is already recorded. "
                "No message was sent.",
                action["id"],
            )
        return CommunicationTurnResult(
            f"Would you like me to record a request for help from {recipient['name']}?",
            action["id"],
        )
    return None
