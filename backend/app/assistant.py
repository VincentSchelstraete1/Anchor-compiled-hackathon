import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.config import OPENAI_API_KEY, OPENAI_MODEL

FOLLOW_UP_WORDS = {
    "she",
    "he",
    "they",
    "them",
    "her",
    "him",
    "together",
    "that",
    "this",
    "it",
    "remember",
}
EMERGENCY_PHRASES = {
    "cant breathe",
    "cannot breathe",
    "chest pain",
    "severe bleeding",
    "unconscious",
    "overdose",
    "signs of a stroke",
}
MEDICATION_WORDS = {
    "dose",
    "dosage",
    "medication",
    "medications",
    "medicine",
    "medicines",
    "pill",
    "pills",
    "prescription",
    "refill",
}
MEDICATION_CHANGE_WORDS = {
    "change",
    "double",
    "extra",
    "interaction",
    "interactions",
    "more",
    "less",
    "missed",
    "overdose",
    "reaction",
    "reactions",
    "skip",
    "stop",
    "stopped",
    "twice",
}
MEDICATION_CHANGE_PHRASES = {
    "can i take",
    "how much",
    "side effect",
    "should i take",
    "take another",
    "take extra",
    "take it now",
    "take this now",
}
SYMPTOM_WORDS = {
    "dizzy",
    "faint",
    "fever",
    "headache",
    "pain",
    "sick",
    "symptom",
    "symptoms",
}
CONTACT_WORDS = {"call", "contact", "message", "text"}
ACTION_COMPLETION_PHRASES = {
    "call was placed",
    "i called",
    "i contacted",
    "i have called",
    "i have contacted",
    "ive called",
    "ive contacted",
    "i sent",
    "i have sent",
    "ive sent",
    "i texted",
    "i have texted",
    "ive texted",
    "message was sent",
}
EVENT_WORDS = {
    "visit",
    "visiting",
    "coming",
    "come",
    "arrive",
    "arrived",
    "arrival",
    "appointment",
    "appointments",
    "scheduled",
    "upcoming",
}
MEMORY_WORDS = {"memory", "memories", "remember", "did", "shared", "together"}
PREFERENCE_WORDS = {
    "hobbies",
    "hobby",
    "like",
    "likes",
    "love",
    "loves",
    "pastime",
    "pastimes",
    "favorite",
    "favourite",
    "prefer",
    "prefers",
    "enjoy",
    "enjoys",
}
ROUTINE_WORDS = {"routine", "usually", "always", "often", "activity", "activities", "doing"}
LOCATION_WORDS = {"address", "home", "live", "lived", "location", "place", "where"}
PERSONAL_FACT_WORDS = {
    "address",
    "age",
    "appointment",
    "appointments",
    "birthday",
    "blood",
    "born",
    "favorite",
    "favourite",
    "glasses",
    "hobbies",
    "hobby",
    "keys",
    "location",
    "medication",
    "medications",
    "memory",
    "memories",
    "preference",
    "preferences",
    "phone",
    "pastime",
    "pastimes",
    "routine",
    "routines",
    "schedule",
    "scheduled",
    "school",
    "schools",
    "wallet",
}
PERSONAL_EVENT_WORDS = {
    "appointment",
    "appointments",
    "arrive",
    "arrived",
    "coming",
    "scheduled",
    "upcoming",
    "visit",
    "visiting",
}
ITEM_WORDS = {"glasses", "keys", "phone", "wallet"}
LIVE_INFO_WORDS = {"news", "score", "scores", "traffic", "weather"}
LIVE_TIME_WORDS = {"current", "currently", "latest", "now", "today", "tonight"}
QUESTION_FILLER_WORDS = {
    "about",
    "does",
    "doing",
    "like",
    "tell",
    "together",
    "what",
    "with",
    "where",
    "your",
}
DAILY_PLAN_PHRASES = {
    "anything planned",
    "happening today",
    "plans today",
    "should i do this afternoon",
    "what is happening today",
    "whats happening today",
    "what should i do today",
}
MEMORY_DIFFICULTY_PHRASES = {
    "can t remember",
    "cant remember",
    "cannot remember",
    "confused about",
    "do not remember",
    "don t remember",
    "dont remember",
    "having trouble remembering",
}
CONVERSATION_RECALL_PHRASES = {
    "do you remember what we talked about",
    "what did we talk about",
    "what were we talking about",
}


