import type { Event, Handoff, Memory, Person } from "@/lib/api/types";

export type Voice = "idle" | "listening" | "processing" | "speaking";

/** What the screen is showing. `stamp` is set by the reducer so stale timers can be ignored. */
export type SceneData =
  | { kind: "home" }
  | { kind: "person"; person: Person; memory: Memory | null; event: Event | null }
  | { kind: "memory"; person: Person | null; memory: Memory }
  | { kind: "event"; person: Person | null; event: Event }
  | { kind: "reminder"; person: Person | null; event: Event }
  | { kind: "uncertain"; subject: Person | null }
  | { kind: "waiting"; caregiver: Person | null; question: string }
  | { kind: "reply"; caregiver: Person | null; handoff: Handoff };
export type Scene = SceneData & { stamp: number };

export interface AmbientState {
  voice: Voice;
  scene: Scene;
  counter: number;
}

export type AmbientAction =
  | { type: "listen_start" }
  | { type: "listen_end" }
  | { type: "processing" }
  | { type: "speak_start" }
  | { type: "speak_end" }
  | { type: "interrupt" }
  | { type: "show"; scene: SceneData }
  | { type: "scene_timeout"; stamp: number };

export const initialAmbient: AmbientState = { voice: "idle", scene: { kind: "home", stamp: 0 }, counter: 0 };

/** Only deliberate transitions are allowed; anything else leaves the state untouched. */
export function ambientReducer(state: AmbientState, action: AmbientAction): AmbientState {
  const { voice } = state;
  switch (action.type) {
    case "listen_start":
      // Starting to talk interrupts speech, but not an in-flight request.
      return voice === "processing" ? state : { ...state, voice: "listening" };
    case "listen_end":
      return voice === "listening" ? { ...state, voice: "idle" } : state;
    case "processing":
      return voice === "processing" ? state : { ...state, voice: "processing" };
    case "speak_start":
      return voice === "listening" ? state : { ...state, voice: "speaking" };
    case "speak_end":
      return voice === "speaking" ? { ...state, voice: "idle" } : state;
    case "interrupt":
      return voice === "speaking" || voice === "processing" ? { ...state, voice: "idle" } : state;
    case "show": {
      const counter = state.counter + 1;
      return { ...state, counter, scene: { ...action.scene, stamp: counter } };
    }
    case "scene_timeout":
      return state.scene.stamp === action.stamp && state.scene.kind !== "home"
        ? { ...state, scene: { kind: "home", stamp: state.counter } }
        : state;
  }
}

export type AmbientStateName =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "showing_person"
  | "showing_memory"
  | "showing_event"
  | "delivering_reminder"
  | "awaiting_consent"
  | "caregiver_reply"
  | "waiting_for_caregiver";

export function deriveAmbientState(state: AmbientState, hasPendingHandoff: boolean): AmbientStateName {
  const { voice, scene } = state;
  if (voice === "listening" || voice === "processing") return voice;
  if (scene.kind === "reminder") return "delivering_reminder";
  if (scene.kind === "reply") return "caregiver_reply";
  if (voice === "speaking") return "speaking";
  switch (scene.kind) {
    case "person": return "showing_person";
    case "memory": return "showing_memory";
    case "event": return "showing_event";
    case "uncertain": return "awaiting_consent";
    case "waiting": return "waiting_for_caregiver";
    default: return hasPendingHandoff ? "waiting_for_caregiver" : "idle";
  }
}

/** How long a scene lingers after Anchor goes quiet before returning home (ms). */
export function sceneLinger(kind: SceneData["kind"]): number {
  switch (kind) {
    case "reminder": return 10 * 60_000;
    case "uncertain": return 90_000;
    case "reply": return 60_000;
    default: return 30_000;
  }
}
