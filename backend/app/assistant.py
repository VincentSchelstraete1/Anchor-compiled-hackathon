import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from app.config import OPENAI_API_KEY, OPENAI_MODEL


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
    safe_result = _safe_local_answer(message, people, memories, events)
    # Personal claims are assembled directly from stored rows so an LLM cannot add facts.
    if safe_result.grounded or not safe_result.handoff_offered:
        return safe_result

    context = {
        "people": people,
        "memories": memories,
        "events": events,
        "handoffs": handoffs,
    }
    if OPENAI_API_KEY:
        result = _openai_answer(message, context, history)
        if result is not None and _safe_unknown_response(result, context):
            return result
    return safe_result


def _openai_answer(
    message: str, context: dict[str, list[dict[str, Any]]], history: list[dict[str, Any]]
) -> AssistantResult | None:
    system = (
        "You are Anchor, a calm memory companion. Use only facts in STORED_CONTEXT for "
        "personal claims. Scheduled events are plans: never imply they occurred. If the answer "
        "needs an unknown personal fact, say you do not know and offer to ask the caregiver. "
        "Return JSON only with keys content, grounded, sources, handoff_offered. sources is a list "
        "of {type,id}; grounded may be true only when every personal claim is directly supported."
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


def _valid_sources(sources: list[dict[str, Any]], context: dict[str, list[dict[str, Any]]]) -> bool:
    valid = {
        (kind[:-1] if kind != "memories" else "memory", item["id"])
        for kind, items in context.items()
        for item in items
    }
    return all(
        isinstance(source, dict) and (source.get("type"), source.get("id")) in valid
        for source in sources
    )


def _safe_unknown_response(
    result: AssistantResult, context: dict[str, list[dict[str, Any]]]
) -> bool:
    content = result.content.lower()
    acknowledges_unknown = (
        "don't know" in content or "do not know" in content or "don't have" in content
    )
    return (
        not result.grounded
        and not result.sources
        and result.handoff_offered
        and acknowledges_unknown
        and _valid_sources(result.sources, context)
    )


def _safe_local_answer(
    message: str,
    people: list[dict[str, Any]],
    memories: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> AssistantResult:
    words = set(re.findall(r"[a-z0-9]+", message.lower()))
    greetings = {"hi", "hello", "hey"}
    if words and words <= greetings:
        return AssistantResult("Hello. How can I help?", False, [], False)

    visit_words = {"visit", "visiting", "coming", "come", "see"}
    if words & visit_words:
        scheduled = [event for event in events if event["status"] == "scheduled"]
        if scheduled:
            event = scheduled[0]
            person = next((item for item in people if item["id"] == event["person_id"]), None)
            name = person["name"] if person else "Someone"
            sources = [{"type": "event", "id": event["id"]}]
            if person:
                sources.append({"type": "person", "id": person["id"]})
            return AssistantResult(
                f"{name} is scheduled to visit at {event['start_time']}.", True, sources, False
            )

    for person in people:
        if person["name"].lower() in message.lower():
            return AssistantResult(
                f"{person['name']} is your {person['relationship']}. {person['description']}",
                True,
                [{"type": "person", "id": person["id"]}],
                False,
            )
    for memory in memories:
        haystack = f"{memory['title']} {memory['category']}".lower()
        if any(word in haystack for word in words if len(word) > 3):
            return AssistantResult(
                memory["content"],
                True,
                [{"type": "memory", "id": memory["id"]}],
                False,
            )

    caregiver = people[0]["name"] if people else "your caregiver"
    return AssistantResult(
        f"I don't have that information. Would you like me to ask {caregiver}?",
        False,
        [],
        True,
    )