@dataclass
class AssistantResult:
    content: str
    grounded: bool
    sources: list[dict[str, Any]]
    handoff_offered: bool
    verified_facts: list[str] = field(default_factory=list)


def answer_message(
    message: str,
    *,
    people: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    medications: list[dict[str, Any]],
    events: list[dict[str, Any]],
    handoffs: list[dict[str, Any]],
    history: list[dict[str, Any]],
    timezone: str = "UTC",
) -> AssistantResult:
    """Route safety first, personal facts to stored records, and ordinary chat to OpenAI."""
    rule_result = _safety_rule_answer(message)
    if rule_result is not None:
        return rule_result

    live_result = _live_information_answer(message)
    if live_result is not None:
        return live_result

    if any(phrase in _normalize(message) for phrase in CONVERSATION_RECALL_PHRASES):
        result = _openai_general_answer(message, history) if OPENAI_API_KEY else None
        return result or _general_fallback(message)

    personal_query = _is_personal_query(
        message, people=people, medications=medications, history=history
    )
    if not personal_query:
        result = _openai_general_answer(message, history) if OPENAI_API_KEY else None
        return result or _general_fallback(message)

    safe_result = _grounded_answer(
        message,
        people=people,
        memories=memories,
        medications=medications,
        events=events,
        handoffs=handoffs,
        history=history,
        timezone=timezone,
    )
    if safe_result.grounded:
        medication_query = bool(set(_normalize(message).split()) & MEDICATION_WORDS) or (
            _medication_mentioned(_normalize(message), medications) is not None
        )
        natural = (
            _openai_grounded_answer(message, safe_result, history)
            if OPENAI_API_KEY and not medication_query
            else None
        )
        return natural or safe_result
    return safe_result if safe_result.content else _unknown_personal(message, people)


def _safety_rule_answer(
    message: str,
) -> AssistantResult | None:
    normalized = _normalize(message)
    words = set(normalized.split())
    if any(phrase in normalized for phrase in EMERGENCY_PHRASES):
        return AssistantResult(
            (
                "This may be an emergency. Please call 911 or your local emergency number now, "
                "or ask someone nearby for immediate help."
            ),
            False,
            [],
            False,
        )

    if words & SYMPTOM_WORDS:
        return AssistantResult(
            (
                "I can't assess symptoms or diagnose a medical problem. Please contact a caregiver "
                "or clinician. If the symptoms are sudden, severe, or feel like an emergency, "
                "call 911 or your local emergency number now."
            ),
            False,
            [],
            False,
        )

    if words & CONTACT_WORDS:
        if words & {"did", "have", "already"}:
            return AssistantResult(
                "No. I haven't called, texted, or messaged anyone.", False, [], False
            )
        return AssistantResult(
            (
                "I can't place a call or send a message from Anchor. "
                "Please use your phone or ask someone nearby to help."
            ),
            False,
            [],
            False,
        )
    return None


def _is_personal_query(
    message: str,
    *,
    people: list[dict[str, Any]],
    medications: list[dict[str, Any]],
    history: list[dict[str, Any]],
) -> bool:
    normalized = _normalize(message)
    words = set(normalized.split())
    if any(phrase in normalized for phrase in DAILY_PLAN_PHRASES):
        return True
    if _resolve_person(message, people, history) is not None:
        return True
    if words & MEDICATION_WORDS or _medication_mentioned(normalized, medications) is not None:
        return True
    if words & {"my", "our"} and words & PERSONAL_FACT_WORDS:
        return True
    if "i" in words and words & {"age", "birthday", "born", "from", "live", "lived"}:
        return True
    if "i" in words and words & (
        MEMORY_WORDS | PREFERENCE_WORDS | ROUTINE_WORDS | LOCATION_WORDS
    ):
        return True
    if words & {"we", "our"} and words & {
        "family",
        "memory",
        "memories",
        "routine",
        "routines",
        "together",
        "usually",
    }:
        return True
    if words & PERSONAL_EVENT_WORDS and words & {
        "coming",
        "appointment",
        "appointments",
        "scheduled",
        "upcoming",
        "visit",
        "visiting",
        "who",
    }:
        return True
    return bool(words & {"family", "relative", "relatives"})


