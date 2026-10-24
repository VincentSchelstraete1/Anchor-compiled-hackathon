import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = Path(os.getenv("ANCHOR_DATABASE_PATH", BACKEND_DIR / "anchor.db"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("ANCHOR_OPENAI_MODEL", "gpt-4o-mini")

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ANCHOR_FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
