import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import assistant, communications
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "")
    with TestClient(create_app(tmp_path / "communications.db", seed=False)) as test_client:
        yield test_client


def person(
    client: TestClient,
    *,
    name: str = "Elena",
    relationship: str = "daughter",
    approved: bool = True,
    description: str | None = None,
) -> dict:
    response = client.post(
        "/people",
        json={
            "name": name,
            "relationship": relationship,
            "description": description
            if description is not None
            else ("Primary caregiver" if approved else "Family acquaintance"),
            "photo_url": None,
            "contact_approved": approved,
        },
    )
    assert response.status_code == 201
    return response.json()


class FakePlanResponse:
    def __init__(self, plan: dict) -> None:
        self.body = json.dumps(
            {"choices": [{"message": {"content": json.dumps(plan)}}]}
        ).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def test_text_proposal_collects_content_confirms_and_only_simulates(
    client: TestClient,
) -> None:
    elena = person(client)
    proposed_response = client.post("/chat", json={"message": "Can you text Elena?"}).json()
    assert proposed_response["message"]["content"] == (
        "Of course. What would you like me to tell Elena?"
    )
    actions = client.get("/communication-actions").json()["items"]
    assert len(actions) == 1
    proposed = actions[0]
    assert proposed["action_type"] == "SMS_REQUESTED"
    assert proposed["recipient_person_id"] == elena["id"]
    assert proposed["status"] == "PROPOSED"
    assert proposed["confirmation_status"] == "PENDING"
    assert proposed["execution_status"] == "NOT_EXECUTED"
    assert proposed["proposed_content"] is None
    assert proposed["source_conversation_message_id"] is not None

    details = client.post(
        "/chat", json={"message": "Please ask her to visit tomorrow."}
    ).json()
    assert details["message"]["content"] == (
        "Would you like me to prepare that message for Elena?"
    )
    updated = client.get(f"/communication-actions/{proposed['id']}").json()
    assert updated["proposed_content"] == "Please ask her to visit tomorrow."

    confirmed = client.post("/chat", json={"message": "Yes."}).json()
    assert confirmed["message"]["content"] == (
        "I've prepared the message for Elena. It hasn't been sent."
    )
    simulated = client.get(f"/communication-actions/{proposed['id']}").json()
    assert simulated["status"] == "SIMULATED"
    assert simulated["confirmation_status"] == "CONFIRMED"
    assert simulated["execution_status"] == "SIMULATED"
    assert simulated["confirmed_at"].endswith("Z")
    assert simulated["simulated_at"].endswith("Z")


def test_call_cancellation_prevents_later_confirmation(client: TestClient) -> None:
    person(client)
    proposed = client.post(
        "/chat", json={"message": "Can you call Elena about tomorrow's appointment?"}
    ).json()
    assert proposed["message"]["content"] == (
        "Would you like me to prepare that call request for Elena?"
    )
    action = client.get("/communication-actions").json()["items"][0]
    assert action["action_type"] == "CALL_REQUESTED"
    assert action["proposed_content"] == "tomorrow's appointment"

    cancelled = client.post("/chat", json={"message": "No, cancel."}).json()
    assert "Nothing was sent or placed" in cancelled["message"]["content"]
    stored = client.get(f"/communication-actions/{action['id']}").json()
    assert stored["status"] == "CANCELLED"
    assert stored["confirmation_status"] == "CANCELLED"
    assert stored["execution_status"] == "NOT_EXECUTED"
    assert client.post(f"/communication-actions/{action['id']}/confirm").status_code == 409