def _live_information_answer(message: str) -> AssistantResult | None:
    words = set(_normalize(message).split())
    if not (words & LIVE_INFO_WORDS and words & LIVE_TIME_WORDS):
        return None
    return AssistantResult(
        (
            "I don't have live information for that. Please check a current weather, news, "
            "traffic, or scores source."
        ),
        False,
        [],
        False,
    )


def _general_fallback(message: str) -> AssistantResult:
    words = set(_normalize(message).split())
    if words & {"hello", "hey", "hi"}:
        content = "Hello. It's good to hear from you. What would you like to talk about?"
    elif "thank" in words or "thanks" in words:
        content = "You're very welcome."
    elif {"how", "you"} <= words:
        content = "I'm glad to be here with you. How are you feeling today?"
    else:
        content = "I'm here with you. What would you like to talk about?"
    return AssistantResult(content, False, [], False)


def _grounded_answer(
    message: str,
    *,
    people: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    medications: list[dict[str, Any]],
    events: list[dict[str, Any]],
    handoffs: list[dict[str, Any]],
    history: list[dict[str, Any]],
    timezone: str,
) -> AssistantResult:
    normalized = _normalize(message)
    words = set(normalized.split())
    if words and words <= {"hi", "hello", "hey"}:
        return AssistantResult("Hello. How can I help?", False, [], False)

    if any(phrase in normalized for phrase in DAILY_PLAN_PHRASES):
        return _daily_plan_answer(
            people=people, memories=memories, events=events, timezone=timezone
        )

    existing_handoff = next(
        (
            item
            for item in handoffs
            if item["status"] in {"pending", "answered"}
            and _normalize(item["question"]) == normalized
        ),
        None,
    )
    if existing_handoff:
        caregiver = _person_by_id(people, existing_handoff["caregiver_person_id"])
        caregiver_name = caregiver["name"] if caregiver else "your caregiver"
        sources = [{"type": "handoff", "id": existing_handoff["id"]}]
        if caregiver:
            sources.append({"type": "person", "id": caregiver["id"]})
        if existing_handoff["status"] == "answered":
            return AssistantResult(
                f"{caregiver_name} answered: {existing_handoff['response']}",
                True,
                sources,
                False,
            )
        return AssistantResult(
            f"I've already asked {caregiver_name}, and the question is still waiting for an answer.",
            True,
            sources,
            False,
        )

    person = _resolve_person(message, people, history)
    named_medication = _medication_mentioned(normalized, medications)
    event_intent = bool(words & EVENT_WORDS)
    memory_difficulty = _expresses_memory_difficulty(normalized)
    personal_memory_intent = bool(
        words & (MEMORY_WORDS | PREFERENCE_WORDS | ROUTINE_WORDS | LOCATION_WORDS)
    )
    medication_intent = bool(words & MEDICATION_WORDS) or named_medication is not None

    if person is None and (
        memory_difficulty or words & (FOLLOW_UP_WORDS - {"remember"})
    ):
        return _unknown_personal(message, people)

    if medication_intent:
        return _medication_answer(
            message,
            medications=medications,
            memories=memories,
            people=people,
            person=person,
            named_medication=named_medication,
        )

    if person and (_asks_about_person(normalized, words, person) or memory_difficulty):
        return _person_orientation_answer(
            message=message,
            person=person,
            memories=memories,
        )

    if event_intent:
        upcoming = _upcoming_events(events, person_id=person["id"] if person else None)
        if upcoming:
            event = upcoming[0]
            event_person = _person_by_id(people, event["person_id"])
            name = event_person["name"] if event_person else "Someone"
            sources = [{"type": "event", "id": event["id"]}]
            if event_person:
                sources.append({"type": "person", "id": event_person["id"]})
            return AssistantResult(
                f"{name} is scheduled to visit at {event['start_time']}.",
                True,
                sources,
                False,
                [
                    f"{event['title']} is scheduled for {event['start_time']}.",
                    *(
                        [
                            (
                                f"{event_person['name']} is the person associated with this "
                                "scheduled event."
                            )
                        ]
                        if event_person
                        else []
                    ),
                ],
            )
        return _unknown_personal(message, people)

    reference_memory_intent = person is not None and bool(words & {"that", "this", "it"})
    if personal_memory_intent or reference_memory_intent:
        matching_memories = _relevant_memories(message, memories, person)
        if not matching_memories and reference_memory_intent:
            matching_memories = sorted(
                (memory for memory in memories if memory["person_id"] == person["id"]),
                key=lambda memory: (memory["created_at"], memory["id"]),
                reverse=True,
            )
        if matching_memories:
            memory = matching_memories[0]
            sources = [{"type": "memory", "id": memory["id"]}]
            if person:
                sources.append({"type": "person", "id": person["id"]})
            return AssistantResult(
                _memory_fallback(memory["content"]),
                True,
                sources,
                False,
                [f"Caregiver-confirmed memory: {memory['content']}"],
            )
        return _unknown_personal(message, people)

    if _is_family_list_question(words):
        if not people:
            return _unknown_personal(message, people)
        descriptions = [f"{item['name']} is your {item['relationship']}" for item in people]
        return AssistantResult(
            "; ".join(descriptions) + ".",
            True,
            [{"type": "person", "id": item["id"]} for item in people],
            False,
            [
                f"{item['name']}'s relationship is {item['relationship']}."
                for item in people
            ],
        )

    if person and _asks_about_person(normalized, words, person):
        description = f" {person['description']}" if person["description"] else ""
        return AssistantResult(
            f"{person['name']} is your {person['relationship']}.{description}",
            True,
            [{"type": "person", "id": person["id"]}],
            False,
            _person_facts(person),
        )

    return _unknown_personal(message, people)


