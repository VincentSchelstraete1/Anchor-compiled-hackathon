"use client";

import { Mic, MicOff, Radio } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { AmbientStateName, Voice } from "./logic/ambient-state";
import type { MicStatus } from "./useVoiceInput";
import { VoiceOrb, type OrbPhase } from "./VoiceOrb";

interface Props {
  stateName: AmbientStateName;
  voice: Voice;
  waitingFor: string | null;
  supported: boolean;
  handsFree: boolean;
  muted: boolean;
  micStatus: MicStatus;
  sessionOpen: boolean;
  pttActive: boolean;
  busy: boolean;
  onOrbPress: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onToggleHandsFree: () => void;
  onToggleMute: () => void;
  onInterrupt: () => void;
  onTyped: (text: string) => void;
}

const STATE_LABEL: Partial<Record<AmbientStateName, string>> = {
  listening: "Listening",
  processing: "Thinking",
  speaking: "Speaking",
  delivering_reminder: "Reminder",
  awaiting_consent: "Waiting for your answer",
  caregiver_reply: "A reply has arrived",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function micStatusText(p: Pick<Props, "supported" | "handsFree" | "muted" | "micStatus" | "sessionOpen" | "pttActive">): string {
  if (!p.supported) return "Voice isn't available in this browser. Typing works.";
  if (p.pttActive) return "Microphone on while you hold Space";
  if (!p.handsFree) return "Microphone off";
  if (p.muted) return "Microphone muted";
  switch (p.micStatus) {
    case "listening": return p.sessionOpen ? "Microphone on. Go ahead, I'm listening" : "Microphone on. Say “Anchor” to talk";
    case "paused": return "Microphone paused while Anchor speaks";
    case "starting": return "Starting the microphone…";
    case "error": return "Microphone unavailable";
    default: return "Microphone off";
  }
}

export function VoiceController(p: Props) {
  const [typed, setTyped] = useState("");

  // Push-to-talk: hold Space. Escape stops Anchor speaking.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Escape") return p.onInterrupt();
      if (e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat) p.onHoldStart();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget(e.target)) return;
      e.preventDefault();
      p.onHoldEnd();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text || p.busy) return;
    setTyped("");
    p.onTyped(text);
  };

  const hfLive = p.handsFree && !p.muted && p.micStatus === "listening" && p.sessionOpen;
  const orbPhase: OrbPhase = p.voice === "idle" ? (hfLive ? "listening" : "idle") : p.voice;
  const label = p.waitingFor && p.stateName === "waiting_for_caregiver" ? `Waiting for ${p.waitingFor}` : STATE_LABEL[p.stateName] ?? "Ready";
  const button = "inline-flex min-h-14 items-center gap-2 rounded-2xl px-4 text-xl font-semibold outline-offset-4 focus-visible:outline-4 focus-visible:outline-[var(--a-sage)]";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <VoiceOrb phase={orbPhase} unavailable={!p.supported} onPress={p.onOrbPress} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-[clamp(1.75rem,4.2vh,2.25rem)] font-semibold leading-tight" data-testid="state-label">{label}</p>
            <p className="flex items-center gap-2 text-xl leading-snug text-[var(--a-muted)]" data-testid="mic-status">
              <span aria-hidden="true" className={`inline-block size-3 shrink-0 rounded-full ${p.handsFree && p.micStatus === "listening" && !p.muted ? "bg-[var(--a-terra)]" : "border-2 border-[var(--a-muted)]"}`} />
              <span role="status">{micStatusText(p)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {p.supported ? (
              <button type="button" onClick={p.onToggleHandsFree} aria-pressed={p.handsFree} className={`${button} ${p.handsFree ? "bg-[var(--a-sage)] text-[var(--a-on-accent)]" : "border-2 border-[var(--a-sage)] text-[var(--a-sage)]"}`}>
                <Radio aria-hidden="true" className="size-6" />
                {p.handsFree ? "Hands-free is on" : "Start hands-free"}
              </button>
            ) : null}
            {p.handsFree ? (
              <button type="button" onClick={p.onToggleMute} aria-pressed={p.muted} className={`${button} border-2 border-[var(--a-border)]`}>
                {p.muted ? <MicOff aria-hidden="true" className="size-6" /> : <Mic aria-hidden="true" className="size-6" />}
                {p.muted ? "Unmute" : "Mute"}
              </button>
            ) : null}
            <span className="text-xl text-[var(--a-muted)]">or hold Space</span>
          </div>
        </div>
      </div>
      <form onSubmit={submit} className="flex gap-3">
        <label htmlFor="typed-message" className="sr-only">
          Type a message to Anchor
        </label>
        <input
          id="typed-message"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          placeholder="Or type here…"
          className="min-h-14 min-w-0 flex-1 rounded-2xl border border-[var(--a-border)] bg-[var(--a-card)] px-5 text-xl text-[var(--a-fg)] placeholder:text-[var(--a-muted)] focus-visible:outline-4 focus-visible:outline-[var(--a-sage)]"
        />
        <button type="submit" disabled={!typed.trim() || p.busy} className={`${button} bg-[var(--a-sage-soft)] text-[var(--a-fg)] disabled:opacity-50`}>
          Send
        </button>
      </form>
    </div>
  );
}
