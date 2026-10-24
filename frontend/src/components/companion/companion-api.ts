import type {
  ChatResponse,
  ConversationContext,
  Event,
  Handoff,
  ListResponse,
} from "@/lib/api/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function getContext(): Promise<ConversationContext> {
  return request<ConversationContext>("/conversation/context");
}

export function sendChat(message: string): Promise<ChatResponse> {
  return request<ChatResponse>("/chat", { method: "POST", body: JSON.stringify({ message }) }, 45000);
}

export async function getDueReminders(at: Date): Promise<Event[]> {
  const data = await request<ListResponse<Event>>(`/reminders/due?at=${encodeURIComponent(at.toISOString())}`);
  return data.items;
}

export async function getAnsweredHandoffs(): Promise<Handoff[]> {
  const data = await request<ListResponse<Handoff>>("/handoffs?status=answered");
  return data.items;
}

export function createHandoff(caregiverPersonId: number, question: string): Promise<Handoff> {
  return request<Handoff>("/handoffs", {
    method: "POST",
    body: JSON.stringify({ caregiver_person_id: caregiverPersonId, question, consent_confirmed: true }),
  });
}

export function markHandoffDelivered(id: number): Promise<Handoff> {
  return request<Handoff>(`/handoffs/${id}/deliver`, { method: "POST" });
}
