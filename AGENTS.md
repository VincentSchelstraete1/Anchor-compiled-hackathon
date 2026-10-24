# Anchor Engineering Guide

This repository is a 5-hour hackathon build. Prefer the smallest implementation that makes the end-to-end demo reliable. Do not add services, state managers, queues, authentication systems, migration frameworks, or abstractions unless the integration engineer explicitly approves them.

## Conventions

- Work from the API contract in `docs/API.md`; update the contract and shared TypeScript types together before changing a payload.
- Python: 3.11+, type hints on public functions, Ruff formatting/linting, modules under `backend/app/`.
- TypeScript: strict mode, functional React components, Server Components by default and `"use client"` only where browser APIs or interaction require it.
- Use snake_case over the wire and in shared API types. Use ISO 8601 timestamps with an explicit UTC offset (`Z` preferred).
- Keep HTTP access in `frontend/src/lib/api/`; pages and components must not duplicate fetch logic.
- Build accessible controls: semantic elements, visible focus, keyboard access, useful labels, and reduced-motion support.
- Never log personal memories, conversation text, or caregiver responses in the browser console or server logs.
- Anchor must never invent a personal fact. If stored context does not support an answer, say so and offer a caregiver handoff.

## Ownership

### Agent 1 — Backend (Codex)

Owns `backend/**`. Implements SQLite schema, CRUD routes, grounding, conversation history, reminder queries, and handoff state transitions. It may read but must not edit frontend files or API docs without integration-engineer approval.

### Agent 2 — Companion (Claude Sonnet)

Owns `frontend/src/app/companion/**` and `frontend/src/components/companion/**`. Implements the ambient display, Browser Speech API interaction, reminder playback, and spoken caregiver-response delivery. It may consume shared UI and API types but must not change them directly.

### Agent 3 — Caregiver (Codex)

Owns `frontend/src/app/caregiver/**` and `frontend/src/components/caregiver/**`. Implements people, memories, events, and handoff inbox screens. It may consume shared UI and API types but must not change them directly.

### Integration engineer

Owns root files, `docs/**`, `frontend/package.json`, `frontend/src/app/layout.tsx`, `frontend/src/app/globals.css`, `frontend/src/components/ui/**`, and `frontend/src/lib/api/**`. Resolves contract/dependency changes, shared components, merges, and end-to-end verification.

Do not edit another agent's owned files. Request shared changes from the integration engineer. Small fixes made during final integration must be communicated to the owning agent.

## Testing requirements

- Backend changes: add or update pytest coverage for happy path, validation failure, not-found behavior, and any state transition. Run `uv run pytest` and `uv run ruff check .` from `backend/`.
- Frontend changes: run `npm run lint` and `npm run build` from `frontend/`. Exercise voice features in a Chromium browser; verify a useful typed-input fallback when speech APIs are unavailable.
- Contract changes: update `docs/API.md`, `frontend/src/lib/api/types.ts`, and relevant backend schemas in the same integration commit.
- Before merge, manually exercise the minimum demo in `docs/PLAN.md` with a fresh SQLite database.

## Integration rules

- Branches should use the `codex/` prefix unless the integration engineer assigns another name. Keep commits small and scoped.
- Rebase or merge the latest `main` before handoff; do not force-push shared branches.
- Do not commit `.env`, databases, uploads, build output, or API keys.
- The backend contract is rooted at `http://localhost:8000`; the frontend reads `NEXT_PUBLIC_API_URL`.
- SQLite is the single source of persistent personal data. Browser state is only for transient UI and current speech state.
- Handoff creation requires explicit consent in the current turn. The client must send `consent_confirmed: true`; the backend must reject false or missing consent.
- Only the backend changes handoff status. Legal transitions are `pending -> answered -> delivered` and `pending -> cancelled`.
- Merge order: shared foundation, backend, companion, caregiver, then integration fixes. Resolve conflicts by ownership rather than accepting either side wholesale.
