import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.config import OPENAI_API_KEY, OPENAI_MODEL

UNKNOWN_PHRASES = ("don't know", "do not know", "don't have", "do not have")
FOLLOW_UP_WORDS = {"she", "he", "they", "them", "her", "him", "together"}
EVENT_WORDS = {
    "visit",
    "visiting",
    "coming",
    "come",
    "arrive",
    "arrived",
    "arrival",
    "event",
    "events",
    "upcoming",
    "when",
}
MEMORY_WORDS = {"memory", "memories", "remember", "did", "shared", "together"}
PREFERENCE_WORDS = {
    "like",
    "likes",
    "love",
    "loves",
    "favorite",
    "favourite",
    "prefer",
    "prefers",
    "enjoy",
    "enjoys",
}
ROUTINE_WORDS = {"routine", "usually", "always", "often", "activity", "activities", "doing"}
QUESTION_FILLER_WORDS = {
    "about",
    "does",
    "doing",
    "like",
    "tell",
    "together",
    "what",
    "with",
    "your",
}


@dataclass
class AssistantResult:
    content: str
    grounded: bool
    sources: list[dict[str, Any]]
    handoff_offered: bool


def answer_message(
    message: str,
    *,
    people: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    events: list[dict[str, Any]],
    handoffs: list[dict[str, Any]],
    history: list[dict[str, Any]],
) -> AssistantResult:
    """Answer from structured caregiver-provided records, never from assistant prose."""
    safe_result = _grounded_answer(
        message,
        people=people,
        memories=memories,
        events=events,
        handoffs=handoffs,
        history=history,
    )
    if safe_result.grounded or not safe_result.handoff_offered:
        return safe_result

    context = {
        "people": people,
        "memories": memories,
        "events": events,
        "handoffs": handoffs,
    }
    if OPENAI_API_KEY:
        result = _openai_unknown_answer(message, context, history)
        if result is not None and _safe_unknown_response(result):
            # Keep caregiver identity and wording deterministic even after a valid LLM response.
            return safe_result
    return safe_result


def _grounded_answer(
    message: str,
    *,
    people: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    events: list[dict[str, Any]],
    handoffs: list[dict[str, Any]],
    history: list[dict[str, Any]],
) -> AssistantResult:
    normalized = _normalize(message)
    words = set(normalized.split())
    if words and words <= {"hi", "hello", "hey"}:
        return AssistantResult("Hello. How can I help?", False, [], False)

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
    event_intent = bool(words & EVENT_WORDS)
    personal_memory_intent = bool(words & (MEMORY_WORDS | PREFERENCE_WORDS | ROUTINE_WORDS))

    if words & FOLLOW_UP_WORDS and person is None:
        return _unknown(people)

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
            )
        return _unknown(people)

    if personal_memory_intent:
        matching_memories = _relevant_memories(message, memories, person)
        if matching_memories:
            memory = matching_memories[0]
            sources = [{"type": "memory", "id": memory["id"]}]
            if person:
                sources.append({"type": "person", "id": person["id"]})
            return AssistantResult(
                f"A stored memory says: {memory['content']}", True, sources, False
            )
        return _unknown(people)

    if _is_family_list_question(words):
        if not people:
            return _unknown(people)
        descriptions = [f"{item['name']} is your {item['relationship']}" for item in people]
        return AssistantResult(
            "; ".join(descriptions) + ".",
            True,
            [{"type": "person", "id": item["id"]} for item in people],
            False,
        )

    if person:
        description = f" {person['description']}" if person["description"] else ""
        return AssistantResult(
            f"{person['name']} is your {person['relationship']}.{description}",
            True,
            [{"type": "person", "id": person["id"]}],
            False,
        )

    return _unknown(people)


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
        PREFERENCE_WORDS | ROUTINE_WORDS | MEMORY_WORDS | QUESTION_FILLER_WORDS
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


def _unknown(people: list[dict[str, Any]]) -> AssistantResult:
    return AssistantResult(
        f"I don't have that information. Would you like me to ask {_caregiver_name(people)}?",
        False,
        [],
        True,
    )


def _normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def _openai_unknown_answer(
    message: str, context: dict[str, list[dict[str, Any]]], history: list[dict[str, Any]]
) -> AssistantResult | None:
    system = (
        "You are Anchor, a calm memory companion. The deterministic grounding system could not "
        "support this answer. Do not state any personal fact. Briefly say you do not have the "
        "information and offer a caregiver handoff. Return JSON only with content, grounded=false, "
        "sources=[], and handoff_offered=true."
    )
    messages = [{"role": "system", "content": system}]
    messages.extend({"role": item["role"], "content": item["content"]} for item in history[-12:])
    messages.append(
        {
            "role": "user",
            "content": f"STORED_CONTEXT={json.dumps(context)}\nQUESTION={message}",
        }
    )
    payload = json.dumps(
        {
            "model": OPENAI_MODEL,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "temperature": 0,
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
        return AssistantResult(
            content=str(parsed["content"]).strip(),
            grounded=bool(parsed["grounded"]),
            sources=list(parsed["sources"]),
            handoff_offered=bool(parsed["handoff_offered"]),
        )
    except (KeyError, TypeError, ValueError, urllib.error.URLError, TimeoutError):
        return None


def _safe_unknown_response(result: AssistantResult) -> bool:
    content = result.content.lower()
    return (
        not result.grounded
        and not result.sources
        and result.handoff_offered
        and any(phrase in content for phrase in UNKNOWN_PHRASES)
    )
