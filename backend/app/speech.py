import json
import urllib.error
import urllib.request

from app.config import (
    OPENAI_API_KEY,
    OPENAI_TTS_INSTRUCTIONS,
    OPENAI_TTS_MODEL,
    OPENAI_TTS_SPEED,
    OPENAI_TTS_VOICE,
)


class SpeechUnavailableError(Exception):
    """Raised when configured speech generation cannot return playable audio."""


def generate_speech(text: str) -> bytes:
    """Generate MP3 speech without exposing the provider key to the browser."""
    if not OPENAI_API_KEY:
        raise SpeechUnavailableError("OpenAI speech is not configured")

    payload = json.dumps(
        {
            "model": OPENAI_TTS_MODEL,
            "voice": OPENAI_TTS_VOICE,
            "input": text,
            "instructions": OPENAI_TTS_INSTRUCTIONS,
            "speed": OPENAI_TTS_SPEED,
            "response_format": "mp3",
        }
    ).encode()
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/speech",
        data=payload,
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            audio = response.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SpeechUnavailableError("OpenAI speech request failed") from exc
    if not audio:
        raise SpeechUnavailableError("OpenAI returned empty speech audio")
    return audio
