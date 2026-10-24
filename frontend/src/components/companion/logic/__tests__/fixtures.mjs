export const people = [
  { id: 1, name: "Elena Marlowe", relationship: "Daughter", description: "", photo_url: null },
  { id: 2, name: "Theo", relationship: "Grandson", description: "", photo_url: null },
];
export const memories = [
  { id: 10, person_id: 1, title: "Garden Sundays", content: "Elena and Margaret plant tomatoes.", category: "shared", created_at: "2026-01-01T00:00:00Z" },
  { id: 11, person_id: 1, title: "Beach day", content: "A day at the beach.", category: "shared", created_at: "2026-02-01T00:00:00Z" },
];
export const events = [
  { id: 20, title: "Visit from Elena", description: "", start_time: "2026-10-24T15:00:00Z", person_id: 1, reminder_minutes: 30, status: "scheduled" },
];
export const ctx = { people, memories, upcoming_events: events };