def _person_orientation_answer(
    *,
    message: str,
    person: dict[str, Any],
    memories: list[dict[str, Any]],
) -> AssistantResult:
    normalized = _normalize(message)
    direct_identity_question = bool(
        set(normalized.split()) & {"who", "relationship", "related"}
        or "tell me about" in normalized
        or normalized == _normalize(person["name"])
    )
    person_memories = sorted(
        (memory for memory in memories if memory["person_id"] == person["id"]),
        key=lambda memory: (memory["created_at"], memory["id"]),
        reverse=True,
    )
    memory = person_memories[0] if person_memories else None
    facts = _person_facts(person)
    sources = [{"type": "person", "id": person["id"]}]
    if memory:
        facts.append(f"Caregiver-confirmed memory: {memory['content']}")
        sources.append({"type": "memory", "id": memory["id"]})
    if person.get("photo_url"):
        facts.append(f"A photograph of {person['name']} is available to show in the companion.")

    if _expresses_memory_difficulty(normalized) and not direct_identity_question:
        if person.get("photo_url"):
            fallback = f"That's alright. Would you like to see a picture of {person['name']}?"
        else:
            fallback = "That's alright. We can take it one step at a time."
    else:
        fallback = f"{person['name']} is your {person['relationship']}."
        if memory:
            fallback += f" {_memory_fallback(memory['content'])}"
        if person.get("photo_url"):
            fallback += " Would you like to see a picture?"

    return AssistantResult(fallback, True, sources, False, facts)


def _person_facts(person: dict[str, Any]) -> list[str]:
    facts = [f"{person['name']}'s relationship to the user is {person['relationship']}."]
    if person["description"]:
        facts.append(f"Caregiver-confirmed description: {person['description']}")
    return facts


def _memory_fallback(content: str) -> str:
    return f"The caregiver notes say {content[0].lower() + content[1:]}"


def _expresses_memory_difficulty(normalized: str) -> bool:
    return any(phrase in normalized for phrase in MEMORY_DIFFICULTY_PHRASES)


