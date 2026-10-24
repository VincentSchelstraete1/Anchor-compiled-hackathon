import type { ConversationContext } from "@/lib/api/types";

/** Fictional placeholder content shown only while the backend is unreachable. */
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
    memories: [],
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
