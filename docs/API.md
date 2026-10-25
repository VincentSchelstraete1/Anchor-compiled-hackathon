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

## Fictional demo data

- `POST /demo/seed` → `200 { "seeded": boolean, "people": number, "memories": number, "events": number, "medications": number }`.
- Adds the clearly labeled fictional Margaret demonstration dataset using the normal people, memory, and event tables.
- The operation is idempotent. Repeated calls return `seeded: false` and do not create duplicates.
- Fresh empty databases receive the same seed during initialization. Databases containing user-created people are never seeded automatically.

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

### Person photo upload

- `POST /uploads/person-photo` accepts `multipart/form-data` with one `file` field → `201 { "photo_url": string }`.
- Supported content types are `image/jpeg`, `image/png`, and `image/webp`; the server verifies the file signature.
- Photos must be 5 MB or smaller. Unsupported or invalid images return `422`; oversized images return `413`.
- The returned root-relative `/uploads/person-photos/...` reference is persistent and may be saved in a person's `photo_url` using the existing create or update endpoints.
- Uploaded files are served by the API at the returned path. Existing absolute URLs and frontend asset paths remain supported.

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

## Medications

```ts
interface Medication {
  id: number;
  person_id: number;
  name: string;
  purpose: string;
  dosage: string;
  frequency: string;
  location: string;
  refill_date: string | null;
  notes: string;
  active: boolean;
  created_at: string;
}
```

`name` and `dosage` have a 120-character maximum; `frequency` has a 240-character maximum. `purpose` and `location` have a 500-character maximum. `notes` has a 2,000-character maximum. `refill_date` is an ISO 8601 calendar date (`YYYY-MM-DD`) or `null`. Medication details are caregiver-entered records and must not be treated as medical advice.

- `GET /medications?person_id={id}&active={true|false}` → `200 { "items": Medication[] }`, active first and earliest refill first.
- `POST /medications` with `MedicationCreate` → `201 Medication`.
- `GET /medications/{medication_id}` → `200 Medication`.
- `PATCH /medications/{medication_id}` with at least one `MedicationUpdate` field → `200 Medication`.
- `DELETE /medications/{medication_id}` → `204`.

```ts
type MedicationCreate = Omit<Medication, "id" | "created_at">;
type MedicationUpdate = Partial<MedicationCreate>;
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
  reminder_enabled: boolean;
  status: EventStatus;
}
```

`title` has a 120-character maximum. `description` may be empty. `reminder_minutes` is an integer from 0 through 10,080. `reminder_enabled` defaults to `true` for compatibility with existing clients and records. New events normally use `scheduled`.

- `GET /events?from={iso}&to={iso}&status={status}` → `200 { "items": Event[] }`, earliest `start_time` first. Filters are optional and combined.
- `POST /events` with `EventCreate` → `201 Event`.
- `GET /events/{event_id}` → `200 Event`.
- `PATCH /events/{event_id}` with at least one `EventUpdate` field → `200 Event`.
- `DELETE /events/{event_id}` → `204`.
- `GET /reminders/due?at={iso}` → `200 { "items": Event[] }`. `at` defaults to server time. Returns reminder-enabled scheduled events where `start_time - reminder_minutes <= at < start_time`. Returns no events when spoken reminders are disabled globally; the companion suppresses duplicate speech during one browser session.

```ts
type EventCreate = Omit<Event, "id">;
type EventUpdate = Partial<EventCreate>;
```

## Proactive check-in settings

```ts
interface CheckInSettings {
  proactive_enabled: boolean;
  morning_time: string;
  afternoon_time: string;
  evening_time: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  reminder_lead_minutes: number;
  spoken_reminders_enabled: boolean;
  updated_at: string;
}

type CheckInSettingsUpdate = Omit<CheckInSettings, "updated_at">;
```

Clock values use 24-hour `HH:MM` text. `reminder_lead_minutes` is an integer from 0 through 10,080. The stored schedule is interpreted in the companion display device's local timezone.

- `GET /settings/check-ins` → `200 CheckInSettings`.
- `PUT /settings/check-ins` with every `CheckInSettingsUpdate` field → `200 CheckInSettings`.

These endpoints persist caregiver intent. A proactive scheduling consumer is still required to initiate morning, afternoon, and evening check-ins and enforce quiet hours; this contract does not change the conversational or companion implementation.

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
  medications: Medication[];
  upcoming_events: Event[];
  pending_handoffs: Handoff[];
}
```

- `GET /conversation/context` → `200 ConversationContext`. `messages` is the latest 12 in chronological order; `medications` contains caregiver-entered active and inactive medicine records; `upcoming_events` contains scheduled events in the next seven days; `pending_handoffs` includes `pending` and `answered` items.
- `GET /conversation/messages?limit={1..50}` → `200 { "items": ConversationMessage[] }`, chronological; default `12`.
- `DELETE /conversation/messages` → `204`; clears short-term transcript only and never deletes personal data.
- `POST /chat` with `{ "message": string }` → `200 ChatResponse`. The server persists both user and assistant messages.

```ts
interface ChatResponse {
  message: ConversationMessage;
  grounded: boolean;
  sources: Array<{
    type: "person" | "memory" | "event" | "handoff" | "medication";
    id: number;
  }>;
  handoff_offered: boolean;
}
```

`grounded` is true only when every personal claim in the answer is supported by the listed stored records. For greetings and non-personal conversational text it may be false with no sources. When the answer would require an unknown personal fact, the response must state that it does not know, set `handoff_offered: true`, and include no invented claim. Calling `/chat` never creates a handoff; consent is a separate explicit request.

Medication answers may repeat caregiver-entered name, purpose, dose, frequency, location, and refill information with `medication` sources. Questions about changing, skipping, doubling, making up, or combining doses must not produce individualized clinical advice: the response directs the person to the prescription label and a caregiver, pharmacist, or clinician, and offers a caregiver handoff.

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