def _daily_plan_answer(
    *,
    people: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    events: list[dict[str, Any]],
    timezone: str,
) -> AssistantResult:
    zone = ZoneInfo(timezone)
    today = datetime.now(UTC).astimezone(zone).date()
    today_events = [
        event
        for event in events
        if event["status"] == "scheduled"
        and datetime.fromisoformat(event["start_time"]).astimezone(zone).date() == today
    ]
    today_events.sort(key=lambda event: (event["start_time"], event["id"]))
    routines = [
        memory
        for memory in memories
        if _normalize(memory["category"]) in {"routine", "routines", "activity", "activities"}
    ]
    details: list[str] = []
    sources: list[dict[str, Any]] = []
    for event in today_events[:3]:
        person = _person_by_id(people, event["person_id"])
        person_detail = f" with {person['name']}" if person else ""
        local_time = datetime.fromisoformat(event["start_time"]).astimezone(zone)
        details.append(f"{event['title']}{person_detail} at {local_time.strftime('%-I:%M %p')}")
        sources.append({"type": "event", "id": event["id"]})
        if person:
            sources.append({"type": "person", "id": person["id"]})
    if routines:
        routine = routines[0]
        details.append(f"your caregiver note also suggests: {routine['content']}")
        sources.append({"type": "memory", "id": routine["id"]})
    if not details:
        return AssistantResult(
            "I don't see anything caregiver-scheduled for today.", False, [], False
        )
    return AssistantResult(
        "For today, I have " + "; ".join(details) + ".",
        True,
        sources,
        False,
    )


def _asks_about_person(normalized: str, words: set[str], person: dict[str, Any]) -> bool:
    return (
        bool(words & {"who", "relationship", "related"})
        or "tell me about" in normalized
        or normalized == _normalize(person["name"])
    )


def _resolve_person(
    message: str, people: list[dict[str, Any]], history: list[dict[str, Any]]
) -> dict[str, Any] | None:
    normalized = _normalize(message)
    explicit = _person_mentioned(normalized, people)
    if explicit:
        return explicit

    words = set(normalized.split())
    relationship_matches = [
        person for person in people if set(_normalize(person["relationship"]).split()) & words
    ]
    if len(relationship_matches) == 1:
        return relationship_matches[0]

    if not words & FOLLOW_UP_WORDS:
        return None
    # Only prior user wording is used for reference resolution. Assistant output is never a fact.
    user_turns = [item["content"] for item in history if item["role"] == "user"]
    if user_turns and _normalize(user_turns[-1]) == normalized:
        user_turns.pop()
    for prior_message in reversed(user_turns):
        mentioned = _person_mentioned(_normalize(prior_message), people)
        if mentioned:
            return mentioned
        prior_words = set(_normalize(prior_message).split())
        matches = [
            person
            for person in people
            if set(_normalize(person["relationship"]).split()) & prior_words
        ]
        if len(matches) == 1:
            return matches[0]
    return None


def _person_mentioned(
    normalized_message: str, people: list[dict[str, Any]]
) -> dict[str, Any] | None:
    padded = f" {normalized_message} "
    return next(
        (person for person in people if f" {_normalize(person['name'])} " in padded),
        None,
    )


def _relevant_memories(
    message: str, memories: list[dict[str, Any]], person: dict[str, Any] | None
) -> list[dict[str, Any]]:
    words = set(_normalize(message).split())
    person_name_words = set(_normalize(person["name"]).split()) if person else set()
    meaningful_words = {word for word in words - person_name_words if len(word) > 3}
    topic_words = meaningful_words - (
        PREFERENCE_WORDS | ROUTINE_WORDS | MEMORY_WORDS | LOCATION_WORDS | QUESTION_FILLER_WORDS
    )
    candidates = [
        memory for memory in memories if person is None or memory["person_id"] == person["id"]
    ]

    def score(memory: dict[str, Any]) -> tuple[int, str, int]:
        searchable = set(
            _normalize(f"{memory['title']} {memory['category']} {memory['content']}").split()
        )
        if topic_words and not topic_words & searchable:
            return (0, memory["created_at"], memory["id"])
        overlap = len(meaningful_words & searchable)
        category = _normalize(memory["category"])
        if words & MEMORY_WORDS and not topic_words:
            overlap += 1
        if words & PREFERENCE_WORDS and (
            category in {"preference", "preferences", "favorite"} or searchable & PREFERENCE_WORDS
        ):
            overlap += 4
        if words & ROUTINE_WORDS and (
            category in {"routine", "routines", "activity", "activities"}
            or searchable & ROUTINE_WORDS
        ):
            overlap += 4
        if words & LOCATION_WORDS and (
            category in {"address", "home", "location", "place", "places"}
            or searchable & LOCATION_WORDS
        ):
            overlap += 4
        return (overlap, memory["created_at"], memory["id"])

    ranked = sorted(candidates, key=score, reverse=True)
    return [memory for memory in ranked if score(memory)[0] > 0]