def test_caregiver_assistance_requires_confirmation(client: TestClient) -> None:
    elena = person(client)
    proposed = client.post(
        "/chat", json={"message": "I need caregiver help getting dressed."}
    ).json()
    assert proposed["message"]["content"] == (
        "Would you like me to record a request for help from Elena?"
    )
    action = client.get(
        "/communication-actions", params={"action_type": "CAREGIVER_ASSISTANCE"}
    ).json()["items"][0]
    assert action["recipient_person_id"] == elena["id"]
    assert action["status"] == "PROPOSED"

    confirmation = client.post("/chat", json={"message": "Please do."}).json()
    assert "No message was sent" in confirmation["message"]["content"]
    stored = client.get(f"/communication-actions/{action['id']}").json()
    assert stored["status"] == "CONFIRMED"
    assert stored["execution_status"] == "NOT_EXECUTED"


def test_urgent_flag_never_delays_or_claims_emergency_contact(client: TestClient) -> None:
    caregiver = person(client)
    response = client.post("/chat", json={"message": "I have chest pain."}).json()
    content = response["message"]["content"].lower()
    assert "call 911" in content
    assert "no call or message was sent" in content

    action = client.get(
        "/communication-actions", params={"action_type": "URGENT_HELP_REQUESTED"}
    ).json()["items"][0]
    assert action["recipient_person_id"] == caregiver["id"]
    assert action["status"] == "PROPOSED"
    assert action["execution_status"] == "NOT_EXECUTED"


def test_ordinary_conversation_does_not_create_actions(client: TestClient) -> None:
    person(client)
    for message in ("I'm feeling lonely.", "I'm confused.", "Who is Elena?"):
        response = client.post("/chat", json={"message": message})
        assert response.status_code == 200
        assert response.json()["action"] is None
    assert client.get("/communication-actions").json()["items"] == []


def test_only_approved_contacts_can_receive_actions(client: TestClient) -> None:
    person(client, name="Sarah", approved=False)
    response = client.post("/chat", json={"message": "Please text Sarah."}).json()
    assert "caregiver-approved person" in response["message"]["content"]
    assert client.get("/communication-actions").json()["items"] == []


def test_family_relationship_resolves_to_approved_contact(client: TestClient) -> None:
    sarah = person(client, name="Sarah", relationship="sister")
    response = client.post(
        "/chat", json={"message": "Please call my sister about lunch tomorrow."}
    ).json()
    assert "call request for Sarah" in response["message"]["content"]
    action = client.get("/communication-actions").json()["items"][0]
    assert action["recipient_person_id"] == sarah["id"]
    assert action["proposed_content"] == "lunch tomorrow"


