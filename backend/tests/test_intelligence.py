import json
import urllib.error
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import assistant
from app.main import create_app


class FakeOpenAIResponse:
    def __init__(self, content: str) -> None:
        self.body = json.dumps(
            {"choices": [{"message": {"content": json.dumps({"content": content})}}]}
        ).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


@pytest.mark.parametrize(
    "question",
    [
        "When was the Eiffel Tower built?",
        "Why do we have seasons?",
        "How can I organize my kitchen?",
        "Suggest activities we can do indoors.",
        "Tell me a short story about a lighthouse.",
        "Explain photosynthesis simply.",
        "What is a relaxing painting hobby?",
        "What should I check before planting tomatoes?",
    ],
)
def test_ordinary_questions_route_to_openai_not_personal_fallback(
    question: str, tmp_path: Path, monkeypatch
) -> None:
    calls = 0

    def fake_urlopen(*args, **kwargs):
        nonlocal calls
        calls += 1
        return FakeOpenAIResponse("Here is a clear, helpful answer.")

    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(assistant.urllib.request, "urlopen", fake_urlopen)
    app = create_app(tmp_path / "ordinary.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/chat", json={"message": question}).json()

    assert calls == 1
    assert response["message"]["content"] == "Here is a clear, helpful answer."
    assert response["grounded"] is False
    assert response["handoff_offered"] is False


