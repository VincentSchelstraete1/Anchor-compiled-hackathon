import json
import re
import sqlite3
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from app.config import OPENAI_API_KEY, OPENAI_MODEL
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
MEDICATION_WORDS = {"medicine", "medication", "medications", "pill", "pills", "prescription"}
REFILL_PHRASES = {"almost out", "need a refill", "need more", "running low", "running out"}
LOCATION_PHRASES = {"can t find", "cannot find", "don t know where", "lost", "where is"}
APPOINTMENT_CHANGE_PHRASES = {
    "can t make it",
    "cannot make it",
    "change my appointment",
    "miss my appointment",
    "move my appointment",
    "reschedule",
}
FAMILY_CONTACT_PHRASES = {
    "haven t spoken",
    "miss talking",
    "want to talk to",
    "wish i could talk",
}
GENERAL_HELP_PHRASES = {
    "i am having trouble with something",
    "i m having trouble with something",
    "i need help",
    "i need some help",
    "please help me",
}
MEDICAL_CONTACT_WORDS = {
    "clinic",
    "doctor",
    "medical",
    "office",
    "pharmacist",
    "pharmacy",
    "physician",
    "prescriber",
    "prescribing",
}
UNSAFE_COMPLETION_PHRASES = {
    "already called",
    "already contacted",
    "already sent",
    "has been called",
    "has been sent",
    "i called",
    "i contacted",
    "i sent",
    "i have called",
    "i have sent",
    "i ve called",
    "i ve sent",
    "message was sent",
    "call was placed",
}


@dataclass
class CommunicationTurnResult:
    content: str
    action_id: int | None = None
    grounded: bool = False
    sources: list[dict[str, Any]] = field(default_factory=list)


def normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def _approved_people(database: sqlite3.Connection) -> list[sqlite3.Row]:
    return database.execute(
        "SELECT * FROM people WHERE contact_approved = 1 ORDER BY id"
    ).fetchall()


def _caregiver_contact(database: sqlite3.Connection) -> sqlite3.Row | None:
    return next(
        (
            person
            for person in _approved_people(database)
            if "caregiver"
            in normalize(f"{person['relationship']} {person['description']}").split()
        ),
        None,
    )


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


def _recent_context(database: sqlite3.Connection) -> list[dict[str, str]]:
    rows = database.execute(
        """SELECT role, content FROM (
            SELECT id, role, content FROM conversation_messages ORDER BY id DESC LIMIT 8
        ) ORDER BY id"""
    ).fetchall()
    return [{"role": row["role"], "content": row["content"]} for row in rows]


def _implicit_need(message: str, history: list[dict[str, str]]) -> str | None:
    normalized = normalize(message)
    words = set(normalized.split())
    prior_user_text = " ".join(
        normalize(item["content"]) for item in history[-4:] if item["role"] == "user"
    )
    context_words = set(f"{prior_user_text} {normalized}".split())
    medication_context = bool(context_words & MEDICATION_WORDS)
    if medication_context and any(phrase in normalized for phrase in LOCATION_PHRASES):
        return "MEDICATION_LOCATION"
    if medication_context and (
        any(phrase in normalized for phrase in REFILL_PHRASES) or "refill" in words
    ):
        return "MEDICATION_REFILL"
    appointment_context = "appointment" in context_words or bool(
        context_words & {"clinic", "doctor"}
    )
    if appointment_context and any(
        phrase in normalized for phrase in APPOINTMENT_CHANGE_PHRASES
    ):
        return "APPOINTMENT_CHANGE"
    if any(phrase in normalized for phrase in FAMILY_CONTACT_PHRASES):
        return "FAMILY_CONTACT"
    return None


def _medical_contact(
    database: sqlite3.Connection, message: str, history: list[dict[str, str]]
) -> sqlite3.Row | None:
    approved = _approved_people(database)
    context = " ".join([message, *(item["content"] for item in history[-4:])])
    normalized_context = normalize(context)

    def is_medical(person: sqlite3.Row) -> bool:
        searchable = set(
            normalize(f"{person['relationship']} {person['description']}").split()
        )
        return bool(searchable & MEDICAL_CONTACT_WORDS)

    all_people = database.execute("SELECT * FROM people ORDER BY id").fetchall()
    prior_users = [item["content"] for item in history if item["role"] == "user"]
    for candidate in [message, *reversed(prior_users[:-1])]:
        padded = f" {normalize(candidate)} "
        named = next(
            (
                person
                for person in all_people
                if f" {normalize(person['name'])} " in padded
            ),
            None,
        )
        if named is not None:
            return named if named["contact_approved"] and is_medical(named) else None

    def score(person: sqlite3.Row) -> int:
        searchable = normalize(
            f"{person['name']} {person['relationship']} {person['description']}"
        )
        role_matches = len(set(searchable.split()) & MEDICAL_CONTACT_WORDS)
        explicit = 10 if normalize(person["name"]) in normalized_context else 0
        prescribing = 5 if "prescrib" in searchable else 0
        return explicit + prescribing + role_matches

    candidates = [person for person in approved if is_medical(person) and score(person) > 0]
    if not candidates:
        return None
    highest = max(score(person) for person in candidates)
    best = [person for person in candidates if score(person) == highest]
    return best[0] if len(best) == 1 else None