def _upcoming_events(
    events: list[dict[str, Any]], *, person_id: int | None
) -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    upcoming = []
    for event in events:
        start = datetime.fromisoformat(event["start_time"])
        if (
            event["status"] == "scheduled"
            and start > now
            and (person_id is None or event["person_id"] == person_id)
        ):
            upcoming.append(event)
    return sorted(upcoming, key=lambda event: (event["start_time"], event["id"]))


def _medication_mentioned(
    normalized_message: str, medications: list[dict[str, Any]]
) -> dict[str, Any] | None:
    padded = f" {normalized_message} "
    return next(
        (
            medication
            for medication in medications
            if f" {_normalize(medication['name'])} " in padded
        ),
        None,
    )


def _medication_answer(
    message: str,
    *,
    medications: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    people: list[dict[str, Any]],
    person: dict[str, Any] | None,
    named_medication: dict[str, Any] | None,
) -> AssistantResult:
    normalized = _normalize(message)
    words = set(normalized.split())
    candidates = [
        medication
        for medication in medications
        if medication["active"] and (person is None or medication["person_id"] == person["id"])
    ]
    selected = named_medication or (candidates[0] if len(candidates) == 1 else None)
    safety_question = bool(words & MEDICATION_CHANGE_WORDS) or any(
        phrase in normalized for phrase in MEDICATION_CHANGE_PHRASES
    )

    if safety_question:
        if selected:
            sources = _medication_sources(selected, people)
            return AssistantResult(
                f"Your caregiver record says {selected['name']} is {selected['dosage']}, "
                f"{selected['frequency'].lower()}. I can't safely tell whether to change, skip, "
                "or make up a dose. Please check the prescription label and ask your caregiver, "
                "pharmacist, or clinician.",
                True,
                sources,
                True,
            )
        return AssistantResult(
            "I can't safely tell you whether to change, skip, or make up a medicine dose. "
            "Please check the prescription label and ask your caregiver, pharmacist, or clinician.",
            False,
            [],
            True,
        )

    if selected:
        sources = _medication_sources(selected, people)
        if words & {"where", "kept", "located", "find"}:
            content = (
                f"Your caregiver record says {selected['name']} is kept {selected['location']}."
            )
        elif words & {"refill", "refills"}:
            refill = selected["refill_date"]
            content = (
                f"Your caregiver record says {selected['name']} needs a refill by {refill}."
                if refill
                else f"There is no refill date recorded for {selected['name']}."
            )
        elif words & {"why", "purpose"} or "what is" in normalized and " for" in normalized:
            content = f"Your caregiver record says {selected['name']} is for: {selected['purpose']}"
        else:
            content = (
                f"Your caregiver record says {selected['name']} is {selected['dosage']}, "
                f"{selected['frequency'].lower()}, and is kept {selected['location']}."
            )
        return AssistantResult(content, True, sources, False)

    if candidates:
        if words & {"where", "kept", "located", "find"}:
            details = "; ".join(f"{item['name']} is kept {item['location']}" for item in candidates)
        elif words & {"refill", "refills"}:
            details = "; ".join(
                f"{item['name']}: {item['refill_date'] or 'no refill date recorded'}"
                for item in candidates
            )
        else:
            details = "; ".join(
                f"{item['name']}, {item['dosage']}, {item['frequency'].lower()}"
                for item in candidates
            )
        sources = []
        for item in candidates:
            sources.extend(_medication_sources(item, people))
        unique_sources = list(
            {(source["type"], source["id"]): source for source in sources}.values()
        )
        return AssistantResult(
            f"Your caregiver record lists: {details}.",
            True,
            unique_sources,
            False,
        )
    medication_memories = [
        memory
        for memory in memories
        if _normalize(memory["category"])
        in {"medication", "medications", "medicine", "prescription"}
    ]
    if medication_memories:
        memory = max(
            medication_memories,
            key=lambda item: (item["created_at"], item["id"]),
        )
        return AssistantResult(
            (
                f"A caregiver note says: {memory['content']} "
                "Please follow the medication label and check with a caregiver, pharmacist, "
                "or clinician before making any change."
            ),
            True,
            [{"type": "memory", "id": memory["id"]}],
            False,
        )
    return _unknown_personal(message, people)


