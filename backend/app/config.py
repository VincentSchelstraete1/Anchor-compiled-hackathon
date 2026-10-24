import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = Path(os.getenv("ANCHOR_DATABASE_PATH", BACKEND_DIR / "anchor.db"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("ANCHOR_OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TTS_MODEL = os.getenv("ANCHOR_OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
OPENAI_TTS_VOICE = os.getenv("ANCHOR_OPENAI_TTS_VOICE", "nova")
OPENAI_TTS_SPEED = float(os.getenv("ANCHOR_OPENAI_TTS_SPEED", "0.97"))
OPENAI_TTS_INSTRUCTIONS = os.getenv(
    "ANCHOR_OPENAI_TTS_INSTRUCTIONS",
    (
        "Speak warmly, naturally, and reassuringly for an elderly listener. "
        "Use a calm, friendly tone, clear articulation, gentle pacing, and brief natural pauses. "
        "Never sound rushed, patronizing, overly dramatic, or alarmed."
    ),
)

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ANCHOR_FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
