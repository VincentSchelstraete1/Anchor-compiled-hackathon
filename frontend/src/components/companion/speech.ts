// Thin wrappers over the browser Speech APIs. Nothing here logs spoken or heard text.

interface RecognitionAlternative { transcript: string }
interface RecognitionResult { readonly length: number; isFinal: boolean; [index: number]: RecognitionAlternative }
export interface RecognitionEvent { results: { readonly length: number; [index: number]: RecognitionResult } }
export interface RecognitionErrorEvent { error: string }

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function synthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

// Chrome can garbage-collect an utterance mid-speech and never fire `end`; keep a reference.
let current: SpeechSynthesisUtterance | null = null;

export function cancelSpeech(): void {
  if (synthesisSupported()) window.speechSynthesis.cancel();
}

/** Speaks `text`. Resolves true only when playback finished; false if unsupported, blocked, or interrupted. */
export function speak(text: string): Promise<boolean> {
  if (!synthesisSupported()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 0.9;
    utterance.onend = () => {
      if (current === utterance) current = null;
      resolve(true);
    };
    utterance.onerror = () => {
      if (current === utterance) current = null;
      resolve(false);
    };
    current = utterance;
    synth.speak(utterance);
  });
}
