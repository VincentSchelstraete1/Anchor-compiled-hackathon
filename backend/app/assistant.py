import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.config import OPENAI_API_KEY, OPENAI_MODEL

FOLLOW_UP_WORDS = {"she", "he", "they", "them", "her", "him", "together"}
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
}
MEDICATION_CHANGE_WORDS = {
    "change",
    "double",
    "extra",
    "more",
    "less",
    "skip",
    "stop",
    "twice",
}
MEDICATION_CHANGE_PHRASES = {
    "can i take",
    "how much",
    "should i take",
    "take another",
    "take extra",
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
    "keys",
    "location",
    "medication",
    "medications",
    "memory",
    "memories",
    "preference",
    "preferences",
    "phone",
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
    """Route safety first, personal facts to stored records, and ordinary chat to OpenAI."""
    rule_result = _safety_rule_answer(message, people=people, memories=memories)
    if rule_result is not None:
        return rule_result

    live_result = _live_information_answer(message)
    if live_result is not None:
        return live_result

    personal_query = _is_personal_query(message, people=people, history=history)
    if not personal_query:
        result = _openai_general_answer(message, history) if OPENAI_API_KEY else None
        return result or _general_fallback(message)

    safe_result = _grounded_answer(
        message,
        people=people,
        memories=memories,
        events=events,
        handoffs=handoffs,
        history=history,
    )
    if safe_result.grounded:
        natural = _openai_grounded_answer(message, safe_result, history) if OPENAI_API_KEY else None
        return natural or safe_result
    return safe_result if safe_result.handoff_offered else _unknown_personal(message, people)


def _safety_rule_answer(
    message: str,
    *,
    people: list[dict[str, Any]],
    memories: list[dict[str, Any]],
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

    if words & MEDICATION_WORDS:
        medication_memories = [
            memory
            for memory in memories
            if _normalize(memory["category"])
            in {"medication", "medications", "medicine", "prescription"}
        ]
        if words & MEDICATION_CHANGE_WORDS or any(
            phrase in normalized for phrase in MEDICATION_CHANGE_PHRASES
        ):
            return AssistantResult(
                (
                    "I can't safely tell you to change, skip, or repeat medication. "
                    "Please check the label and contact your caregiver, pharmacist, or clinician."
                ),
                False,
                [],
                False,
            )
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
    history: list[dict[str, Any]],
) -> bool:
    normalized = _normalize(message)
    words = set(normalized.split())
    if _resolve_person(message, people, history) is not None:
        return True
    if words & {"my", "our"} and words & PERSONAL_FACT_WORDS:
        return True
    if "i" in words and words & {"age", "birthday", "born", "from", "live", "lived"}:
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
    personal_memory_intent = bool(
        words & (MEMORY_WORDS | PREFERENCE_WORDS | ROUTINE_WORDS | LOCATION_WORDS)
    )

    if words & FOLLOW_UP_WORDS and person is None:
        return _unknown_personal(message, people)

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
        return _unknown_personal(message, people)

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
        )

    if person and _asks_about_person(normalized, words, person):
        description = f" {person['description']}" if person["description"] else ""
        return AssistantResult(
            f"{person['name']} is your {person['relationship']}.{description}",
            True,
            [{"type": "person", "id": person["id"]}],
            False,
        )

    return _unknown_personal(message, people)


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
    if any(source["type"] == "handoff" for source in verified.sources):
        return None
    system = (
        "You are Anchor, a warm conversational companion for an older adult. Rewrite the supplied "
        "VERIFIED_ANSWER naturally and concisely. It is the complete set of personal facts you may "
        "use. Preserve its meaning exactly. Do not add, infer, or guess any person, relationship, "
        "memory, preference, location, medication, date, time, event status, or completed action. "
        "A scheduled event is only a plan; never imply it occurred or that someone arrived. "
        "Return JSON that matches the required schema."
    )
    messages = [{"role": "system", "content": system}]
    recent_users = [item for item in history if item["role"] == "user"][-4:]
    messages.extend({"role": "user", "content": item["content"]} for item in recent_users[:-1])
    messages.append(
        {
            "role": "user",
            "content": json.dumps(
                {
                    "question": message,
                    "verified_answer": verified.content,
                    "verified_sources": verified.sources,
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
        "You are Anchor, a warm conversational companion for an older adult. Respond naturally, "
        "respectfully, and concisely in one or two short sentences. This route is only for ordinary "
        "conversation. Do not invent or assert personal facts, relationships, memories, schedules, "
        "medications, locations, or actions. Do not claim you called, texted, messaged, scheduled, "
        "or contacted anyone. Do not provide personalized medical advice. Use conversation history "
        "only for conversational continuity, never as authoritative personal data. Never treat a "
        "previous assistant statement as caregiver-confirmed. If asked about live weather, news, "
        "scores, traffic, prices, or other current external information, clearly say you do not "
        "have live access and suggest checking a current source. Return JSON that matches the "
        "required schema."
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
    verified_normalized = _normalize(verified.content)
    response_numbers = set(re.findall(r"\d+", normalized))
    verified_numbers = set(re.findall(r"\d+", verified_normalized))
    if not response_numbers <= verified_numbers:
        return False
    if any(source["type"] == "event" for source in verified.sources) and any(
        phrase in normalized
        for phrase in ("already visited", "has arrived", "have arrived", "visit happened")
    ):
        return False
    verified_words = {word for word in verified_normalized.split() if len(word) > 3}
    response_words = {word for word in normalized.split() if len(word) > 3}
    return bool(verified_words & response_words)
