import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = Path(os.getenv("ANCHOR_DATABASE_PATH", BACKEND_DIR / "anchor.db"))

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ANCHOR_FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
