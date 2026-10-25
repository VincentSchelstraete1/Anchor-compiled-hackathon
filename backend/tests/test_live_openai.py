import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import assistant
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
