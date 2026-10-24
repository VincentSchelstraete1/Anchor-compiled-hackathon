import type { Event, Memory, Person } from "@/lib/api/types";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export function greeting(hour: number): string {
  const tod = timeOfDay(hour);
  return tod === "night" ? (hour >= 21 ? "Good evening" : "Good night") : `Good ${tod}`;
}

const SOON_MS = 3 * 60 * 60_000;

/** Next scheduled event that has not started. A passed start time is never treated as "it happened". */
export function nextUpcoming(events: Event[], now: Date): Event | null {
  return (
    events
      .filter((e) => e.status === "scheduled" && new Date(e.start_time).getTime() >= now.getTime())
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null
  );
}

export interface HomeNarrative {
  line: string;
  /** Person the home photograph should feature, if context points to one. */
  focusPersonId: number | null;
}

export function homeNarrative(now: Date, events: Event[]): HomeNarrative {
  const hour = now.getHours();
  const next = nextUpcoming(events, now);
  if (next && new Date(next.start_time).getTime() - now.getTime() <= SOON_MS) {
    const time = new Date(next.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return { line: `${next.title} is scheduled for ${time}.`, focusPersonId: next.person_id };
  }
  const tod = timeOfDay(hour);
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return {
    line: tod === "morning" || tod === "afternoon" ? `${greeting(hour)}. It's ${date}.` : `${greeting(hour)}.`,
    focusPersonId: null,
  };
}

/** A stored memory for the featured person (or a general memory); rotates slowly with `bucket`. */
export function pickHomeMemory(memories: Memory[], person: Person | null, bucket: number): Memory | null {
  const own = person ? memories.filter((m) => m.person_id === person.id) : [];
  const pool = own.length > 0 ? own : memories.filter((m) => m.person_id === null);
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted[bucket % sorted.length];
}
