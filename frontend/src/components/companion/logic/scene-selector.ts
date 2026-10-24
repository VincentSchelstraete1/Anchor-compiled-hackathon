import type { ChatResponse, ConversationContext, Event, Memory, Person } from "@/lib/api/types";
import type { SceneData } from "./ambient-state";

export type Focus = "event" | "memory" | "person";

/** Reads intent from the person's *own* question (never from generated text), only to rank structured sources. */
export function questionFocus(question: string): Focus | null {
  const q = question.toLowerCase();
  if (/\b(when|what time|visit|visiting|coming|come|arrive|arriving|schedule|scheduled|appointment)\b/.test(q)) return "event";
  if (/\b(together|remember|memory|memories|usually|used to|like doing|love doing|favou?rite)\b/.test(q)) return "memory";
  if (/\b(who|who's|whos)\b/.test(q)) return "person";
  return null;
}

export interface Selection {
  scene: SceneData;
  /** A cited record was not in the loaded context: refresh the context and select again. */
  missing: boolean;
}

type Context = Pick<ConversationContext, "people" | "memories" | "upcoming_events">;

const newestFirst = (a: Memory, b: Memory) => b.created_at.localeCompare(a.created_at);

export function nextEventFor(personId: number, events: Event[], now: Date): Event | null {
  return (
    events
      .filter((e) => e.person_id === personId && e.status === "scheduled" && new Date(e.start_time).getTime() >= now.getTime())
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null
  );
}

export function selectScene(
  response: Pick<ChatResponse, "sources" | "handoff_offered">,
  context: Context,
  question: string,
  now: Date,
): Selection {
  const persons: Person[] = [];
  const memories: Memory[] = [];
  const events: Event[] = [];
  let missing = false;
  for (const source of response.sources) {
    if (source.type === "person") {
      const p = context.people.find((x) => x.id === source.id);
      if (p) persons.push(p);
      else missing = true;
    } else if (source.type === "memory") {
      const m = context.memories.find((x) => x.id === source.id);
      if (m) memories.push(m);
      else missing = true;
    } else if (source.type === "event") {
      const e = context.upcoming_events.find((x) => x.id === source.id);
      if (e) events.push(e);
      else missing = true;
    }
  }
  const personById = (id: number | null) => (id === null ? null : context.people.find((p) => p.id === id) ?? null);

  if (response.handoff_offered) return { scene: { kind: "uncertain", subject: persons[0] ?? null }, missing };

  const candidates: Record<Focus, SceneData | null> = {
    event: events[0] ? { kind: "event", event: events[0], person: personById(events[0].person_id) ?? persons[0] ?? null } : null,
    memory: memories[0] ? { kind: "memory", memory: memories[0], person: personById(memories[0].person_id) ?? persons[0] ?? null } : null,
    person: persons[0]
      ? {
          kind: "person",
          person: persons[0],
          memory: memories[0] ?? context.memories.filter((m) => m.person_id === persons[0].id).sort(newestFirst)[0] ?? null,
          event: nextEventFor(persons[0].id, context.upcoming_events, now),
        }
      : null,
  };
  const focus = questionFocus(question);
  const order: Focus[] = focus ? [focus, ...(["event", "memory", "person"] as Focus[]).filter((f) => f !== focus)] : ["event", "memory", "person"];
  for (const f of order) {
    const scene = candidates[f];
    if (scene) return { scene, missing };
  }
  return { scene: { kind: "home" }, missing };
}
