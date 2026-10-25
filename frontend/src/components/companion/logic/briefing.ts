import type { Event, Memory, Person } from "@/lib/api/types";
import type { Scene } from "./ambient-state";

export type EventKind = "visit" | "appointment" | "routine";

export interface DayItem {
  event: Event;
  /** Null when the event is about the primary user themself or has no person. */
  person: Person | null;
  kind: EventKind;
}

/** The caregiver-entered record for the person using Anchor has the relationship "Self". */
export function isSelf(person: Person | null | undefined): boolean {
  return !!person && person.relationship.trim().toLowerCase() === "self";
}

export function primaryUser(people: Person[]): Person | null {
  return people.find(isSelf) ?? null;
}

const CLINICAL = /\b(doctor|dr\.?|nurse|physician|clinic|dentist|therapist|pharmac)/i;
const APPOINTMENT_TITLE = /\b(appointment|check-?up|clinic|doctor|dentist|hospital)\b/i;

export function classifyEvent(event: Event, person: Person | null): EventKind {
  if (person && !isSelf(person)) return CLINICAL.test(person.relationship) || APPOINTMENT_TITLE.test(event.title) ? "appointment" : "visit";
  return APPOINTMENT_TITLE.test(event.title) ? "appointment" : "routine";
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Scheduled events that have not started yet and fall on today's local date, earliest first. */
export function buildDay(events: Event[], people: Person[], now: Date, mode: "briefing" | "visitors"): DayItem[] {
  const items = events
    .filter((e) => e.status === "scheduled")
    .filter((e) => {
      const start = new Date(e.start_time);
      return start.getTime() >= now.getTime() && sameLocalDay(start, now);
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((event): DayItem => {
      const found = event.person_id === null ? null : people.find((p) => p.id === event.person_id) ?? null;
      const person = isSelf(found) ? null : found;
      return { event, person, kind: classifyEvent(event, found) };
    });
  return mode === "visitors" ? items.filter((i) => i.kind === "visit" && i.person) : items;
}

/** Caregiver memories filed as routines. */
export function routineMemories(memories: Memory[]): Memory[] {
  return memories.filter((m) => /routine/i.test(m.category));
}

export type LocalIntent = "briefing" | "visitors";

/** Questions answered directly from caregiver records. Other questions go to the conversation backend. */
export function localIntent(text: string): LocalIntent | null {
  const q = text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/\bwho(?: is| are|s)? (visiting|coming)\b/.test(q) || /\bany visitors\b/.test(q) || /\bvisitors today\b/.test(q) || /\bwho is coming today\b/.test(q)) return "visitors";
  if (
    /\bwhat(?: is| are|s)? (happening|going on|planned|on) (today|this morning|this afternoon)\b/.test(q) ||
    /\bwhat do i have (on )?today\b/.test(q) ||
    /\b(my|todays) (day|schedule|plan)\b/.test(q) ||
    /\bwhats? (my )?(plan|schedule) (for )?today\b/.test(q)
  )
    return "briefing";
  return null;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "in about 15 minutes". Never claims anyone has arrived. */
export function minutesPhrase(startIso: string, now: Date): string {
  const minutes = Math.round((new Date(startIso).getTime() - now.getTime()) / 60000);
  if (minutes <= 1) return "in a moment";
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Proactive reminder wording. Says "scheduled", never that someone has arrived or is on their way. */
export function proactiveSpeech(event: Event, person: Person | null, now: Date, userName: string | null): string {
  const when = minutesPhrase(event.start_time, now);
  const kind = classifyEvent(event, person);
  const lead = userName ? `${userName}, ` : "";
  if (kind === "visit" && person) {
    return `${lead}${person.name} is scheduled to visit ${when}. Would you like to see a picture of ${person.name}?`;
  }
  if (kind === "appointment") return `${lead}${lead ? "you have" : "Reminder:"} ${event.title} scheduled ${when}.`;
  return `${lead}${lead ? "a reminder:" : "Reminder:"} ${event.title}, ${when}.`;
}

export const DEFAULT_CHECKIN = "Hello. How are you feeling today? I'm here if you'd like to talk.";

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function visitorsSpeech(items: DayItem[]): string {
  if (items.length === 0) return "I don't see any visitors scheduled for today.";
  const parts = items.map((i) => `${i.person!.name} at ${formatTime(i.event.start_time)}`);
  return items.length === 1
    ? `${parts[0]} is scheduled to visit today.`
    : `${listNames(parts)} are scheduled to visit today.`;
}

export function briefingSpeech(items: DayItem[], now: Date, userName: string | null): string {
  const hello = `${greetingFor(now.getHours())}${userName ? `, ${userName}` : ""}.`;
  if (items.length === 0) return `${hello} I don't see anything planned for the rest of today.`;
  const shown = items.slice(0, 4).map((i) => {
    const at = formatTime(i.event.start_time);
    if (i.kind === "visit" && i.person) return `at ${at}, ${i.person.name} is scheduled to visit`;
    return `at ${at}, ${i.event.title}${i.kind === "appointment" ? " is scheduled" : ""}`;
  });
  const more = items.length > 4 ? ` There ${items.length - 4 === 1 ? "is" : "are"} ${items.length - 4} more after that.` : "";
  const count = items.length === 1 ? "There is one thing planned for the rest of today" : `There are ${items.length} things planned for the rest of today`;
  return `${hello} ${count}: ${shown.join("; ")}.${more}`;
}

/** Replaces records held by a scene with their latest versions, so caregiver edits show without a new question. */
export interface LiveContext { people: Person[]; memories: Memory[]; upcoming_events: Event[] }

export function freshPerson(p: Person | null, ctx: LiveContext): Person | null {
  return p ? ctx.people.find((x) => x.id === p.id) ?? p : null;
}
export function freshEvent(e: Event, ctx: LiveContext): Event {
  return ctx.upcoming_events.find((x) => x.id === e.id) ?? e;
}
export function freshMemory(m: Memory, ctx: LiveContext): Memory {
  return ctx.memories.find((x) => x.id === m.id) ?? m;
}

/** The scene with every record it holds swapped for its latest version in `ctx`; records missing from `ctx` are kept. */
export function refreshScene(scene: Scene, ctx: LiveContext, now: Date): Scene {
  switch (scene.kind) {
    case "person": {
      const person = freshPerson(scene.person, ctx)!;
      const event =
        ctx.upcoming_events
          .filter((e) => e.person_id === person.id && e.status === "scheduled" && new Date(e.start_time).getTime() >= now.getTime())
          .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null;
      return { ...scene, person, event, memory: scene.memory ? freshMemory(scene.memory, ctx) : null };
    }
    case "memory":
      return { ...scene, person: freshPerson(scene.person, ctx), memory: freshMemory(scene.memory, ctx) };
    case "event":
    case "reminder":
      return { ...scene, person: freshPerson(scene.person, ctx), event: freshEvent(scene.event, ctx) };
    default:
      return scene;
  }
}