def _medication_sources(
    medication: dict[str, Any], people: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    sources = [{"type": "medication", "id": medication["id"]}]
    person = _person_by_id(people, medication["person_id"])
    if person:
        sources.append({"type": "person", "id": person["id"]})
    return sources


def _person_by_id(people: list[dict[str, Any]], person_id: int | None) -> dict[str, Any] | None:
    return next((person for person in people if person["id"] == person_id), None)


def _is_family_list_question(words: set[str]) -> bool:
    return bool(words & {"family", "relatives", "people"}) and bool(words & {"who", "list", "tell"})


def _caregiver_name(people: list[dict[str, Any]]) -> str:
    caregiver = next(
        (
            person
            for person in people
            if "caregiver"
            in _normalize(f"{person['relationship']} {person['description']}").split()
        ),
        None,
    )
    return caregiver["name"] if caregiver else "your caregiver"


def _unknown_personal(message: str, people: list[dict[str, Any]]) -> AssistantResult:
    words = set(_normalize(message).split())
    caregiver = _caregiver_name(people)
    if "where" in words and words & ITEM_WORDS:
        item = next(word for word in ITEM_WORDS if word in words)
        verb = "is" if item == "phone" else "are"
        pronoun = "it" if item == "phone" else "them"
        content = (
            f"I don't know where your {item} {verb}. Try checking the places you usually set {pronoun} "
            f"down, your pockets, and nearby surfaces. Would you like me to ask {caregiver}?"
        )
    elif words & PERSONAL_EVENT_WORDS:
        content = (
            "I don't have a caregiver-confirmed schedule for that. "
            f"Would you like me to ask {caregiver}?"
        )
    else:
        content = (
            "I don't have that information in the caregiver notes yet. "
            f"Would you like me to ask {caregiver}?"
        )
    return AssistantResult(content, False, [], True)


def _normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def _openai_grounded_answer(
    message: str,
    verified: AssistantResult,
    history: list[dict[str, Any]],
) -> AssistantResult | None:
    if verified.handoff_offered or any(
        source["type"] == "handoff" for source in verified.sources
    ):
        return None
    system = (
        "You are Anchor, a warm, capable conversational companion for an older adult who may have "
        "memory difficulties. Respond to the user's actual intent or feeling first, then use only "
        "the VERIFIED_FACTS that are helpful. Never quote a database record mechanically or say "
        "'a stored memory says.' Prioritize a person's identity or relationship before a shared "
        "memory. For confusion or difficulty remembering, be patient and direct without testing, "
        "correcting, infantilizing, or insisting the user remember. Offer a photo only when a "
        "verified fact says one is available. Keep the response natural and suitable for speech, "
        "usually one to three short sentences. A relevant follow-up question is optional, not "
        "required. RECENT_CONVERSATION is only for conversational continuity and is never a source "
        "of personal facts; prior assistant statements are not authoritative. Do not add, infer, "
        "or guess any person, relationship, memory, preference, location, medication, date, time, "
        "event status, or completed action. A scheduled event is only a plan; never imply it "
        "occurred or that someone arrived. Return JSON that matches the required schema."
    )
    messages = [{"role": "system", "content": system}]
    messages.append(
        {
            "role": "user",
            "content": json.dumps(
                {
                    "user_message": message,
                    "response_intent": _response_intent(message),
                    "verified_facts": verified.verified_facts or [verified.content],
                    "verified_sources": verified.sources,
                    "recent_conversation": history[-8:],
                }
            ),
        }
    )
    content = _request_openai_content(messages, "anchor_grounded_response", temperature=0.2)
    if content is None or not _safe_grounded_response(content, verified):
        return None
    return AssistantResult(content, True, verified.sources, False)


def _openai_general_answer(message: str, history: list[dict[str, Any]]) -> AssistantResult | None:
    system = (
        "You are Anchor, a warm, capable conversational companion for an older adult. Respond to "
        "what the user actually said in a calm, respectful, natural voice. Keep most answers to "
        "one to three short sentences suitable for speech. Be present with loneliness, answer "
        "ordinary questions helpfully, and ask one simple clarifying question when the user is "
        "confused and their meaning is unclear. Avoid customer-service phrasing, excessive "
        "reassurance, infantilizing language, repeated introductions, and a question at the end of "
        "every response. Do not invent or assert personal facts, relationships, memories, "
        "schedules, medications, locations, or actions. Do not claim you called, texted, messaged, "
        "scheduled, or contacted anyone. Do not provide personalized medical advice. Use "
        "conversation history only for continuity and discussion recall, never as authoritative "
        "personal data. Never treat a previous assistant statement as caregiver-confirmed. If "
        "asked about live weather, news, scores, traffic, prices, or other current external "
        "information, clearly say you do not have live access and suggest checking a current "
        "source. Return JSON that matches the required schema."
    )
    messages = [{"role": "system", "content": system}]
    recent = history[-10:]
    messages.extend({"role": item["role"], "content": item["content"]} for item in recent)
    if not recent or recent[-1]["role"] != "user" or recent[-1]["content"] != message:
        messages.append({"role": "user", "content": message})
    content = _request_openai_content(messages, "anchor_general_response", temperature=0.6)
    if content is None or not _safe_general_response(content):
        return None
    return AssistantResult(content, False, [], False)


def _request_openai_content(
    messages: list[dict[str, str]], schema_name: str, *, temperature: float
) -> str | None:
    payload = json.dumps(
        {
            "model": OPENAI_MODEL,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {"content": {"type": "string"}},
                        "required": ["content"],
                        "additionalProperties": False,
                    },
                },
            },
            "temperature": temperature,
            "max_tokens": 180,
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
        parsed = json.loads(body["choices"][0]["message"]["content"])
        return str(parsed["content"]).strip()
    except (KeyError, TypeError, ValueError, urllib.error.URLError, TimeoutError):
        return None


