import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import assistant
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
) -> dict:
    response = client.post(
        "/people",
        json={
            "name": name,
            "relationship": relationship,
            "description": "Primary caregiver" if approved else "Family acquaintance",
            "photo_url": None,
            "contact_approved": approved,
        },
    )
    assert response.status_code == 201
    return response.json()


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
        assert client.post("/chat", json={"message": message}).status_code == 200
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
