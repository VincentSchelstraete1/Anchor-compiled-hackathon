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
