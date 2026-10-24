"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { classifyRecognitionError } from "./logic/speech-errors";
import { getRecognitionCtor, onDeviceRecognitionAvailable, type Recognition } from "./speech";

export type MicStatus = "off" | "starting" | "listening" | "paused" | "muted" | "error";
export type TranscriptSource = "ptt" | "hands_free";
type Kind = "ptt-hold" | "ptt-tap" | "hands-free";

interface Options {
  /** Anchor is speaking or thinking: hands-free listening pauses so it cannot hear itself. */
  outputBusy: boolean;
  onTranscript: (text: string, source: TranscriptSource) => void;
  onInterim: (text: string) => void;
  onListening: (listening: boolean) => void;
  /** User-facing explanation; null clears it. */
  onNotice: (message: string | null) => void;
}

const noopSubscribe = () => () => {};
const RESTART_DELAY_MS = 250;
const SWITCH_DELAY_MS = 200;
/** Ignore recognition results this long after Anchor stops speaking (tail of its own audio). */
export const POST_SPEECH_DEAF_MS = 900;
const RAPID_END_MS = 1000;
const MAX_RAPID_ENDS = 4;
const MAX_SERVICE_FAILURES = 2;

/** Server and hydration assume support (renders no hint); the client then re-checks the real browser. */
function useRecognitionSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, () => getRecognitionCtor() !== null, () => true);
}

/**
 * One SpeechRecognition at a time, either push-to-talk (hold or tap) or hands-free. Hands-free keeps a continuous
 * session restarted while enabled, pauses during output, and gives up with an explanation instead of looping.
 * Whether recognition actually works depends on the browser's speech service and must be tested manually.
 */