def test_live_information_is_not_invented_or_sent_to_model(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")

    def model_must_not_run(*args, **kwargs):
        raise AssertionError("Live information requires a real external data tool")

    monkeypatch.setattr(assistant.urllib.request, "urlopen", model_must_not_run)
    app = create_app(tmp_path / "live-info.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/chat", json={"message": "What is the weather right now?"}).json()

    assert "don't have live information" in response["message"]["content"]
    assert response["grounded"] is False
    assert response["handoff_offered"] is False


def test_unknown_item_location_offers_practical_search_steps(tmp_path: Path) -> None:
    app = create_app(tmp_path / "item-location.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/chat", json={"message": "Where are my keys?"}).json()

    assert "don't know where your keys are" in response["message"]["content"]
    assert "Try checking" in response["message"]["content"]
    assert response["grounded"] is False
    assert response["handoff_offered"] is True


def _person(client: TestClient, name: str, relationship: str, description: str = "") -> dict:
    response = client.post(
        "/people",
        json={
            "name": name,
            "relationship": relationship,
            "description": description,
            "photo_url": None,
        },
    )
    assert response.status_code == 201
    return response.json()


def _memory(client: TestClient, person_id: int, title: str, content: str, category: str) -> dict:
    response = client.post(
        "/memories",
        json={
            "person_id": person_id,
            "title": title,
            "content": content,
            "category": category,
        },
    )
    assert response.status_code == 201
    return response.json()


def _event(client: TestClient, person_id: int, start: datetime) -> dict:
    response = client.post(
        "/events",
        json={
            "title": "Sarah visits",
            "description": "Sarah is scheduled to visit.",
            "start_time": start.isoformat(),
            "person_id": person_id,
            "reminder_minutes": 30,
            "status": "scheduled",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_relationship_event_and_memory_follow_ups(tmp_path: Path) -> None:
    app = create_app(tmp_path / "follow-up.db", seed=False)
    with TestClient(app) as client:
        sarah = _person(client, "Sarah", "daughter", "Sarah is a family caregiver.")
        memory = _memory(
            client,
            sarah["id"],
            "Saturday painting",
            "Margaret and Sarah enjoy painting together on Saturdays.",
            "activity",
        )
        event = _event(client, sarah["id"], datetime.now(UTC) + timedelta(hours=2))

        relationship = client.post("/chat", json={"message": "Who is my daughter?"}).json()
        assert relationship["grounded"] is True
        assert relationship["sources"] == [{"type": "person", "id": sarah["id"]}]
        assert "Sarah is your daughter" in relationship["message"]["content"]

        timing = client.post("/chat", json={"message": "When is she coming?"}).json()
        assert timing["grounded"] is True
        assert {source["type"] for source in timing["sources"]} == {"person", "event"}
        assert {source["id"] for source in timing["sources"]} == {sarah["id"], event["id"]}
        assert "scheduled to visit" in timing["message"]["content"]

        activity = client.post("/chat", json={"message": "What do we like doing together?"}).json()
        assert activity["grounded"] is True
        assert {source["id"] for source in activity["sources"]} == {sarah["id"], memory["id"]}
        assert "painting together" in activity["message"]["content"]


def test_preferences_are_grounded_and_unstored_preferences_are_unknown(tmp_path: Path) -> None:
    app = create_app(tmp_path / "preferences.db", seed=False)
    with TestClient(app) as client:
        sarah = _person(client, "Sarah", "daughter", "")
        preference = _memory(
            client,
            sarah["id"],
            "Favorite drink",
            "Sarah prefers chamomile tea in the evening.",
            "preference",
        )
        known = client.post("/chat", json={"message": "What does Sarah like to drink?"}).json()
        assert known["grounded"] is True
        assert any(
            source == {"type": "memory", "id": preference["id"]} for source in known["sources"]
        )
        assert "chamomile tea" in known["message"]["content"]

        unknown = client.post("/chat", json={"message": "What is Sarah's favorite song?"}).json()
        assert unknown["grounded"] is False
        assert unknown["sources"] == []
        assert unknown["handoff_offered"] is True


def test_scheduled_event_never_claims_arrival_or_completion(tmp_path: Path) -> None:
    app = create_app(tmp_path / "arrival.db", seed=False)
    with TestClient(app) as client:
        sarah = _person(client, "Sarah", "daughter")
        _event(client, sarah["id"], datetime.now(UTC) + timedelta(hours=1))
        response = client.post("/chat", json={"message": "Has Sarah arrived?"}).json()
        content = response["message"]["content"].lower()
        assert "scheduled" in content
        assert "has arrived" not in content
        assert "arrived" not in content


def test_assistant_output_is_not_used_as_authoritative_follow_up_context(tmp_path: Path) -> None:
    app = create_app(tmp_path / "assistant-context.db", seed=False)
    with TestClient(app) as client:
        sarah = _person(client, "Sarah", "caregiver", "Primary caregiver")
        _event(client, sarah["id"], datetime.now(UTC) + timedelta(hours=1))

        first = client.post("/chat", json={"message": "Where are my keys?"}).json()
        assert "ask Sarah" in first["message"]["content"]
        follow_up = client.post("/chat", json={"message": "When is she coming?"}).json()
        assert follow_up["grounded"] is False
        assert follow_up["sources"] == []
        assert follow_up["handoff_offered"] is True


def test_active_handoff_deduplication_and_safe_answer_delivery(tmp_path: Path) -> None:
    app = create_app(tmp_path / "handoff.db", seed=False)
    with TestClient(app) as client:
        caregiver = _person(client, "Elena", "caregiver", "Primary caregiver")
        payload = {
            "caregiver_person_id": caregiver["id"],
            "question": "Where are my keys?",
            "consent_confirmed": True,
        }
        created = client.post("/handoffs", json=payload)
        assert created.status_code == 201
        handoff_id = created.json()["id"]

        duplicate = client.post("/handoffs", json={**payload, "question": " where are my keys?! "})
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["details"] == {"handoff_id": handoff_id}

        waiting = client.post("/chat", json={"message": "Where are my keys?"}).json()
        assert waiting["grounded"] is True
        assert "still waiting" in waiting["message"]["content"]
        assert waiting["sources"][0] == {"type": "handoff", "id": handoff_id}

        answer = client.post(
            f"/handoffs/{handoff_id}/answer",
            json={"response": "They are in the blue bowl."},
        )
        assert answer.status_code == 200
        delivered_answer = client.post("/chat", json={"message": "Where are my keys?"}).json()
        assert delivered_answer["grounded"] is True
        assert "blue bowl" in delivered_answer["message"]["content"]
        assert delivered_answer["sources"][0] == {"type": "handoff", "id": handoff_id}


def test_reminder_boundaries_are_inclusive_then_exclusive(tmp_path: Path) -> None:
    app = create_app(tmp_path / "reminders.db", seed=False)
    with TestClient(app) as client:
        sarah = _person(client, "Sarah", "daughter")
        start = datetime.now(UTC) + timedelta(days=1)
        event = _event(client, sarah["id"], start)

        begins = start - timedelta(minutes=30)
        before = begins - timedelta(microseconds=1)
        assert client.get("/reminders/due", params={"at": before.isoformat()}).json()["items"] == []
        assert client.get("/reminders/due", params={"at": begins.isoformat()}).json()["items"] == [
            event
        ]
        assert client.get("/reminders/due", params={"at": start.isoformat()}).json()["items"] == []


def test_llm_failure_uses_safe_unknown_fallback(tmp_path: Path, monkeypatch) -> None:
    app = create_app(tmp_path / "llm-failure.db", seed=False)
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")

    def fail_request(*args, **kwargs):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(assistant.urllib.request, "urlopen", fail_request)
    with TestClient(app) as client:
        _person(client, "Elena", "caregiver", "Primary caregiver")
        response = client.post("/chat", json={"message": "Where was I born?"})
        assert response.status_code == 200
        body = response.json()
        assert body["grounded"] is False
        assert body["sources"] == []
        assert body["handoff_offered"] is True
        assert "don't have that information" in body["message"]["content"]


def test_sqlite_data_persists_across_app_restarts(tmp_path: Path) -> None:
    database_path = tmp_path / "persistent.db"
    first_app = create_app(database_path, seed=False)
    with TestClient(first_app) as client:
        person = _person(client, "Sarah", "daughter")
        _memory(client, person["id"], "Walks", "Sarah and Margaret take walks.", "routine")

    second_app = create_app(database_path, seed=False)
    with TestClient(second_app) as client:
        people = client.get("/people").json()["items"]
        memories = client.get("/memories").json()["items"]
        assert people[0]["name"] == "Sarah"
        assert memories[0]["content"] == "Sarah and Margaret take walks."


def test_short_term_transcript_is_bounded_and_chronological(tmp_path: Path) -> None:
    app = create_app(tmp_path / "bounded-history.db", seed=False)
    with TestClient(app) as client:
        for index in range(26):
            response = client.post("/chat", json={"message": f"Unknown question {index}"})
            assert response.status_code == 200

        messages = client.get("/conversation/messages", params={"limit": 50}).json()["items"]
        assert len(messages) == 50
        assert [message["id"] for message in messages] == sorted(
            message["id"] for message in messages
        )
        assert "Unknown question 0" not in {message["content"] for message in messages}


def test_general_conversation_uses_openai_with_structured_bounded_context(
    tmp_path: Path, monkeypatch
) -> None:
    requests: list[dict] = []

    def fake_urlopen(request, timeout: int):
        payload = json.loads(request.data)
        requests.append(payload)
        if len(requests) == 1:
            return FakeOpenAIResponse("Kyoto is a fascinating place to read about.")
        return FakeOpenAIResponse("It is known for beautiful temples and peaceful gardens.")

    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(assistant.urllib.request, "urlopen", fake_urlopen)
    app = create_app(tmp_path / "general-chat.db", seed=False)
    with TestClient(app) as client:
        first = client.post("/chat", json={"message": "I was reading about Kyoto."}).json()
        second = client.post("/chat", json={"message": "What is it like there?"}).json()

    assert first["grounded"] is False
    assert first["sources"] == []
    assert first["handoff_offered"] is False
    assert "Kyoto" in first["message"]["content"]
    assert "peaceful gardens" in second["message"]["content"]
    assert requests[0]["response_format"]["type"] == "json_schema"
    assert requests[0]["response_format"]["json_schema"]["strict"] is True
    second_messages = requests[1]["messages"]
    assert any(item["content"] == "I was reading about Kyoto." for item in second_messages)
    assert any(item["role"] == "assistant" for item in second_messages)


def test_general_conversation_failure_uses_non_handoff_fallback(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")

    def fail_request(*args, **kwargs):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(assistant.urllib.request, "urlopen", fail_request)
    app = create_app(tmp_path / "general-fallback.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/chat", json={"message": "Tell me a gentle joke."}).json()

    assert response["grounded"] is False
    assert response["sources"] == []
    assert response["handoff_offered"] is False
    assert "I'm here with you" in response["message"]["content"]


def test_personal_facts_bypass_model_and_reflect_caregiver_updates(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", None)
    app = create_app(tmp_path / "portal-update.db", seed=False)
    with TestClient(app) as client:
        sarah = _person(client, "Sarah", "daughter", "Sarah lives nearby.")
        before = client.post("/chat", json={"message": "Who is Sarah?"}).json()
        assert "daughter" in before["message"]["content"]

        updated = client.patch(f"/people/{sarah['id']}", json={"relationship": "niece"})
        assert updated.status_code == 200
        after = client.post("/chat", json={"message": "Who is Sarah?"}).json()

    assert after["grounded"] is True
    assert after["sources"] == [{"type": "person", "id": sarah["id"]}]
    assert "niece" in after["message"]["content"]
    assert "daughter" not in after["message"]["content"]


def test_grounded_personal_answer_is_naturalized_from_verified_facts(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict = {}

    def fake_urlopen(request, timeout: int):
        payload = json.loads(request.data)
        verified_payload = json.loads(payload["messages"][-1]["content"])
        captured.update(verified_payload)
        return FakeOpenAIResponse(f"Good news — {verified_payload['verified_answer']}")

    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(assistant.urllib.request, "urlopen", fake_urlopen)
    app = create_app(tmp_path / "grounded-natural.db", seed=False)
    with TestClient(app) as client:
        sarah = _person(client, "Sarah", "daughter")
        event = _event(client, sarah["id"], datetime.now(UTC) + timedelta(hours=1))
        response = client.post("/chat", json={"message": "When is Sarah coming?"}).json()

    assert response["grounded"] is True
    assert {source["id"] for source in response["sources"]} == {sarah["id"], event["id"]}
    assert response["message"]["content"].startswith("Good news")
    assert "scheduled to visit" in captured["verified_answer"]


def test_unknown_personal_information_never_reaches_model(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")

    def model_must_not_run(*args, **kwargs):
        raise AssertionError("Unknown personal facts must use the deterministic fallback")

    monkeypatch.setattr(assistant.urllib.request, "urlopen", model_must_not_run)
    app = create_app(tmp_path / "unknown-personal.db", seed=False)
    with TestClient(app) as client:
        _person(client, "Elena", "caregiver", "Primary caregiver")
        response = client.post("/chat", json={"message": "What is my blood type?"}).json()

    assert response["grounded"] is False
    assert response["sources"] == []
    assert response["handoff_offered"] is True
    assert "don't have that information" in response["message"]["content"]


def test_medical_and_contact_safety_rules_override_model(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")

    def model_must_not_run(*args, **kwargs):
        raise AssertionError("Safety rules must run before OpenAI")

    monkeypatch.setattr(assistant.urllib.request, "urlopen", model_must_not_run)
    app = create_app(tmp_path / "safety.db", seed=False)
    with TestClient(app) as client:
        emergency = client.post("/chat", json={"message": "I have chest pain."}).json()
        medication = client.post("/chat", json={"message": "Should I take another pill?"}).json()
        symptom = client.post("/chat", json={"message": "I feel dizzy today."}).json()
        contact = client.post("/chat", json={"message": "Please call Sarah."}).json()
        claimed = client.post("/chat", json={"message": "Did you text Sarah?"}).json()

    assert "call 911" in emergency["message"]["content"]
    assert emergency["handoff_offered"] is False
    assert "can't safely tell you" in medication["message"]["content"]
    assert "can't assess symptoms" in symptom["message"]["content"]
    assert "can't place a call" in contact["message"]["content"]
    assert "haven't called, texted, or messaged anyone" in claimed["message"]["content"]


def test_caregiver_medication_note_is_authoritative(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")

    def model_must_not_run(*args, **kwargs):
        raise AssertionError("Medication records must remain deterministic")

    monkeypatch.setattr(assistant.urllib.request, "urlopen", model_must_not_run)
    app = create_app(tmp_path / "medication-note.db", seed=False)
    with TestClient(app) as client:
        note = client.post(
            "/memories",
            json={
                "person_id": None,
                "title": "Morning medication",
                "content": "The caregiver note lists one blue tablet with breakfast.",
                "category": "medication",
            },
        ).json()
        response = client.post(
            "/chat", json={"message": "What medications are in my caregiver notes?"}
        ).json()

    assert response["grounded"] is True
    assert response["sources"] == [{"type": "memory", "id": note["id"]}]
    assert "one blue tablet with breakfast" in response["message"]["content"]


def test_unconfirmed_model_action_claim_is_rejected(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        assistant.urllib.request,
        "urlopen",
        lambda *args, **kwargs: FakeOpenAIResponse("I called Elena for you."),
    )
    app = create_app(tmp_path / "unsafe-model-action.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/chat", json={"message": "Tell me something cheerful."}).json()

    assert response["message"]["content"] == "I'm here with you. What would you like to talk about?"
    assert response["grounded"] is False
    assert response["handoff_offered"] is False
