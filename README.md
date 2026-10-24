# Anchor

Anchor is a voice-first AI memory companion for people experiencing memory difficulties. This repository contains a Next.js companion/caregiver frontend and a FastAPI + SQLite backend.

## Prerequisites

- Node.js 20.9 or newer and npm
- Python 3.11 or newer
- [`uv`](https://docs.astral.sh/uv/) for Python dependency management

## Start the backend

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Verify at [http://localhost:8000/health](http://localhost:8000/health) or view OpenAPI at [http://localhost:8000/docs](http://localhost:8000/docs).

## Start the frontend

In a second terminal:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
cd backend
uv run ruff check .
uv run pytest

cd ../frontend
npm run lint
npm run build
```

## Repository map

```text
backend/                  FastAPI application and tests
frontend/                 Next.js App Router application
  src/components/ui/      Shared shadcn/ui primitives
  src/lib/api/types.ts    Shared wire-format TypeScript types
docs/API.md               Canonical HTTP contracts
docs/DESIGN.md            Interface and visual direction
docs/PLAN.md              Five-hour delivery milestones and demo scope
AGENTS.md                 Ownership and integration rules
```

The foundation intentionally contains no product CRUD, chat, voice, or dashboard implementation. See `AGENTS.md` before working in a team worktree.
