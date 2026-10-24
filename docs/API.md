# Anchor API Contract

Base URL: `http://localhost:8000`. JSON uses `snake_case`. Timestamps are ISO 8601 strings with an explicit offset; the server emits UTC with `Z`. IDs are positive SQLite integers. Empty optional relations are `null`, never omitted.

## Common behavior

- Request and response content type: `application/json` (except `204` responses).
- Success: `200` read/update/action, `201` create, `204` delete.
- Errors use `{ "error": { "code": "not_found", "message": "...", "details": {} } }`.
- Error statuses: `400` invalid transition/domain rule, `404` missing record, `409` conflict, `422` malformed or validation-failing input, `500` unexpected server failure.
- List endpoints return `{ "items": [...] }`. The MVP does not paginate.
- Strings are trimmed. Required strings must contain 1–2,000 characters unless a narrower limit is stated.
- Foreign-key references must exist. A referenced person cannot be deleted while memories, events, or handoffs refer to it; return `409`.

## Health

### `GET /health`

Response `200`:

```json
{ "status": "ok" }
```

## People

```ts
interface Person {
  id: number;
  name: string;
  relationship: string;
  description: string;
  photo_url: string | null;
}
```

`name` and `relationship` are required, maximum 120 characters. `description` is required but may be `""`. `photo_url` is an absolute URL or a root-relative frontend asset path.

- `GET /people` → `200 { "items": Person[] }`, ordered by `name`, then `id`.
- `POST /people` with `PersonCreate` → `201 Person`.
- `GET /people/{person_id}` → `200 Person`.
- `PATCH /people/{person_id}` with at least one `PersonUpdate` field → `200 Person`.
- `DELETE /people/{person_id}` → `204`.

```ts
type PersonCreate = Omit<Person, "id">;
type PersonUpdate = Partial<PersonCreate>;
```

## Personal memories

```ts
interface Memory {
  id: number;
  person_id: number | null;
  title: string;
  content: string;
  category: string;
  created_at: string;
}
```

`title` and `category` have a 120-character maximum; `content` has a 4,000-character maximum. `created_at` is server-generated and immutable.

- `GET /memories?person_id={id}&category={value}` → `200 { "items": Memory[] }`, newest first. Filters are optional and combined.
- `POST /memories` with `MemoryCreate` → `201 Memory`.
- `GET /memories/{memory_id}` → `200 Memory`.
- `PATCH /memories/{memory_id}` with at least one `MemoryUpdate` field → `200 Memory`.
- `DELETE /memories/{memory_id}` → `204`.

```ts
type MemoryCreate = Omit<Memory, "id" | "created_at">;
type MemoryUpdate = Partial<MemoryCreate>;
```

## Events and reminders

```ts
type EventStatus = "scheduled" | "completed" | "cancelled";

interface Event {
  id: number;
  title: string;
  description: string;
  start_time: string;
  person_id: number | null;
  reminder_minutes: number;
  status: EventStatus;
}
```

`title` has a 120-character maximum. `description` may be empty. `reminder_minutes` is an integer from 0 through 10,080. New events normally use `scheduled`.

- `GET /events?from={iso}&to={iso}&status={status}` → `200 { "items": Event[] }`, earliest `start_time` first. Filters are optional and combined.
- `POST /events` with `EventCreate` → `201 Event`.
- `GET /events/{event_id}` → `200 Event`.
- `PATCH /events/{event_id}` with at least one `EventUpdate` field → `200 Event`.
- `DELETE /events/{event_id}` → `204`.
- `GET /reminders/due?at={iso}` → `200 { "items": Event[] }`. `at` defaults to server time. Returns scheduled events where `start_time - reminder_minutes <= at < start_time`; the companion suppresses duplicate speech during one browser session.

```ts
type EventCreate = Omit<Event, "id">;
type EventUpdate = Partial<EventCreate>;
```

## Conversation context and chat

```ts
type ConversationRole = "user" | "assistant";

interface ConversationMessage {
  id: number;
  role: ConversationRole;
  content: string;
  created_at: string;
}

interface ConversationContext {
  messages: ConversationMessage[];
  people: Person[];
  memories: Memory[];
  upcoming_events: Event[];
  pending_handoffs: Handoff[];
}
```

- `GET /conversation/context` → `200 ConversationContext`. `messages` is the latest 12 in chronological order; `upcoming_events` contains scheduled events in the next seven days; `pending_handoffs` includes `pending` and `answered` items.
- `GET /conversation/messages?limit={1..50}` → `200 { "items": ConversationMessage[] }`, chronological; default `12`.
- `DELETE /conversation/messages` → `204`; clears short-term transcript only and never deletes personal data.
- `POST /chat` with `{ "message": string }` → `200 ChatResponse`. The server persists both user and assistant messages.

```ts
interface ChatResponse {
  message: ConversationMessage;
  grounded: boolean;
  sources: Array<{
    type: "person" | "memory" | "event" | "handoff";
    id: number;
  }>;
  handoff_offered: boolean;
}
```

`grounded` is true only when every personal claim in the answer is supported by the listed stored records. For greetings and non-personal conversational text it may be false with no sources. When the answer would require an unknown personal fact, the response must state that it does not know, set `handoff_offered: true`, and include no invented claim. Calling `/chat` never creates a handoff; consent is a separate explicit request.

Example unknown answer:

```json
{
  "message": {
    "id": 42,
    "role": "assistant",
    "content": "I don't have that information. Would you like me to ask Elena?",
    "created_at": "2026-10-24T21:00:00Z"
  },
  "grounded": false,
  "sources": [],
  "handoff_offered": true
}
```

## Caregiver handoffs

```ts
type HandoffStatus = "pending" | "answered" | "delivered" | "cancelled";

interface Handoff {
  id: number;
  caregiver_person_id: number;
  question: string;
  status: HandoffStatus;
  response: string | null;
  created_at: string;
  answered_at: string | null;
  delivered_at: string | null;
}
```

The referenced caregiver is a `Person`. `question` and `response` have a 2,000-character maximum.

- `GET /handoffs?status={status}` → `200 { "items": Handoff[] }`, newest first. Status filter is optional.
- `POST /handoffs` with `{ "caregiver_person_id": number, "question": string, "consent_confirmed": true }` → `201 Handoff` in `pending` state. Literal `true` is required; false or missing consent returns `422` and creates nothing.
- `GET /handoffs/{handoff_id}` → `200 Handoff`.
- `POST /handoffs/{handoff_id}/answer` with `{ "response": string }` → `200 Handoff`; valid only from `pending`, sets status `answered` and `answered_at`.
- `POST /handoffs/{handoff_id}/deliver` with no body → `200 Handoff`; valid only from `answered`, sets status `delivered` and `delivered_at`. Call only after speech synthesis reports completion.
- `POST /handoffs/{handoff_id}/cancel` with no body → `200 Handoff`; valid only from `pending`, sets status `cancelled`.

Repeated or out-of-order state transitions return `409` and the existing handoff remains unchanged. `response`, `answered_at`, and `delivered_at` are server-controlled and cannot be changed by generic update endpoints; no generic handoff `PATCH` or `DELETE` exists.

## Local CORS

By default the API accepts credentialed requests from `http://localhost:3000` and `http://127.0.0.1:3000`. Override the comma-separated allowlist with `ANCHOR_FRONTEND_ORIGINS`. The frontend API base URL is `NEXT_PUBLIC_API_URL` and defaults in development to `http://localhost:8000`.