def _family_contact(
    database: sqlite3.Connection, message: str, history: list[dict[str, str]]
) -> sqlite3.Row | None:
    approved = _approved_people(database)
    prior_users = [item["content"] for item in history if item["role"] == "user"]
    candidates = [message, *reversed(prior_users[:-1])]
    for candidate in candidates:
        normalized = normalize(candidate)
        padded = f" {normalized} "
        named = next(
            (
                person
                for person in approved
                if f" {normalize(person['name'])} " in padded
            ),
            None,
        )
        if named:
            return named
        relationship_matches = [
            person
            for person in approved
            if set(normalize(person["relationship"]).split()) & set(normalized.split())
        ]
        if len(relationship_matches) == 1:
            return relationship_matches[0]
    return None


def _medication_storage_memory(database: sqlite3.Connection) -> sqlite3.Row | None:
    rows = database.execute(
        "SELECT * FROM memories ORDER BY created_at DESC, id DESC"
    ).fetchall()
    storage_words = {"cabinet", "drawer", "kept", "location", "shelf", "store", "stored"}
    return next(
        (
            row
            for row in rows
            if set(normalize(f"{row['title']} {row['category']} {row['content']}").split())
            & storage_words
            and set(normalize(row["content"]).split()) & MEDICATION_WORDS
        ),
        None,
    )


def _unresolved_issue_action(
    database: sqlite3.Connection,
    *,
    action_type: str,
    recipient_person_id: int,
    reason_prefix: str,
) -> sqlite3.Row | None:
    return database.execute(
        """SELECT * FROM communication_actions WHERE action_type = ?
        AND recipient_person_id = ? AND reason LIKE ?
        AND status IN ('PROPOSED', 'CONFIRMED') ORDER BY id DESC LIMIT 1""",
        (action_type, recipient_person_id, f"{reason_prefix}%"),
    ).fetchone()


def _request_assistance_plan(
    *,
    message: str,
    need_type: str,
    action_type: str,
    recipient: sqlite3.Row,
    history: list[dict[str, str]],
    events: list[dict[str, Any]],
    memories: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not OPENAI_API_KEY:
        return None
    system = (
        "You are the planning component for Anchor, a companion for an older adult. Decide whether "
        "the user message expresses the supplied CANDIDATE_NEED. If it does, write a concise "
        "reason, a proposed communication purpose, and a warm conversational response that offers "
        "to prepare the action for the VERIFIED_RECIPIENT and asks for confirmation. Use only the "
        "provided caregiver-confirmed context. Never choose a different recipient. Never say a "
        "call or message was sent, placed, completed, or executed. Never advise changing, skipping, "
        "or increasing medication. Do not classify emergencies; emergency handling happens before "
        "this planner. Return JSON matching the schema."
    )
    context = {
        "user_message": message,
        "candidate_need": need_type,
        "candidate_action_type": action_type,
        "verified_recipient": {
            "id": recipient["id"],
            "name": recipient["name"],
            "relationship": recipient["relationship"],
            "description": recipient["description"],
        },
        "recent_conversation": history,
        "scheduled_events": events,
        "relevant_caregiver_memories": memories,
    }
    payload = json.dumps(
        {
            "model": OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(context)},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "anchor_assistance_plan",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "should_propose": {"type": "boolean"},
                            "need_type": {
                                "type": "string",
                                "enum": [
                                    "MEDICATION_REFILL",
                                    "MEDICATION_LOCATION",
                                    "APPOINTMENT_CHANGE",
                                    "FAMILY_CONTACT",
                                    "NONE",
                                ],
                            },
                            "reason": {"type": "string"},
                            "proposed_content": {"type": "string"},
                            "response": {"type": "string"},
                        },
                        "required": [
                            "should_propose",
                            "need_type",
                            "reason",
                            "proposed_content",
                            "response",
                        ],
                        "additionalProperties": False,
                    },
                },
            },
            "temperature": 0.2,
            "max_tokens": 250,
            "store": False,
        }
    ).encode()
    request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.loads(response.read())
        return json.loads(body["choices"][0]["message"]["content"])
    except (KeyError, TypeError, ValueError, urllib.error.URLError, TimeoutError):
        return None


def _safe_plan(
    plan: dict[str, Any] | None, *, need_type: str, recipient_name: str
) -> bool:
    if not plan or not plan.get("should_propose") or plan.get("need_type") != need_type:
        return False
    values = [plan.get("reason"), plan.get("proposed_content"), plan.get("response")]
    if not all(isinstance(value, str) and 0 < len(value.strip()) <= 2000 for value in values):
        return False
    combined = normalize(" ".join(values))
    if any(phrase in combined for phrase in UNSAFE_COMPLETION_PHRASES):
        return False
    if any(
        phrase in combined
        for phrase in ("double the dose", "skip a dose", "stop taking", "take extra")
    ):
        return False
    return normalize(recipient_name) in normalize(plan["response"])


