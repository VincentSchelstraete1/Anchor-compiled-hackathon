export type ISODateTime = string;

export interface Person {
  id: number;
  name: string;
  relationship: string;
  description: string;
  photo_url: string | null;
}
export type PersonCreate = Omit<Person, "id">;
export type PersonUpdate = Partial<PersonCreate>;
export interface PhotoUpload { photo_url: string; }
export interface DemoSeedResult {
  seeded: boolean;
  people: number;
  memories: number;
  events: number;
  medications: number;
}

export interface Memory {
  id: number;
  person_id: number | null;
  title: string;
  content: string;
  category: string;
  created_at: ISODateTime;
}
export type MemoryCreate = Omit<Memory, "id" | "created_at">;
export type MemoryUpdate = Partial<MemoryCreate>;

export interface Medication {
  id: number;
  person_id: number;
  name: string;
  purpose: string;
  dosage: string;
  frequency: string;
  location: string;
  refill_date: string | null;
  notes: string;
  active: boolean;
  created_at: ISODateTime;
}
export type MedicationCreate = Omit<Medication, "id" | "created_at">;
export type MedicationUpdate = Partial<MedicationCreate>;

export type EventStatus = "scheduled" | "completed" | "cancelled";
export interface Event {
  id: number;
  title: string;
  description: string;
  start_time: ISODateTime;
  person_id: number | null;
  reminder_minutes: number;
  reminder_enabled?: boolean;
  status: EventStatus;
}
export type EventCreate = Omit<Event, "id">;
export type EventUpdate = Partial<EventCreate>;

export interface CheckInSettings {
  proactive_enabled: boolean;
  morning_time: string;
  afternoon_time: string;
  evening_time: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  reminder_lead_minutes: number;
  spoken_reminders_enabled: boolean;
  updated_at: ISODateTime;
}
export type CheckInSettingsUpdate = Omit<CheckInSettings, "updated_at">;

export type HandoffStatus = "pending" | "answered" | "delivered" | "cancelled";
export interface Handoff {
  id: number;
  caregiver_person_id: number;
  question: string;
  status: HandoffStatus;
  response: string | null;
  created_at: ISODateTime;
  answered_at: ISODateTime | null;
  delivered_at: ISODateTime | null;
}
export interface HandoffCreate {
  caregiver_person_id: number;
  question: string;
  consent_confirmed: true;
}
export interface HandoffAnswer { response: string; }

export type ConversationRole = "user" | "assistant";
export interface ConversationMessage {
  id: number;
  role: ConversationRole;
  content: string;
  created_at: ISODateTime;
}
export interface ConversationContext {
  messages: ConversationMessage[];
  people: Person[];
  memories: Memory[];
  medications: Medication[];
  upcoming_events: Event[];
  pending_handoffs: Handoff[];
}
export interface ChatRequest { message: string; }
export interface ChatResponse {
  message: ConversationMessage;
  grounded: boolean;
  sources: Array<{ type: "person" | "memory" | "event" | "handoff" | "medication"; id: number }>;
  handoff_offered: boolean;
}

export interface HealthResponse { status: "ok"; }
export interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
export interface ListResponse<T> { items: T[]; }
