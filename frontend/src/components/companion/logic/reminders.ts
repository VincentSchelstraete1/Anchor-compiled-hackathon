import type { Event, Person } from "@/lib/api/types";

export function reminderKey(event: Pick<Event, "id" | "start_time">): string {
  return `${event.id}@${event.start_time}`;
}

export interface ReminderQueue {
  /** Adds scheduled events not seen before. Returns how many were new. */
  offer(events: Event[]): number;
  /** Next unannounced reminder, or null. Each reminder is returned at most once per session. */
  take(): Event | null;
  hasPending(): boolean;
}

export function createReminderQueue(): ReminderQueue {
  const seen = new Set<string>();
  const queue: Event[] = [];
  return {
    offer(events) {
      let added = 0;
      for (const event of events) {
        if (event.status !== "scheduled") continue;
        const key = reminderKey(event);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(event);
        added++;
      }
      queue.sort((a, b) => a.start_time.localeCompare(b.start_time));
      return added;
    },
    take: () => queue.shift() ?? null,
    hasPending: () => queue.length > 0,
  };
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Never says an event is confirmed, underway, or that anyone has arrived: only that it is scheduled. */
export function reminderSpeech(event: Event, person: Person | null): string {
  const who = person ? ` with ${person.name}, your ${person.relationship.toLowerCase()},` : "";
  return `Reminder: ${event.title}${who} is scheduled for ${formatClock(event.start_time)}.`;
}

export interface QuietHours { startMinutes: number; endMinutes: number }

/** Parses "22:00-07:00". Returns null for anything else (quiet hours are then simply not configured). */
export function parseQuietHours(value: string | null): QuietHours | null {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!m) return null;
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  return { startMinutes: sh * 60 + sm, endMinutes: eh * 60 + em };
}

export function isQuietHour(now: Date, quiet: QuietHours | null): boolean {
  if (!quiet || quiet.startMinutes === quiet.endMinutes) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return quiet.startMinutes < quiet.endMinutes
    ? minutes >= quiet.startMinutes && minutes < quiet.endMinutes
    : minutes >= quiet.startMinutes || minutes < quiet.endMinutes;
}

const ACK = new Set([
  "ok", "okay", "thanks", "thank you", "got it", "i know", "i understand", "all right", "alright", "i heard",
  "okay thank you", "ok thanks", "okay thanks", "thank you anchor", "thanks anchor", "understood",
]);

export function isAcknowledgement(text: string): boolean {
  return ACK.has(text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim());
}