def _implicit_action_result(
    database: sqlite3.Connection,
    *,
    message: str,
    source_message_id: int,
    history: list[dict[str, str]],
) -> CommunicationTurnResult | None:
    need_type = _implicit_need(message, history)
    if need_type is None:
        return None
    if need_type == "MEDICATION_LOCATION":
        storage = _medication_storage_memory(database)
        if storage is not None:
            return CommunicationTurnResult(
                f"The caregiver notes say {storage['content'][0].lower() + storage['content'][1:]}",
                grounded=True,
                sources=[{"type": "memory", "id": storage["id"]}],
            )
        recipient = _caregiver_contact(database)
        action_type = "CAREGIVER_ASSISTANCE"
        reason_prefix = "Medication location assistance requested."
        fallback_content = "Help locate the user's medication safely."
        fallback_response = (
            f"I don't have a verified storage location. I can prepare a request for "
            f"{recipient['name']} to help locate it. Would you like me to do that?"
            if recipient
            else "I don't have a verified storage location. Which approved caregiver should help?"
        )
    elif need_type in {"MEDICATION_REFILL", "APPOINTMENT_CHANGE"}:
        recipient = _medical_contact(database, message, history)
        action_type = "CALL_REQUESTED"
        if need_type == "MEDICATION_REFILL":
            reason_prefix = "Medication refill assistance requested."
            fallback_content = "Ask about arranging a prescription refill."
            unknown_response = (
                "I can help prepare a refill inquiry, but I don't have a verified prescribing "
                "office or medical contact. Which approved contact should it be for?"
            )
        else:
            reason_prefix = "Appointment change assistance requested."
            fallback_content = "Ask about changing the scheduled appointment."
            unknown_response = (
                "I can help prepare an appointment-change request, but I don't have a verified "
                "office contact. Which approved contact should it be for?"
            )
        fallback_response = (
            f"I can help prepare that request for {recipient['name']}. Would you like me to?"
            if recipient
            else unknown_response
        )
    else:
        recipient = _family_contact(database, message, history)
        action_type = "CALL_REQUESTED"
        reason_prefix = "Family call assistance requested."
        fallback_content = "Prepare a call so the user can catch up with this family member."
        fallback_response = (
            f"I can help prepare a call with {recipient['name']}. Would you like me to?"
            if recipient
            else "Who would you like to talk with?"
        )

    if recipient is None:
        return CommunicationTurnResult(fallback_response)
    existing = _unresolved_issue_action(
        database,
        action_type=action_type,
        recipient_person_id=recipient["id"],
        reason_prefix=reason_prefix,
    )
    if existing is not None:
        return CommunicationTurnResult(
            f"I still have that request for {recipient['name']} ready for your confirmation. "
            "Nothing has been sent or called.",
            existing["id"],
            True,
            [{"type": "person", "id": recipient["id"]}],
        )

    event_rows = database.execute(
        """SELECT * FROM events WHERE status = 'scheduled'
        ORDER BY start_time LIMIT 10"""
    ).fetchall()
    memory_rows = database.execute(
        "SELECT * FROM memories ORDER BY created_at DESC, id DESC LIMIT 10"
    ).fetchall()
    plan = _request_assistance_plan(
        message=message,
        need_type=need_type,
        action_type=action_type,
        recipient=recipient,
        history=history,
        events=[dict(row) for row in event_rows],
        memories=[dict(row) for row in memory_rows],
    )
    if _safe_plan(plan, need_type=need_type, recipient_name=recipient["name"]):
        reason = f"{reason_prefix} {plan['reason'].strip()}"
        proposed_content = plan["proposed_content"].strip()
        response = plan["response"].strip()
    else:
        reason = reason_prefix
        proposed_content = fallback_content
        response = fallback_response
    action, _ = create_action(
        database,
        action_type=action_type,
        recipient_person_id=recipient["id"],
        reason=reason,
        proposed_content=proposed_content,
        source_conversation_message_id=source_message_id,
    )
    return CommunicationTurnResult(
        response,
        action["id"],
        True,
        [{"type": "person", "id": recipient["id"]}],
    )


def process_communication_turn(
    database: sqlite3.Connection, message: str, source_message_id: int
) -> CommunicationTurnResult | None:
    normalized = normalize(message)
    history = _recent_context(database)
    urgent = any(phrase in normalized for phrase in EMERGENCY_PHRASES | URGENT_HELP_PHRASES)
    if urgent:
        recipient = _caregiver_contact(database)
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

    implicit_result = _implicit_action_result(
        database,
        message=message,
        source_message_id=source_message_id,
        history=history,
    )
    if implicit_result is not None:
        return implicit_result

    if normalized in GENERAL_HELP_PHRASES:
        return CommunicationTurnResult(
            "Of course. What are you having trouble with, and what kind of help would be useful?"
        )

    if any(phrase in normalized for phrase in ASSISTANCE_PHRASES):
        recipient = _caregiver_contact(database)
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
