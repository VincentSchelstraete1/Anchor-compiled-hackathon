// Thin wrappers over the browser Speech APIs. Nothing here logs spoken or heard text.

interface RecognitionAlternative { transcript: string }
interface RecognitionResult { readonly length: number; isFinal: boolean; [index: number]: RecognitionAlternative }
export interface RecognitionEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: RecognitionResult };
}
export interface RecognitionErrorEvent { error: string }

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  /** Chrome 139+: keep audio on the device instead of a remote service. */
  processLocally?: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionCtor {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
}

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when on-device recognition is already installed, so no audio has to leave the machine. */
export async function onDeviceRecognitionAvailable(lang: string): Promise<boolean> {
  const Ctor = getRecognitionCtor();
  if (!Ctor?.available) return false;
  try {
    return (await Ctor.available({ langs: [lang], processLocally: true })) === "available";
  } catch {
    return false;
  }
}

export function synthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export type SpeakResult = "completed" | "interrupted" | "blocked" | "unsupported";

// Chrome can garbage-collect an utterance mid-speech and never fire `end`; keep a reference.
const live = new Set<SpeechSynthesisUtterance>();
let generation = 0;

export function cancelSpeech(): void {
  generation++;
  if (synthesisSupported()) window.speechSynthesis.cancel();
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0].toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const preferred = matching.find((v) => /natural|premium|enhanced|samantha|google/i.test(v.name));
  return preferred ?? matching.find((v) => v.localService) ?? matching[0] ?? null;
}

/** Splits into sentences: long utterances are cut off by some browsers, and sentence gaps sound natural. */
function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

/** Speaks `text`, replacing anything already being said (speech never overlaps). */
export async function speak(text: string): Promise<SpeakResult> {
  if (!synthesisSupported()) return "unsupported";
  const synth = window.speechSynthesis;
  const mine = ++generation;
  synth.cancel();
  const lang = navigator.language || "en-US";
  const voice = pickVoice(lang);
  for (const part of sentences(text)) {
    const result = await new Promise<"ok" | "interrupted" | "blocked">((resolve) => {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = lang;
      if (voice) utterance.voice = voice;
      utterance.rate = 0.92;
      utterance.onend = () => {
        live.delete(utterance);
        resolve("ok");
      };
      utterance.onerror = (e) => {
        live.delete(utterance);
        resolve(e.error === "not-allowed" ? "blocked" : "interrupted");
      };
      live.add(utterance);
      synth.speak(utterance);
    });
    if (result === "blocked") return "blocked";
    if (result === "interrupted" || mine !== generation) return "interrupted";
  }
  return "completed";
}
