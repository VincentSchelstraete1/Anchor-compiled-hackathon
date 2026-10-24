# Anchor Implementation Plan

## Minimum viable demo

A caregiver adds a familiar person with a photo and memory, schedules an upcoming visit, and sees a handoff inbox. The companion screen shows the time, photo, and visit; the user can ask by voice who is visiting and hear a grounded answer. An unknown question produces an honest uncertainty response and an offer to ask the caregiver. After spoken consent, a pending handoff appears in the dashboard; the caregiver answers it; the companion announces the answer and marks it delivered.

## Milestones

1. **Foundation (0:00–0:30):** startable frontend/backend, health check, shared contracts, CORS, team ownership.
2. **Data and CRUD (0:30–1:45):** SQLite schema and seed data; people, memories, events, conversation, and handoff endpoints; API tests.
3. **Parallel interfaces (0:30–2:30):** companion ambient screen and speech loop; caregiver CRUD forms and inbox; typed fallback for voice testing.
4. **Grounded assistant (1:45–3:15):** retrieve relevant stored context, call one LLM, require source IDs, reject unsupported personal claims, retain a bounded recent transcript.
5. **Handoff and reminders (2:30–3:45):** consent flow, answer/delivery flow, upcoming reminder polling and one-time speech announcements.
6. **Integration (3:45–4:30):** connect clients to the API, seed a coherent family story, fix contract drift, rehearse the demo.
7. **Polish and buffer (4:30–5:00):** accessibility pass, empty/error states, full checks, fresh-database demo run.

## Scope guardrails

- One local profile, one caregiver role, no authentication.
- Local photo URLs or static assets; no upload service is required for the demo.
- Browser speech recognition/synthesis only; typed input remains available for unsupported browsers.
- Poll events and handoffs every 10–15 seconds; no WebSockets or background worker.
- Short-term transcript is bounded (recommended: latest 12 messages); persistent facts live only in structured tables.
- Demo success is reliability and humane behavior, not breadth.

## Demo seed story

Use a single internally consistent story: a person named Margaret, her daughter Elena, a shared Sunday-garden memory, and an Elena visit beginning soon. Avoid real patient data.
