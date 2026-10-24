import json
import urllib.error
from pathlib import Path
from typing import Self

from fastapi.testclient import TestClient

from app import speech
from app.main import create_app


class FakeSpeechResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.content


def test_speech_returns_openai_mp3_with_safe_server_configuration(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict[str, object] = {}

    def fake_urlopen(request, timeout: int):
        captured["url"] = request.full_url
        captured["authorization"] = request.get_header("Authorization")
        captured["payload"] = json.loads(request.data)
        captured["timeout"] = timeout
        return FakeSpeechResponse(b"ID3\x04\x00\x00fake-mp3")

    monkeypatch.setattr(speech, "OPENAI_API_KEY", "server-only-test-key")
    monkeypatch.setattr(speech.urllib.request, "urlopen", fake_urlopen)
    app = create_app(tmp_path / "speech.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/speech", json={"text": "You are safe. Elena is visiting soon."})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-anchor-voice-disclosure"] == "AI-generated voice"
    assert response.content.startswith(b"ID3")
    assert captured["url"] == "https://api.openai.com/v1/audio/speech"
    assert captured["authorization"] == "Bearer server-only-test-key"
    assert captured["timeout"] == 30
    assert captured["payload"] == {
        "model": "gpt-4o-mini-tts",
        "voice": "nova",
        "input": "You are safe. Elena is visiting soon.",
        "instructions": speech.OPENAI_TTS_INSTRUCTIONS,
        "speed": 0.97,
        "response_format": "mp3",
    }


def test_speech_unavailable_without_key_preserves_fallback_signal(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(speech, "OPENAI_API_KEY", None)
    app = create_app(tmp_path / "speech-no-key.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/speech", json={"text": "Hello"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "speech_unavailable"


def test_speech_provider_failure_returns_fallback_signal(tmp_path: Path, monkeypatch) -> None:
    def fail_urlopen(*args, **kwargs):
        raise urllib.error.URLError("offline")

    monkeypatch.setattr(speech, "OPENAI_API_KEY", "server-only-test-key")
    monkeypatch.setattr(speech.urllib.request, "urlopen", fail_urlopen)
    app = create_app(tmp_path / "speech-failure.db", seed=False)
    with TestClient(app) as client:
        response = client.post("/speech", json={"text": "Hello"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "speech_unavailable"


def test_speech_validates_text(tmp_path: Path) -> None:
    app = create_app(tmp_path / "speech-validation.db", seed=False)
    with TestClient(app) as client:
        assert client.post("/speech", json={"text": "   "}).status_code == 422
        assert client.post("/speech", json={"text": "x" * 4097}).status_code == 422
