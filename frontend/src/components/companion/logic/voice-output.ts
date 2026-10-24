// Speech output orchestration: prefer the backend's AI voice (POST /speech), fall back to the browser's
// speechSynthesis. Dependencies are injected so the rules are testable without a browser.

export type SpeakResult = "completed" | "interrupted" | "blocked" | "unsupported";
export type VoiceSource = "ai" | "browser";
export type PlayResult = SpeakResult | "failed";

export interface Player {
  /** Plays one clip. Resolves "interrupted" if stop() is called first. */
  play(audio: Blob): Promise<PlayResult>;
  stop(): void;
}

export interface VoiceDeps {
  /** MP3 audio for `text`, or null when the service is unavailable. Must honour `signal`. */
  fetchAudio(text: string, signal: AbortSignal): Promise<Blob | null>;
  player: Player;
  /** Speaks with the browser voice. `isCurrent` turns false when something newer has started. */
  speakBrowser(text: string, isCurrent: () => boolean): Promise<SpeakResult>;
  cancelBrowser(): void;
  now(): number;
}

/** After an AI-voice failure, skip it for a while so every reply isn't delayed by a dead service. */
export const AI_RETRY_AFTER_MS = 60_000;

export function createVoiceOutput(deps: VoiceDeps) {
  let generation = 0;
  let abort: AbortController | null = null;
  let source: VoiceSource = "ai";
  let aiRetryAt = 0;
  const listeners = new Set<() => void>();

  const setSource = (next: VoiceSource) => {
    if (source === next) return;
    source = next;
    listeners.forEach((l) => l());
  };

  function stopAll() {
    abort?.abort();
    abort = null;
    deps.player.stop();
    deps.cancelBrowser();
  }

  async function speak(text: string): Promise<SpeakResult> {
    const mine = ++generation;
    const isCurrent = () => mine === generation;
    stopAll(); // only one voice is ever active: new speech replaces whatever was playing

    if (deps.now() >= aiRetryAt) {
      const controller = new AbortController();
      abort = controller;
      let audio: Blob | null = null;
      try {
        audio = await deps.fetchAudio(text, controller.signal);
      } catch {
        audio = null;
      }
      if (abort === controller) abort = null;
      if (!isCurrent()) return "interrupted";
      if (audio) {
        const result = await deps.player.play(audio);
        if (!isCurrent()) return "interrupted";
        if (result !== "failed") {
          setSource("ai");
          return result;
        }
      }
      aiRetryAt = deps.now() + AI_RETRY_AFTER_MS;
    }

    setSource("browser");
    return deps.speakBrowser(text, isCurrent);
  }

  function cancel() {
    generation++;
    stopAll();
  }

  return {
    speak,
    cancel,
    getSource: () => source,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
