// Consent and caregiver-selection rules for the handoff flow. Matching uses only the *person's own words*;
// names in generated assistant text are never parsed.

export type Consent = "yes" | "no" | "unclear";

const YES = new Set([
  "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "go ahead", "do it", "of course", "please do",
  "sure thing", "that would be nice", "that would be great", "that would be good", "i would like that",
  "yes go ahead", "yes please do", "yes do that", "please ask", "please",
]);
const NO = new Set([
  "no", "nope", "no thanks", "no thank you", "not now", "never mind", "nevermind", "cancel", "dont", "do not",
  "dont ask", "do not ask", "no dont", "no do not", "no need", "forget it", "stop",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(please|thanks|thank you)$/, "")
    .trim();
}

/** Only a whole-utterance match counts, so "okay what time is it" is never read as consent. */
export function classifyConsent(text: string): Consent {
  const t = normalize(text);
  if (NO.has(t)) return "no";
  if (YES.has(t)) return "yes";
  return "unclear";
}

export interface NamedPerson { id: number; name: string }

/** People whose names the person themselves said. */
export function peopleNamedIn(text: string, people: NamedPerson[]): NamedPerson[] {
  const words = new Set(normalize(text).split(" "));
  return people.filter((p) => p.name.toLowerCase().split(/\s+/).some((part) => part.length > 1 && words.has(part.replace(/[^a-z]/g, ""))));
}

export interface HandoffOffer {
  /** The person's original question, to be passed to the caregiver. */
  question: string;
  /** Structured caregiver id from the backend, or null when it was not provided. */
  caregiverId: number | null;
  awaitingWho: boolean;
  expiresAt: number;
}

export type OfferStep =
  | { kind: "create"; caregiverId: number; question: string }
  | { kind: "ask_who" }
  | { kind: "decline" }
  | { kind: "pass" };

export function stepOffer(offer: HandoffOffer, text: string, people: NamedPerson[], now: number): OfferStep {
  if (now > offer.expiresAt) return { kind: "pass" };
  const consent = classifyConsent(text);
  if (consent === "no") return { kind: "decline" };
  if (consent === "yes") {
    return offer.caregiverId !== null
      ? { kind: "create", caregiverId: offer.caregiverId, question: offer.question }
      : { kind: "ask_who" };
  }
  if (offer.caregiverId === null) {
    // "Yes, ask Elena" / "Elena" — accepted only when the person names exactly one known person.
    const stripped = normalize(text).replace(/^(yes |yeah |yep )?(please )?(ask )?/, "");
    const named = peopleNamedIn(text, people);
    if (named.length === 1 && (offer.awaitingWho || /^(yes |yeah |yep )?(please )?ask /.test(normalize(text))) && stripped.split(" ").length <= 3) {
      return { kind: "create", caregiverId: named[0].id, question: offer.question };
    }
  }
  return { kind: "pass" };
}
