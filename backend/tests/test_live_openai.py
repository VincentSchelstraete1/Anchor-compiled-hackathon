import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import assistant, communications
from app.main import create_app


@pytest.mark.skipif(
    os.getenv("ANCHOR_RUN_LIVE_OPENAI_TEST") != "1" or not assistant.OPENAI_API_KEY,
    reason="set ANCHOR_RUN_LIVE_OPENAI_TEST=1 with OPENAI_API_KEY for the live API check",
)
def test_live_openai_naturalizes_verified_person_context(
    tmp_path: Path, monkeypatch
) -> None:
    generated: list[str | None] = []
    request_openai = assistant._request_openai_content

    def record_generation(*args, **kwargs) -> str | None:
        content = request_openai(*args, **kwargs)
        generated.append(content)
        return content

    monkeypatch.setattr(assistant, "_request_openai_content", record_generation)
    app = create_app(tmp_path / "live-openai.db", seed=False)
    with TestClient(app) as client:
        person = client.post(
            "/people",
            json={
                "name": "Elena",
                "relationship": "daughter",
                "description": "Elena lives nearby.",
                "photo_url": "/images/elena.jpg",
            },
        ).json()
        memory = client.post(
            "/memories",
            json={
                "person_id": person["id"],
                "title": "Sunday garden",
                "content": "Margaret and Elena enjoy gardening together on Sundays.",
                "category": "activity",
            },
        ).json()
        response = client.post(
            "/chat", json={"message": "I don't remember who Elena is."}
        )

    assert response.status_code == 200
    body = response.json()
    content = body["message"]["content"]
    assert generated and generated[0] is not None
    assert content == generated[0]
    assert "Elena" in content
    assert "daughter" in content.lower()
    assert "stored memory" not in content.lower()
    assert content != "Margaret and Elena enjoy gardening together on Sundays."
    assert len(content) <= 500
    assert body["grounded"] is True
    assert {source["type"] for source in body["sources"]} == {"person", "memory"}
    assert {source["id"] for source in body["sources"]} == {person["id"], memory["id"]}


@pytest.mark.skipif(
    os.getenv("ANCHOR_RUN_LIVE_OPENAI_TEST") != "1" or not communications.OPENAI_API_KEY,
    reason="set ANCHOR_RUN_LIVE_OPENAI_TEST=1 with OPENAI_API_KEY for the live API check",
)
def test_live_openai_plans_implicit_refill_without_executing(
    tmp_path: Path, monkeypatch
) -> None:
    generated: list[dict | None] = []
    request_plan = communications._request_assistance_plan

    def record_plan(*args, **kwargs) -> dict | None:
        plan = request_plan(*args, **kwargs)
        generated.append(plan)
        return plan

    monkeypatch.setattr(communications, "_request_assistance_plan", record_plan)
    app = create_app(tmp_path / "live-assistance.db", seed=False)
    with TestClient(app) as client:
        pharmacy = client.post(
            "/people",
            json={
                "name": "Lakeview Pharmacy",
                "relationship": "pharmacy",
                "description": "Verified pharmacy for prescription refills.",
                "photo_url": None,
                "contact_approved": True,
            },
        ).json()
        response = client.post(
            "/chat", json={"message": "I think I'm running out of my medicine."}
        )

    assert response.status_code == 200
    body = response.json()
    assert generated and generated[0] is not None
    assert generated[0]["should_propose"] is True
    assert generated[0]["need_type"] == "MEDICATION_REFILL"
    assert body["message"]["content"] == generated[0]["response"]
    assert body["action"]["status"] == "PROPOSED"
    assert body["action"]["recipient_person_id"] == pharmacy["id"]
    assert body["action"]["execution_status"] == "NOT_EXECUTED"
