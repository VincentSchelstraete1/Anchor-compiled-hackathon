# Anchor Design Direction

Anchor should feel calm, familiar, and dignified—not clinical or chat-like. The primary experience works by voice alone; visuals quietly reinforce the spoken interaction.

## Companion interface

- Full-screen route: `/companion`.
- Always-visible large local time and full date, sized for distance viewing.
- A dominant familiar photograph with name and relationship. Prefer one meaningful image over a carousel of small controls.
- A compact “Coming up” area for the next visit/reminder.
- A single conversation-state cue: `Listening`, `Thinking`, `Speaking`, or `Ready`. Do not expose model internals or a dense transcript.
- Speech starts from one obvious microphone control because browsers require a user gesture. After that, keep the loop hands-free where browser policy permits.
- Spoken answers should be short, warm, and concrete. When uncertain: “I don’t have that information. Would you like me to ask Elena?”
- Show captions for all spoken output and provide typed-input fallback without making it the visual focus.
- Reminder speech should interrupt only idle state, fire once, and include the event and person in plain language.

Companion components (`frontend/src/components/companion/`): `AmbientClock`, `PersonSpotlight`, `UpcomingCard`, `VoiceOrb`, `SpeechCaption`, `VoiceController`, and `ReminderAnnouncer`.

## Caregiver dashboard

- Route group under `/caregiver`; desktop-first but usable on tablet/mobile.
- Persistent navigation for Overview, People, Memories, Schedule, and Questions.
- Overview prioritizes pending questions and today's events; avoid analytics that do not help care.
- CRUD screens use familiar labeled forms, inline validation, save confirmation, and clear empty states.
- The Questions inbox distinguishes pending, answered, and delivered. Answering is a deliberate submit action; delivery status is read-only.
- Show dates in the browser’s local timezone while sending ISO 8601 timestamps with offsets.

Caregiver components (`frontend/src/components/caregiver/`): `DashboardShell`, `PersonCard`, `PersonForm`, `MemoryForm`, `EventForm`, `HandoffInbox`, and `HandoffReplyForm`.

## Visual system

- Warm ivory background, deep brown text, muted teal primary, and soft amber accent; tokens live in `globals.css`.
- Large type, generous spacing, rounded surfaces, subtle borders, restrained shadows.
- Companion: minimum 24px supporting text and 48px clock at typical display size; high contrast at all times.
- Caregiver: shadcn/ui primitives with consistent form spacing and status badges.
- Motion is slow and functional (listening pulse, gentle content dissolve) and disabled under `prefers-reduced-motion`.
- Use icons with text labels. Never encode state by color alone.

## Shared responsibilities

Shared shadcn primitives live in `frontend/src/components/ui/` and are integration-owned. API calls and types live in `frontend/src/lib/api/`. Feature components own presentation and local interaction only; persistent state and domain rules stay in FastAPI/SQLite.