def _safe_general_response(content: str) -> bool:
    normalized = _normalize(content)
    return (
        bool(content)
        and len(content) <= 1000
        and not any(phrase in normalized for phrase in ACTION_COMPLETION_PHRASES)
    )


def _safe_grounded_response(content: str, verified: AssistantResult) -> bool:
    if not _safe_general_response(content):
        return False
    normalized = _normalize(content)
    verified_normalized = _normalize(
        " ".join([verified.content, *verified.verified_facts])
    )
    response_numbers = set(re.findall(r"\d+", normalized))
    verified_numbers = set(re.findall(r"\d+", verified_normalized))
    if not response_numbers <= verified_numbers:
        return False
    if any(source["type"] == "event" for source in verified.sources) and any(
        phrase in normalized
        for phrase in ("already visited", "has arrived", "have arrived", "visit happened")
    ):
        return False
    if set(normalized.split()) & {"photo", "photograph", "picture"} and not (
        set(verified_normalized.split()) & {"photo", "photograph", "picture"}
    ):
        return False
    verified_words = {word for word in verified_normalized.split() if len(word) > 3}
    response_words = {word for word in normalized.split() if len(word) > 3}
    return bool(verified_words & response_words)


def _response_intent(message: str) -> str:
    normalized = _normalize(message)
    if _expresses_memory_difficulty(normalized):
        return "patiently orient or support the user without implying they should remember"
    if any(phrase in normalized for phrase in DAILY_PLAN_PHRASES):
        return "briefly explain today's verified plans"
    if set(normalized.split()) & EVENT_WORDS:
        return "answer the scheduling question without implying the event happened"
    return "answer the personal question directly using only verified facts"
