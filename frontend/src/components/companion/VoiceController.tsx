"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { getRecognitionCtor, type Recognition } from "./speech";
import { VoiceOrb, type Phase } from "./VoiceOrb";

interface Props {
  phase: Phase;
  onListenStart: () => void;
  onListenEnd: () => void;
  onInterim: (text: string) => void;
  onUtterance: (text: string) => void;
  onNotice: (message: string | null) => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow microphone access in your browser settings, or type below.",
  "service-not-allowed": "The microphone is blocked. Allow microphone access in your browser settings, or type below.",
  "audio-capture": "No microphone was found. You can type below instead.",
  network: "Voice input needs an internet connection right now. You can type below instead.",
  "no-speech": "I didn't hear anything. Please try again.",
};

const noopSubscribe = () => () => {};

/** Server and hydration assume support (no hint rendered); the client then re-checks the real browser. */
function useRecognitionSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, () => getRecognitionCtor() !== null, () => true);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function VoiceController({ phase, onListenStart, onListenEnd, onInterim, onUtterance, onNotice }: Props) {
  const [typed, setTyped] = useState("");
  const supported = useRecognitionSupported();
  const recognition = useRef<Recognition | null>(null);
  const holding = useRef(false);
  const latest = useRef({ phase, onListenStart, onListenEnd, onInterim, onUtterance, onNotice });
  useEffect(() => {
    latest.current = { phase, onListenStart, onListenEnd, onInterim, onUtterance, onNotice };
  });

  const start = useCallback((hold: boolean) => {
    if (recognition.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      latest.current.onNotice("Voice input isn't supported in this browser. Try Chrome or Edge, or type below.");
      return;
    }
    const rec = new Ctor();
    let transcript = "";
    let failure: string | null = null;
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = hold;
    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      transcript = text;
      latest.current.onInterim(text);
    };
    rec.onerror = (event) => {
      failure = event.error;
    };
    rec.onend = () => {
      recognition.current = null;
      holding.current = false;
      const text = transcript.trim();
      if (failure && failure !== "aborted" && !text) {
        latest.current.onNotice(ERROR_MESSAGES[failure] ?? "Voice input stopped unexpectedly. You can type below.");
        latest.current.onListenEnd();
      } else if (text) {
        latest.current.onUtterance(text);
      } else {
        latest.current.onListenEnd();
      }
    };
    latest.current.onNotice(null);
    latest.current.onListenStart();
    recognition.current = rec;
    try {
      rec.start();
    } catch {
      recognition.current = null;
      latest.current.onNotice("I couldn't start listening. Please try again.");
      latest.current.onListenEnd();
    }
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  // Push-to-talk: hold Space to listen, release to send. Escape stops speech.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (e.repeat || holding.current || latest.current.phase === "thinking") return;
      holding.current = true;
      start(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (holding.current) stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      recognition.current?.abort();
    };
  }, [start, stop]);

  const press = () => {
    if (recognition.current) stop();
    else start(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text || phase === "thinking") return;
    setTyped("");
    latest.current.onNotice(null);
    latest.current.onUtterance(text);
  };

  return (
    <div className="space-y-5">
      <VoiceOrb phase={phase} onPress={press} />
      {!supported ? (
        <p className="text-lg text-muted-foreground">Voice input isn&apos;t available in this browser, so please type below.</p>
      ) : null}
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
          className="min-w-0 flex-1 rounded-xl border bg-card px-4 py-3 text-xl focus-visible:outline-4 focus-visible:outline-ring"
        />
        <button
          type="submit"
          disabled={!typed.trim() || phase === "thinking"}
          className="rounded-xl bg-secondary px-5 py-3 text-xl font-semibold text-secondary-foreground focus-visible:outline-4 focus-visible:outline-ring disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
