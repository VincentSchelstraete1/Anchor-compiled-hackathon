import type { ConversationContext } from "@/lib/api/types";

/** Fictional placeholder content shown only while the backend is unreachable. Ids are negative: never real. */
export function demoContext(now: Date): ConversationContext {
  const visit = new Date(now);
  visit.setHours(15, 0, 0, 0);
  if (visit.getTime() < now.getTime()) visit.setDate(visit.getDate() + 1);
  return {
    messages: [],
    people: [
      { id: -1, name: "Elena", relationship: "Daughter", description: "Visits on Sundays.", photo_url: null },
      { id: -2, name: "Theo", relationship: "Grandson", description: "", photo_url: null },
    ],
    memories: [
      {
        id: -1,
        person_id: -1,
        title: "Sunday garden",
        content: "Elena and Margaret like planting tomatoes together in the garden on Sundays.",
        category: "shared",
        created_at: "2026-09-01T10:00:00Z",
      },
    ],
    medications: [],
    upcoming_events: [
      {
        id: -1,
        title: "Visit from Elena",
        description: "",
        start_time: visit.toISOString(),
        person_id: -1,
        reminder_minutes: 30,
        status: "scheduled",
      },
    ],
    pending_handoffs: [],
  };
}
