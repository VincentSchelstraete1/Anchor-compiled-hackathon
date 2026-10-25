import type {
  CheckInSettings,
  CheckInSettingsUpdate,
  Event,
  EventCreate,
  EventUpdate,
  DemoSeedResult,
  Handoff,
  HandoffAnswer,
  ListResponse,
  Memory,
  MemoryCreate,
  MemoryUpdate,
  Medication,
  MedicationCreate,
  MedicationUpdate,
  Person,
  PersonCreate,
  PersonUpdate,
} from "@/lib/api/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new ApiRequestError(payload?.error?.message ?? "Something went wrong. Please try again.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });

export const caregiverApi = {
  demo: {
    seed: () => request<DemoSeedResult>("/demo/seed", { method: "POST" }),
  },
  people: {
    list: () => request<ListResponse<Person>>("/people"),
    get: (id: number) => request<Person>(`/people/${id}`),
    create: (data: PersonCreate) => request<Person>("/people", { method: "POST", ...json(data) }),
    update: (id: number, data: PersonUpdate) =>
      request<Person>(`/people/${id}`, { method: "PATCH", ...json(data) }),
    remove: (id: number) => request<void>(`/people/${id}`, { method: "DELETE" }),
  },
  memories: {
    list: (filters?: { person_id?: number; category?: string }) => {
      const params = new URLSearchParams();
      if (filters?.person_id) params.set("person_id", String(filters.person_id));
      if (filters?.category) params.set("category", filters.category);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return request<ListResponse<Memory>>(`/memories${query}`);
    },
    create: (data: MemoryCreate) => request<Memory>("/memories", { method: "POST", ...json(data) }),
    update: (id: number, data: MemoryUpdate) =>
      request<Memory>(`/memories/${id}`, { method: "PATCH", ...json(data) }),
    remove: (id: number) => request<void>(`/memories/${id}`, { method: "DELETE" }),
  },
  medications: {
    list: (query = "") => request<ListResponse<Medication>>(`/medications${query}`),
    create: (data: MedicationCreate) => request<Medication>("/medications", { method: "POST", ...json(data) }),
    update: (id: number, data: MedicationUpdate) => request<Medication>(`/medications/${id}`, { method: "PATCH", ...json(data) }),
    remove: (id: number) => request<void>(`/medications/${id}`, { method: "DELETE" }),
  },
  events: {
    list: (query = "") => request<ListResponse<Event>>(`/events${query}`),
    create: (data: EventCreate) => request<Event>("/events", { method: "POST", ...json(data) }),
    update: (id: number, data: EventUpdate) =>
      request<Event>(`/events/${id}`, { method: "PATCH", ...json(data) }),
    remove: (id: number) => request<void>(`/events/${id}`, { method: "DELETE" }),
  },
  checkIns: {
    get: () => request<CheckInSettings>("/settings/check-ins"),
    update: (data: CheckInSettingsUpdate) =>
      request<CheckInSettings>("/settings/check-ins", { method: "PUT", ...json(data) }),
  },
  handoffs: {
    list: () => request<ListResponse<Handoff>>("/handoffs"),
    answer: (id: number, data: HandoffAnswer) =>
      request<Handoff>(`/handoffs/${id}/answer`, { method: "POST", ...json(data) }),
  },
};