def test_duplicate_proposals_are_prevented(client: TestClient) -> None:
    elena = person(client)
    payload = {
        "action_type": "SMS_REQUESTED",
        "recipient_person_id": elena["id"],
        "reason": "Please prepare a visit request.",
        "proposed_content": "Could you visit tomorrow?",
        "source_conversation_message_id": None,
    }
    first = client.post("/communication-actions", json=payload)
    assert first.status_code == 201
    duplicate = client.post("/communication-actions", json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["details"] == {"action_id": first.json()["id"]}
    assert len(client.get("/communication-actions").json()["items"]) == 1


def test_explicit_api_transitions_and_demo_actions(client: TestClient) -> None:
    elena = person(client)
    proposal = client.post(
        "/communication-actions",
        json={
            "action_type": "CALL_REQUESTED",
            "recipient_person_id": elena["id"],
            "reason": "Request a check-in call.",
            "proposed_content": "Check in this afternoon.",
            "source_conversation_message_id": None,
        },
    ).json()
    confirmed = client.post(f"/communication-actions/{proposal['id']}/confirm").json()
    assert confirmed["status"] == "CONFIRMED"
    simulated = client.post(f"/communication-actions/{proposal['id']}/simulate").json()
    assert simulated["status"] == "SIMULATED"
    assert simulated["execution_status"] == "SIMULATED"

    demo = client.post(
        "/demo/communication-actions",
        json={
            "action_type": "SMS_REQUESTED",
            "recipient_person_id": elena["id"],
            "reason": "Hackathon text demonstration.",
            "proposed_content": "Demo visit request.",
            "simulated": True,
        },
    )
    assert demo.status_code == 201
    assert demo.json()["status"] == "SIMULATED"
    assert demo.json()["is_demo"] is True
    assert client.delete("/demo/communication-actions").status_code == 204
    remaining = client.get("/communication-actions").json()["items"]
    assert remaining == [simulated]


def test_action_api_validation_not_found_and_illegal_transitions(client: TestClient) -> None:
    elena = person(client)
    unapproved = person(client, name="Thomas", relationship="neighbor", approved=False)
    base = {
        "action_type": "SMS_REQUESTED",
        "reason": "Prepare a check-in message.",
        "proposed_content": "Please check in.",
        "source_conversation_message_id": None,
    }
    assert client.post(
        "/communication-actions", json={**base, "recipient_person_id": None}
    ).status_code == 422
    assert client.post(
        "/communication-actions",
        json={**base, "recipient_person_id": unapproved["id"]},
    ).status_code == 409
    assert client.get("/communication-actions/999").status_code == 404

    incomplete = client.post(
        "/communication-actions",
        json={
            "action_type": "SMS_REQUESTED",
            "recipient_person_id": elena["id"],
            "reason": "Message details are still needed.",
            "proposed_content": None,
            "source_conversation_message_id": None,
        },
    ).json()
    assert client.post(f"/communication-actions/{incomplete['id']}/confirm").status_code == 409
    assert client.post(f"/communication-actions/{incomplete['id']}/simulate").status_code == 409


def test_action_persists_across_restart(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(assistant, "OPENAI_API_KEY", "")
    path = tmp_path / "persistent-actions.db"
    with TestClient(create_app(path, seed=False)) as first_client:
        person(first_client)
        first_client.post("/chat", json={"message": "Can you text Elena?"})
        action_id = first_client.get("/communication-actions").json()["items"][0]["id"]

    with TestClient(create_app(path, seed=False)) as second_client:
        stored = second_client.get(f"/communication-actions/{action_id}").json()
        assert stored["status"] == "PROPOSED"
        assert stored["execution_status"] == "NOT_EXECUTED"


def test_existing_people_are_migrated_without_losing_caregiver_approval(
    tmp_path: Path,
) -> None:
    path = tmp_path / "legacy.db"
    database = sqlite3.connect(path)
    database.execute(
        """CREATE TABLE people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            relationship TEXT NOT NULL,
            description TEXT NOT NULL,
            photo_url TEXT
        )"""
    )
    database.execute(
        """INSERT INTO people(name, relationship, description, photo_url)
        VALUES ('Elena', 'daughter', 'Primary caregiver', NULL)"""
    )
    database.execute(
        """INSERT INTO people(name, relationship, description, photo_url)
        VALUES ('Thomas', 'neighbor', 'Lives next door', NULL)"""
    )
    database.commit()
    database.close()

    with TestClient(create_app(path, seed=False)) as client:
        people = client.get("/people").json()["items"]

    assert people[0]["name"] == "Elena"
    assert people[0]["contact_approved"] is True
    assert people[1]["name"] == "Thomas"
    assert people[1]["contact_approved"] is False


def test_implicit_refill_uses_model_plan_and_returns_proposal_with_response(
    client: TestClient, monkeypatch
) -> None:
    office = person(
        client,
        name="Dr. Chen's Office",
        relationship="prescribing office",
        description="Verified medical office for prescription refills.",
    )
    captured: dict = {}
    plan = {
        "should_propose": True,
        "need_type": "MEDICATION_REFILL",
        "reason": "Margaret may need a prescription refill.",
        "proposed_content": "Ask whether a refill can be arranged.",
        "response": (
            "Thanks for telling me. I can help prepare a refill request for Dr. Chen's Office. "
            "Would you like me to prepare it?"
        ),
    }

    def fake_urlopen(request, timeout: int):
        payload = json.loads(request.data)
        captured.update(json.loads(payload["messages"][-1]["content"]))
        return FakePlanResponse(plan)

    monkeypatch.setattr(communications, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(communications.urllib.request, "urlopen", fake_urlopen)
    response = client.post(
        "/chat", json={"message": "I think I'm running out of my medicine."}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["message"]["content"] == plan["response"]
    assert "Intent detected" not in body["message"]["content"]
    assert body["action"]["status"] == "PROPOSED"
    assert body["action"]["action_type"] == "CALL_REQUESTED"
    assert body["action"]["recipient_person_id"] == office["id"]
    assert body["action"]["proposed_content"] == plan["proposed_content"]
    assert body["action"]["execution_status"] == "NOT_EXECUTED"
    assert captured["candidate_need"] == "MEDICATION_REFILL"
    assert captured["verified_recipient"]["id"] == office["id"]

    confirmed = client.post("/chat", json={"message": "Yes."}).json()
    assert confirmed["action"]["status"] == "SIMULATED"
    assert "hasn't been placed" in confirmed["message"]["content"]


def test_repeated_implicit_refill_reuses_unresolved_proposal(
    client: TestClient, monkeypatch
) -> None:
    office = person(
        client,
        name="Lakeview Pharmacy",
        relationship="pharmacy",
        description="Approved pharmacy contact.",
    )
    calls = 0

    def fake_urlopen(*args, **kwargs):
        nonlocal calls
        calls += 1
        return FakePlanResponse(
            {
                "should_propose": True,
                "need_type": "MEDICATION_REFILL",
                "reason": "A refill may be needed.",
                "proposed_content": "Ask about a prescription refill.",
                "response": "I can prepare a refill inquiry for Lakeview Pharmacy. Shall I?",
            }
        )

    monkeypatch.setattr(communications, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(communications.urllib.request, "urlopen", fake_urlopen)
    action_ids = []
    for message in (
        "I'm almost out of my pills.",
        "I think I'm running out of my medicine.",
        "I need more of my prescription.",
    ):
        body = client.post("/chat", json={"message": message}).json()
        action_ids.append(body["action"]["id"])

    assert action_ids == [action_ids[0]] * 3
    assert calls == 1
    actions = client.get("/communication-actions").json()["items"]
    assert len(actions) == 1
    assert actions[0]["recipient_person_id"] == office["id"]


def test_unsafe_model_execution_claim_is_rejected(client: TestClient, monkeypatch) -> None:
    office = person(
        client,
        name="Lakeview Pharmacy",
        relationship="pharmacy",
        description="Approved pharmacy contact.",
    )
    monkeypatch.setattr(communications, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        communications.urllib.request,
        "urlopen",
        lambda *args, **kwargs: FakePlanResponse(
            {
                "should_propose": True,
                "need_type": "MEDICATION_REFILL",
                "reason": "A refill is needed.",
                "proposed_content": "Request a refill.",
                "response": "I sent the refill request to Lakeview Pharmacy.",
            }
        ),
    )
    body = client.post(
        "/chat", json={"message": "I think I'm running out of my medicine."}
    ).json()
    assert body["message"]["content"] == (
        "I can help prepare that request for Lakeview Pharmacy. Would you like me to?"
    )
    assert body["action"]["recipient_person_id"] == office["id"]
    assert body["action"]["status"] == "PROPOSED"
    assert body["action"]["execution_status"] == "NOT_EXECUTED"


def test_medication_location_uses_storage_note_before_proposing_help(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(communications, "OPENAI_API_KEY", "")
    memory = client.post(
        "/memories",
        json={
            "person_id": None,
            "title": "Medication storage",
            "content": "The medicine is kept in the labeled kitchen cabinet.",
            "category": "location",
        },
    ).json()
    body = client.post("/chat", json={"message": "I can't find my medicine."}).json()
    assert "labeled kitchen cabinet" in body["message"]["content"]
    assert body["grounded"] is True
    assert body["sources"] == [{"type": "memory", "id": memory["id"]}]
    assert body["action"] is None
    assert client.get("/communication-actions").json()["items"] == []


def test_missing_medication_without_storage_proposes_caregiver_help(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(communications, "OPENAI_API_KEY", "")
    caregiver = person(client, description="Approved primary caregiver")
    body = client.post("/chat", json={"message": "I can't find my pills."}).json()
    assert "don't have a verified storage location" in body["message"]["content"]
    assert body["action"]["action_type"] == "CAREGIVER_ASSISTANCE"
    assert body["action"]["recipient_person_id"] == caregiver["id"]
    assert body["action"]["status"] == "PROPOSED"


def test_appointment_and_family_needs_select_relevant_contacts(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(communications, "OPENAI_API_KEY", "")
    office = person(
        client,
        name="Dr. Chen's Office",
        relationship="medical office",
        description="Approved clinic scheduling contact.",
    )
    sophie = person(
        client,
        name="Sophie",
        relationship="sister",
        description="Approved family contact.",
    )
    appointment = client.post(
        "/chat", json={"message": "I can't make it to my doctor tomorrow."}
    ).json()
    assert appointment["action"]["recipient_person_id"] == office["id"]
    assert appointment["action"]["action_type"] == "CALL_REQUESTED"
    client.post(
        f"/communication-actions/{appointment['action']['id']}/cancel"
    )

    family = client.post(
        "/chat", json={"message": "I wish I could talk to Sophie."}
    ).json()
    assert family["action"]["recipient_person_id"] == sophie["id"]
    assert family["action"]["action_type"] == "CALL_REQUESTED"
    assert "Sophie" in family["message"]["content"]


def test_refill_does_not_default_to_nonmedical_caregiver(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(communications, "OPENAI_API_KEY", "")
    person(client, name="Elena", relationship="daughter", description="Primary caregiver")
    body = client.post(
        "/chat", json={"message": "I need more of my prescription."}
    ).json()
    assert body["action"] is None
    assert "verified prescribing office or medical contact" in body["message"]["content"]
    assert client.get("/communication-actions").json()["items"] == []


def test_ambiguous_medical_contacts_require_clarification(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(communications, "OPENAI_API_KEY", "")
    person(
        client,
        name="North Pharmacy",
        relationship="pharmacy",
        description="Approved pharmacy contact.",
    )
    person(
        client,
        name="South Pharmacy",
        relationship="pharmacy",
        description="Approved pharmacy contact.",
    )
    body = client.post(
        "/chat", json={"message": "I think I'm running out of my pills."}
    ).json()
    assert body["action"] is None
    assert "Which approved contact" in body["message"]["content"]
    assert client.get("/communication-actions").json()["items"] == []


def test_unapproved_named_office_is_not_replaced_with_another_contact(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(communications, "OPENAI_API_KEY", "")
    person(
        client,
        name="Lakeview Pharmacy",
        relationship="pharmacy",
        description="Approved pharmacy contact.",
    )
    person(
        client,
        name="Dr. Gray's Office",
        relationship="prescribing office",
        description="Not approved for communication.",
        approved=False,
    )
    body = client.post(
        "/chat",
        json={"message": "I'm running out of medicine from Dr. Gray's Office."},
    ).json()
    assert body["action"] is None
    assert "Which approved contact" in body["message"]["content"]
    assert client.get("/communication-actions").json()["items"] == []


@pytest.mark.parametrize(
    "message",
    ["I'm having trouble with something.", "I need some help."],
)
def test_ambiguous_help_asks_for_clarification_without_action(
    client: TestClient, message: str
) -> None:
    body = client.post("/chat", json={"message": message}).json()
    assert "what kind of help" in body["message"]["content"].lower()
    assert body["action"] is None
    assert client.get("/communication-actions").json()["items"] == []
