from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    app = create_app(tmp_path / "test.db", seed=False, uploads_path=tmp_path / "uploads")
    with TestClient(app) as test_client:
        yield test_client


def create_person(client: TestClient, name: str = "Elena") -> dict:
    response = client.post(
        "/people",
        json={
            "name": f"  {name}  ",
            "relationship": "daughter",
            "description": "Primary caregiver",
            "photo_url": "/images/elena.jpg",
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.parametrize(
    ("content_type", "content", "extension"),
    [
        ("image/jpeg", b"\xff\xd8\xff\xe0photo", ".jpg"),
        ("image/png", b"\x89PNG\r\n\x1a\nphoto", ".png"),
        ("image/webp", b"RIFF\x04\x00\x00\x00WEBPphoto", ".webp"),
    ],
)
def test_photo_upload_validation_and_serving(
    client: TestClient, content_type: str, content: bytes, extension: str
) -> None:
    response = client.post(
        "/uploads/person-photo",
        files={"file": (f"portrait{extension}", content, content_type)},
    )

    assert response.status_code == 201
    photo_url = response.json()["photo_url"]
    assert photo_url.startswith("/uploads/person-photos/")
    assert photo_url.endswith(extension)
    served = client.get(photo_url)
    assert served.status_code == 200
    assert served.content == content
    assert served.headers["content-type"] == content_type


def test_photo_upload_rejects_invalid_type_content_and_size(client: TestClient) -> None:
    unsupported = client.post(
        "/uploads/person-photo",
        files={"file": ("portrait.gif", b"GIF89a", "image/gif")},
    )
    assert unsupported.status_code == 422
    assert unsupported.json()["error"]["code"] == "invalid_file_type"

    disguised = client.post(
        "/uploads/person-photo",
        files={"file": ("portrait.png", b"not a png", "image/png")},
    )
    assert disguised.status_code == 422
    assert disguised.json()["error"]["code"] == "invalid_file_type"

    oversized = client.post(
        "/uploads/person-photo",
        files={"file": ("portrait.jpg", b"\xff\xd8\xff" + b"x" * (5 * 1024 * 1024), "image/jpeg")},
    )
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "file_too_large"


def test_uploaded_photo_reference_persists_across_restart(tmp_path: Path) -> None:
    database_path = tmp_path / "test.db"
    uploads_path = tmp_path / "uploads"
    app = create_app(database_path, seed=False, uploads_path=uploads_path)
    with TestClient(app) as first_client:
        upload = first_client.post(
            "/uploads/person-photo",
            files={"file": ("portrait.png", b"\x89PNG\r\n\x1a\nphoto", "image/png")},
        )
        photo_url = upload.json()["photo_url"]
        person = first_client.post(
            "/people",
            json={
                "name": "Elena",
                "relationship": "daughter",
                "description": "Primary caregiver",
                "photo_url": photo_url,
            },
        ).json()

    restarted = create_app(database_path, seed=False, uploads_path=uploads_path)
    with TestClient(restarted) as second_client:
        assert second_client.get(f"/people/{person['id']}").json()["photo_url"] == photo_url
        assert second_client.get(photo_url).content == b"\x89PNG\r\n\x1a\nphoto"
        removed = second_client.patch(f"/people/{person['id']}", json={"photo_url": None})
        assert removed.status_code == 200
        assert removed.json()["photo_url"] is None


def test_people_crud_validation_not_found_and_reference_conflict(client: TestClient) -> None:
    person = create_person(client)
    assert person["name"] == "Elena"
    assert client.get("/people").json()["items"] == [person]

    updated = client.patch(f"/people/{person['id']}", json={"description": "Caregiver"})
    assert updated.status_code == 200
    assert updated.json()["description"] == "Caregiver"
    assert client.patch(f"/people/{person['id']}", json={}).status_code == 422
    assert client.get("/people/999").status_code == 404

    memory = client.post(
        "/memories",
        json={
            "person_id": person["id"],
            "title": "Garden",
            "content": "They garden on Sundays.",
            "category": "family",
        },
    )
    assert memory.status_code == 201
    conflict = client.delete(f"/people/{person['id']}")
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "conflict"

    assert client.delete(f"/memories/{memory.json()['id']}").status_code == 204
    assert client.delete(f"/people/{person['id']}").status_code == 204


def test_memories_crud_filters_and_foreign_key_validation(client: TestClient) -> None:
    person = create_person(client)
    invalid = client.post(
        "/memories",
        json={"person_id": 999, "title": "X", "content": "Y", "category": "family"},
    )
    assert invalid.status_code == 404

    response = client.post(
        "/memories",
        json={
            "person_id": person["id"],
            "title": "Sunday garden",
            "content": "Margaret and Elena tend the garden.",
            "category": "family",
        },
    )
    memory = response.json()
    assert memory["created_at"].endswith("Z")
    assert client.get(f"/memories?person_id={person['id']}&category=family").json()["items"] == [
        memory
    ]
    assert client.patch(f"/memories/{memory['id']}", json={"person_id": None}).status_code == 200
    assert client.get("/memories/999").status_code == 404


def test_events_crud_filters_and_due_reminders(client: TestClient) -> None:
    person = create_person(client)
    start = datetime.now(UTC) + timedelta(minutes=20)
    payload = {
        "title": "Elena visits",
        "description": "A scheduled visit",
        "start_time": start.isoformat(),
        "person_id": person["id"],
        "reminder_minutes": 30,
        "status": "scheduled",
    }
    response = client.post("/events", json=payload)
    assert response.status_code == 201
    event = response.json()
    assert event["start_time"].endswith("Z")

    due_at = (start - timedelta(minutes=10)).isoformat()
    assert client.get("/reminders/due", params={"at": due_at}).json()["items"] == [event]
    assert client.get("/events", params={"status": "scheduled"}).json()["items"] == [event]
    assert (
        client.post("/events", json={**payload, "start_time": "2026-01-01T12:00:00"}).status_code
        == 422
    )
    assert (
        client.patch(f"/events/{event['id']}", json={"status": "completed"}).json()["status"]
        == "completed"
    )
    assert client.get("/events/999").status_code == 404
    assert client.delete(f"/events/{event['id']}").status_code == 204


def test_handoff_consent_and_state_transitions(client: TestClient) -> None:
    caregiver = create_person(client)
    body = {"caregiver_person_id": caregiver["id"], "question": "When is lunch?"}
    assert client.post("/handoffs", json=body).status_code == 422
    assert client.post("/handoffs", json={**body, "consent_confirmed": False}).status_code == 422
    assert client.get("/handoffs").json()["items"] == []

    created = client.post("/handoffs", json={**body, "consent_confirmed": True})
    assert created.status_code == 201
    handoff = created.json()
    assert handoff["status"] == "pending"
    assert client.post(f"/handoffs/{handoff['id']}/deliver").status_code == 409

    answered = client.post(
        f"/handoffs/{handoff['id']}/answer", json={"response": "Lunch is at noon."}
    )
    assert answered.status_code == 200
    assert answered.json()["answered_at"].endswith("Z")
    assert (
        client.post(f"/handoffs/{handoff['id']}/answer", json={"response": "Again"}).status_code
        == 409
    )
    delivered = client.post(f"/handoffs/{handoff['id']}/deliver")
    assert delivered.json()["status"] == "delivered"
    assert delivered.json()["delivered_at"].endswith("Z")

    second = client.post("/handoffs", json={**body, "consent_confirmed": True}).json()
    assert client.post(f"/handoffs/{second['id']}/cancel").json()["status"] == "cancelled"
    assert len(client.get("/handoffs", params={"status": "delivered"}).json()["items"]) == 1


def test_grounded_chat_unknown_chat_and_conversation_context(client: TestClient) -> None:
    person = create_person(client)
    start = datetime.now(UTC) + timedelta(hours=1)
    event = client.post(
        "/events",
        json={
            "title": "Elena visits",
            "description": "Scheduled visit",
            "start_time": start.isoformat(),
            "person_id": person["id"],
            "reminder_minutes": 30,
            "status": "scheduled",
        },
    ).json()

    grounded = client.post("/chat", json={"message": "Who is visiting?"})
    assert grounded.status_code == 200
    assert grounded.json()["grounded"] is True
    assert {tuple(source.values()) for source in grounded.json()["sources"]} == {
        ("event", event["id"]),
        ("person", person["id"]),
    }
    assert "scheduled" in grounded.json()["message"]["content"]

    unknown = client.post("/chat", json={"message": "What was my first school's name?"})
    assert unknown.json()["grounded"] is False
    assert unknown.json()["handoff_offered"] is True
    assert "don't have that information" in unknown.json()["message"]["content"]
    assert client.get("/handoffs").json()["items"] == []

    messages = client.get("/conversation/messages").json()["items"]
    assert [message["role"] for message in messages] == ["user", "assistant", "user", "assistant"]
    context = client.get("/conversation/context").json()
    assert len(context["upcoming_events"]) == 1
    assert len(context["messages"]) == 4
    assert client.delete("/conversation/messages").status_code == 204
    assert client.get("/conversation/messages").json()["items"] == []
    assert len(client.get("/people").json()["items"]) == 1
