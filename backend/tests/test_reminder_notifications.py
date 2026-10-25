from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    with TestClient(create_app(tmp_path / "reminders.db", seed=False)) as test_client:
        response = test_client.put(
            "/companion/settings",
            json={"timezone": "UTC", "quiet_hours_start": None, "quiet_hours_end": None},
        )
        assert response.status_code == 200
        yield test_client


def event(client: TestClient, start: datetime, *, title: str = "Clinic appointment") -> dict:
    response = client.post(
        "/events",
        json={
            "title": title,
            "description": "Caregiver-confirmed schedule.",
            "start_time": start.isoformat(),
            "person_id": None,
            "reminder_minutes": 30,
            "status": "scheduled",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_polling_is_due_on_time_stable_and_not_implicitly_delivered(client: TestClient) -> None:
    start = datetime(2027, 1, 2, 10, tzinfo=UTC)
    event(client, start)

    too_early = client.get(
        "/reminder-notifications/due", params={"at": (start - timedelta(minutes=31)).isoformat()}
    )
    assert too_early.json()["items"] == []

    first = client.get(
        "/reminder-notifications/due", params={"at": (start - timedelta(minutes=30)).isoformat()}
    ).json()["items"]
    second = client.get(
        "/reminder-notifications/due", params={"at": (start - timedelta(minutes=20)).isoformat()}
    ).json()["items"]
    assert len(first) == 1
    assert second[0]["id"] == first[0]["id"]
    assert second[0]["status"] == "pending"
    assert second[0]["delivered_at"] is None

    delivered = client.post(
        f"/reminder-notifications/{first[0]['id']}/delivered"
    ).json()
    assert delivered["status"] == "delivered"
    assert delivered["delivered_at"].endswith("Z")
    assert (
        client.get(f"/reminder-notifications/{first[0]['id']}").json()["status"]
        == "delivered"
    )
    assert (
        client.get(
            "/reminder-notifications/due",
            params={"at": (start - timedelta(minutes=10)).isoformat()},
        ).json()["items"]
        == []
    )


def test_acknowledgment_persists_across_restart(tmp_path: Path) -> None:
    path = tmp_path / "persistent-reminder.db"
    due_at = datetime(2027, 2, 3, 9, 30, tzinfo=UTC)
    with TestClient(create_app(path, seed=False)) as first_client:
        created_event = event(first_client, due_at + timedelta(minutes=30))
        notification = first_client.get(
            "/reminder-notifications/due", params={"at": due_at.isoformat()}
        ).json()["items"][0]
        acknowledged = first_client.post(
            f"/reminder-notifications/{notification['id']}/acknowledge"
        ).json()
        assert acknowledged["status"] == "acknowledged"
        assert acknowledged["acknowledged_at"].endswith("Z")

    with TestClient(create_app(path, seed=False)) as second_client:
        assert second_client.get(f"/events/{created_event['id']}").status_code == 200
        assert (
            second_client.get(
                "/reminder-notifications/due", params={"at": due_at.isoformat()}
            ).json()["items"]
            == []
        )


def test_quiet_hours_delay_but_do_not_consume_reminder(client: TestClient) -> None:
    client.put(
        "/companion/settings",
        json={"timezone": "UTC", "quiet_hours_start": "22:00", "quiet_hours_end": "07:00"},
    )
    start = datetime(2027, 3, 4, 7, 15, tzinfo=UTC)
    event(client, start)
    assert (
        client.get(
            "/reminder-notifications/due",
            params={"at": datetime(2027, 3, 4, 6, 50, tzinfo=UTC).isoformat()},
        ).json()["items"]
        == []
    )
    after_quiet = client.get(
        "/reminder-notifications/due",
        params={"at": datetime(2027, 3, 4, 7, 5, tzinfo=UTC).isoformat()},
    ).json()["items"]
    assert len(after_quiet) == 1
    assert after_quiet[0]["status"] == "pending"


def test_daily_check_ins_recur_and_deduplicate(client: TestClient) -> None:
    check_in = client.post(
        "/check-ins",
        json={
            "title": "Morning check-in",
            "prompt": "How are you feeling this morning?",
            "time_of_day": "09:00",
            "enabled": True,
        },
    ).json()
    day_one = datetime(2027, 4, 5, 9, tzinfo=UTC)
    first = client.get(
        "/reminder-notifications/due", params={"at": day_one.isoformat()}
    ).json()["items"]
    repeated = client.get(
        "/reminder-notifications/due", params={"at": day_one.isoformat()}
    ).json()["items"]
    assert first[0]["id"] == repeated[0]["id"]
    assert first[0]["check_in_id"] == check_in["id"]
    client.post(f"/reminder-notifications/{first[0]['id']}/delivered")

    second = client.get(
        "/reminder-notifications/due", params={"at": (day_one + timedelta(days=1)).isoformat()}
    ).json()["items"]
    assert len(second) == 1
    assert second[0]["id"] != first[0]["id"]


def test_event_schedule_changes_replace_pending_occurrence(client: TestClient) -> None:
    original_start = datetime(2027, 5, 6, 10, tzinfo=UTC)
    created = event(client, original_start)
    old_notification = client.get(
        "/reminder-notifications/due",
        params={"at": (original_start - timedelta(minutes=30)).isoformat()},
    ).json()["items"][0]

    new_start = original_start + timedelta(hours=1)
    client.patch(f"/events/{created['id']}", json={"start_time": new_start.isoformat()})
    assert (
        client.get(
            "/reminder-notifications/due",
            params={"at": (original_start - timedelta(minutes=20)).isoformat()},
        ).json()["items"]
        == []
    )
    current = client.get(
        "/reminder-notifications/due",
        params={"at": (new_start - timedelta(minutes=30)).isoformat()},
    ).json()["items"]
    assert len(current) == 1
    assert current[0]["id"] != old_notification["id"]


def test_daily_briefing_uses_people_events_routines_preferences_and_photos(
    client: TestClient,
) -> None:
    person = client.post(
        "/people",
        json={
            "name": "Elena",
            "relationship": "daughter",
            "description": "Primary caregiver",
            "photo_url": "/images/elena.jpg",
        },
    ).json()
    visit_time = datetime(2027, 6, 7, 15, tzinfo=UTC)
    visit = client.post(
        "/events",
        json={
            "title": "Elena visits",
            "description": "Elena is scheduled to visit.",
            "start_time": visit_time.isoformat(),
            "person_id": person["id"],
            "reminder_minutes": 30,
            "status": "scheduled",
        },
    ).json()
    appointment = event(client, datetime(2027, 6, 7, 11, tzinfo=UTC))
    routine = client.post(
        "/memories",
        json={
            "person_id": None,
            "title": "Morning walk",
            "content": "Take a short walk after breakfast.",
            "category": "routine",
        },
    ).json()
    preference = client.post(
        "/memories",
        json={
            "person_id": None,
            "title": "Tea",
            "content": "Prefers chamomile tea.",
            "category": "preference",
        },
    ).json()

    briefing = client.get(
        "/daily-briefing",
        params={"at": datetime(2027, 6, 7, 8, tzinfo=UTC).isoformat()},
    ).json()
    assert briefing["date"] == "2027-06-07"
    assert briefing["expected_visitors"] == [visit]
    assert briefing["upcoming_appointments"] == [appointment]
    assert briefing["scheduled_routines"] == [routine]
    assert briefing["preferences"] == [preference]
    assert len(briefing["relevant_reminders"]) == 2
    assert client.get(f"/people/{person['id']}").json()["photo_url"] == "/images/elena.jpg"


def test_demo_reminders_are_isolated_and_reset_explicitly(client: TestClient) -> None:
    created = client.post("/demo/reminders", json={"kind": "check_in"})
    assert created.status_code == 201
    assert created.json()["kind"] == "demo"
    assert client.get("/events").json()["items"] == []
    assert client.get("/check-ins").json()["items"] == []
    assert client.delete("/demo/reminders").status_code == 204
