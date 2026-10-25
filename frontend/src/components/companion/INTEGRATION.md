# Companion: integration notes

## Requested contract changes (not implemented; the companion degrades safely without them)

1. **`ChatResponse.handoff_caregiver_person_id: number | null`**: the person Anchor offered to ask when
   `handoff_offered` is true. Without it the companion never guesses from generated text. After a spoken "yes" it asks
   "Who would you like me to ask?" and accepts only a name the *person* says, or a button press.
   Read defensively in `companion-api.ts` (`CompanionChatResponse`).
2. **Reminders by request / acknowledgement**: no endpoint lets the person create or acknowledge a reminder
   ("remind me when she comes"). Acknowledgement is local only.
3. **Quiet hours**: no settings API. The companion reads `localStorage["anchor.quiet_hours"]` (e.g. `22:00-07:00`);
   suggested `GET /settings`.
4. **`Person.is_caregiver`** would let the consent card offer only caregivers.
5. `companion-api.ts` should move to `frontend/src/lib/api/` once the integration engineer adds a client.
6. Events outside the 7-day `upcoming_events` window cannot be displayed as a scene (falls back to home).

## Tests

`node --experimental-strip-types --test src/components/companion/logic/__tests__/logic.test.mjs`
Pure logic only. Microphone, recognition and speech synthesis need manual browser testing.

## Proactive companion (this round)

Used today, no change needed: `GET /reminders/due`, `GET /conversation/context`, `POST /chat`, `/speech`, and
person `photo_url` values that are root-relative (`/uploads/...`; the client prefixes the API base URL).

Conventions the client relies on (please keep them stable, or replace them with explicit fields):
- The person using Anchor is the person record whose `relationship` is `"Self"` (the demo seed does this). The client
  uses it for the spoken name and never shows that person as a visitor/"familiar face"/caregiver candidate.
  *Preferred:* `GET /profile -> { person_id, display_name }` or `Person.is_primary_user: boolean`.
- Events with a non-Self `person_id` count as a **visit**, unless the person's relationship or the title says
  doctor/appointment/clinic (an **appointment**). Events about Self or with no person are **routines/reminders**.
  *Preferred:* `Event.kind: "visit" | "appointment" | "routine"`.
- Routines shown in the briefing are memories whose `category` contains "routine".

Requested endpoints (client already calls the first and degrades if it 404s):
1. `GET /checkins -> { items: [{ id: string|number, time: "HH:MM" (local), message?: string, days?: number[] /* 0=Sun */ }] }`
   Caregiver-configured daily check-ins. Until it exists, a device can set `localStorage["anchor.checkins"]` to the same
   array. A check-in is spoken once per day, up to 90 minutes late, and is not repeated after "Thank you".
2. `POST /reminders/{event_id}/acknowledge` (and `GET /reminders/due` omitting acknowledged events), so acknowledgement
   survives a different device/browser. Today it is stored in `localStorage["anchor.reminder_state"]` (36 h).
3. `/chat` answers contain raw ISO timestamps for visits ("scheduled to visit at 2026-10-25T01:55:35Z"). Spoken answers
   should use a local, friendly time, or `/chat` should return a `spoken_text` field. "What's happening today?" and
   "Who's visiting today?" are therefore answered by the client directly from `/conversation/context`.
4. `ConversationContext.upcoming_events` covers only 7 days and only scheduled events; a cancelled event simply
   disappears from an open card on the next 30 s refresh.

Dev demo controls: `?demo=1` or Ctrl+Shift+D (never rendered in production builds).
