// Wake-word gating for hands-free mode. Browser recognition is always-on text, so "Anchor" is matched in text.

const WAKE = /^\s*(?:(?:hey|hi|hello|ok|okay)[,\s]+)?(?:anchors?|anker)\b[\s,.:;!?-]*/i;

export interface GateResult {
  accepted: boolean;
  /** The request with any wake word removed. Empty when the person only said "Anchor". */
  text: string;
  wake: boolean;
}

export function gateTranscript(raw: string, sessionOpen: boolean): GateResult {
  const wake = WAKE.exec(raw);
  if (wake) return { accepted: true, text: raw.slice(wake[0].length).trim(), wake: true };
  const text = raw.trim();
  if (sessionOpen && text) return { accepted: true, text, wake: false };
  return { accepted: false, text: "", wake: false };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** True when a transcript is just Anchor's own spoken words being picked up by the microphone. */
export function isEcho(transcript: string, spoken: string): boolean {
  const heard = normalize(transcript);
  if (heard.length < 6) return false;
  return normalize(spoken).includes(heard);
}
