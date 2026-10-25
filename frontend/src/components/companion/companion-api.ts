import type {
  ChatResponse,
  ConversationContext,
  Event,
  Handoff,
  ListResponse,
} from "@/lib/api/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Uploaded photos come back as root-relative paths served by the API. */
export function resolveMediaUrl(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${BASE_URL}${url}` : url;
}

/**
 * Proposed, not yet in docs/API.md: the backend names the caregiver it would ask, so the client never has to
 * guess from generated text. Read defensively; absent means "unknown".
 */
export type CompanionChatResponse = ChatResponse & { handoff_caregiver_person_id?: number | null };

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

export function sendChat(message: string): Promise<CompanionChatResponse> {
  return request<CompanionChatResponse>("/chat", { method: "POST", body: JSON.stringify({ message }) }, 45000);
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

const SPEECH_TIMEOUT_MS = 12000;

/**
 * POST /speech -> MP3. Returns null on any failure (503 when unconfigured, network, timeout) so the caller can
 * fall back to browser speech. Aborts when `signal` fires.
 */
export async function fetchSpeechAudio(text: string, signal: AbortSignal): Promise<Blob | null> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal.aborted) return null;
  signal.addEventListener("abort", forward);
  const timer = setTimeout(forward, SPEECH_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 4096) }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forward);
  }
}

/**
 * Proposed, not yet in docs/API.md: GET /checkins -> { items: [{ id, time: "HH:MM", message?, days? }] }.
 * Returns null when the endpoint does not exist (404) so the caller stops asking; [] on transient errors.
 */
export async function getCheckIns(): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${BASE_URL}/checkins`, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