export function useVoiceInput(options: Options) {
  const supported = useRecognitionSupported();
  const [handsFree, setHandsFreeState] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [status, setStatus] = useState<MicStatus>("off");

  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  const handsFreeRef = useRef(false);
  const mutedRef = useRef(false);
  const pttRef = useRef<"hold" | "tap" | null>(null);
  const fatalRef = useRef(false);
  const offlineRef = useRef(false);
  const localOnlyRef = useRef(false);
  const active = useRef<{ rec: Recognition; kind: Kind; startedAt: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deafUntil = useRef(0);
  const rapidEnds = useRef(0);
  const serviceFailures = useRef(0);
  const reconcileRef = useRef<() => void>(() => {});

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => reconcileRef.current(), ms);
  }, []);

  const desiredKind = (): Kind | null => {
    if (pttRef.current) return pttRef.current === "hold" ? "ptt-hold" : "ptt-tap";
    if (handsFreeRef.current && !mutedRef.current && !opts.current.outputBusy && !fatalRef.current && !offlineRef.current) return "hands-free";
    return null;
  };

  const publishStatus = (running: boolean) => {
    if (!handsFreeRef.current && !pttRef.current) return setStatus("off");
    if (pttRef.current) return setStatus(running ? "listening" : "starting");
    if (fatalRef.current || offlineRef.current) return setStatus("error");
    if (mutedRef.current) return setStatus("muted");
    if (opts.current.outputBusy) return setStatus("paused");
    setStatus(running ? "listening" : "starting");
  };

  const startRecognition = (kind: Kind) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      opts.current.onNotice("Voice input isn't supported in this browser. Try Chrome or Edge, or type below.");
      handsFreeRef.current = false;
      pttRef.current = null;
      setHandsFreeState(false);
      setPttActive(false);
      publishStatus(false);
      return;
    }
    const rec = new Ctor();
    const hold = kind !== "ptt-tap";
    let transcript = "";
    const errors: { code: string | null } = { code: null };
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = hold;
    if (localOnlyRef.current) rec.processLocally = true;
    const entry = { rec, kind, startedAt: Date.now() };

    rec.onresult = (event) => {
      if (active.current?.rec !== rec) return;
      if (kind === "hands-free") {
        if (Date.now() < deafUntil.current) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) opts.current.onTranscript(result[0].transcript.trim(), "hands_free");
        }
        return;
      }
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      transcript = text;
      opts.current.onInterim(text);
    };
    rec.onerror = (event) => {
      errors.code = event.error;
    };
    rec.onend = () => {
      const wasCurrent = active.current?.rec === rec;
      if (wasCurrent) active.current = null;
      if (!wasCurrent) return; // aborted on purpose and already replaced
      const ranFor = Date.now() - entry.startedAt;
      if (kind !== "hands-free") {
        pttRef.current = null;
        setPttActive(false);
        opts.current.onListening(false);
      }
      const online = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
      const info = errors.code ? classifyRecognitionError(errors.code, { online, secure: window.isSecureContext }) : null;

      if (info?.kind === "offline") {
        offlineRef.current = true;
      } else if (info?.kind === "service_unreachable") {
        serviceFailures.current++;
        if (serviceFailures.current >= MAX_SERVICE_FAILURES) fatalRef.current = true;
        void onDeviceRecognitionAvailable(rec.lang).then((ok) => {
          if (ok && !localOnlyRef.current) {
            localOnlyRef.current = true;
            fatalRef.current = false;
            serviceFailures.current = 0;
            opts.current.onNotice(null);
            reconcileRef.current();
          }
        });
      } else if (info?.fatal) {
        fatalRef.current = true;
      }
      if (info && info.message && info.kind !== "no_speech") {
        if (info.kind !== "service_unreachable" || fatalRef.current) opts.current.onNotice(info.message);
      }
      if (info?.fatal || (fatalRef.current && kind === "hands-free")) {
        handsFreeRef.current = false;
        setHandsFreeState(false);
      }

      if (kind === "hands-free") {
        rapidEnds.current = ranFor < RAPID_END_MS ? rapidEnds.current + 1 : 0;
        if (rapidEnds.current >= MAX_RAPID_ENDS) {
          fatalRef.current = true;
          handsFreeRef.current = false;
          setHandsFreeState(false);
          opts.current.onNotice("Hands-free listening keeps stopping in this browser, so I've turned it off. You can still hold Space or type.");
        }
      } else {
        const text = transcript.trim();
        if (text) opts.current.onTranscript(text, "ptt");
        else if (!info) opts.current.onNotice("I didn't catch that. Please try again.");
      }
      publishStatus(false);
      schedule(kind === "hands-free" ? RESTART_DELAY_MS : SWITCH_DELAY_MS);
    };

    active.current = entry;
    try {
      rec.start();
      if (kind !== "hands-free") opts.current.onListening(true);
      publishStatus(true);
    } catch {
      active.current = null;
      pttRef.current = null;
      setPttActive(false);
      opts.current.onNotice("I couldn't start listening. Please try again.");
      publishStatus(false);
    }
  };

  const reconcile = () => {
    const want = desiredKind();
    const cur = active.current;
    if (cur && cur.kind !== want) {
      active.current = null;
      cur.rec.onend = null;
      cur.rec.abort();
      if (cur.kind !== "hands-free") opts.current.onListening(false);
      publishStatus(false);
      if (want) schedule(SWITCH_DELAY_MS);
      else if (!pttRef.current) publishStatus(false);
      return;
    }
    if (!cur && want) {
      startRecognition(want);
      return;
    }
    publishStatus(!!cur);
  };

  useEffect(() => {
    reconcileRef.current = reconcile;
  });

  // Pause while Anchor talks or thinks; resume (after a short deaf period) when it stops.
  useEffect(() => {
    if (!options.outputBusy) deafUntil.current = Date.now() + POST_SPEECH_DEAF_MS;
    reconcileRef.current();
    if (!options.outputBusy && handsFreeRef.current) schedule(POST_SPEECH_DEAF_MS / 3);
  }, [options.outputBusy, schedule]);

  // Browsers report connectivity changes; resume after being offline.
  useEffect(() => {
    const onOnline = () => {
      if (!offlineRef.current) return;
      offlineRef.current = false;
      opts.current.onNotice(null);
      reconcileRef.current();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (active.current) {
        active.current.rec.onend = null;
        active.current.rec.abort();
        active.current = null;
      }
    },
    [],
  );

  /** Must be called from a user gesture so the browser can show its microphone prompt. */
  const setHandsFree = useCallback((on: boolean) => {
    handsFreeRef.current = on;
    setHandsFreeState(on);
    if (on) {
      fatalRef.current = false;
      serviceFailures.current = 0;
      rapidEnds.current = 0;
      mutedRef.current = false;
      setMutedState(false);
      opts.current.onNotice(null);
    }
    reconcileRef.current();
  }, []);

  const setMuted = useCallback((on: boolean) => {
    mutedRef.current = on;
    setMutedState(on);
    reconcileRef.current();
  }, []);

  const pttStart = useCallback((hold: boolean) => {
    if (pttRef.current) return;
    pttRef.current = hold ? "hold" : "tap";
    fatalRef.current = false;
    setPttActive(true);
    opts.current.onNotice(null);
    reconcileRef.current();
  }, []);

  const pttStop = useCallback(() => {
    if (!active.current || active.current.kind === "hands-free") {
      // Released before recognition began (e.g. while hands-free was being swapped out): cancel the request.
      if (pttRef.current) {
        pttRef.current = null;
        setPttActive(false);
        opts.current.onListening(false);
        reconcileRef.current();
      }
      return;
    }
    // stop() (not abort) so the browser still delivers the final transcript.
    active.current.rec.stop();
  }, []);

  return { supported, handsFree, muted, pttActive, status, setHandsFree, setMuted, pttStart, pttStop };
}
