// Classifies SpeechRecognition error codes. Pure so it can be unit tested without a browser.

export type FailureKind =
  | "blocked"
  | "no_microphone"
  | "offline"
  | "service_unreachable"
  | "insecure_context"
  | "language"
  | "no_speech"
  | "aborted"
  | "unknown";

export interface RecognitionEnvironment {
  online: boolean;
  secure: boolean;
}

export interface RecognitionFailure {
  kind: FailureKind;
  message: string;
  /** Voice input cannot continue until the person fixes something. */
  fatal: boolean;
  /** Worth silently trying again (counted by the caller so it cannot loop forever). */
  retryable: boolean;
}

export function classifyRecognitionError(code: string, env: RecognitionEnvironment): RecognitionFailure {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      if (!env.secure) {
        return {
          kind: "insecure_context",
          fatal: true,
          retryable: false,
          message: "Voice input only works on a secure page (https or localhost). You can type below.",
        };
      }
      return {
        kind: "blocked",
        fatal: true,
        retryable: false,
        message: "The browser blocked the microphone or speech recognition. Allow it in the site settings, then turn voice on again. You can type below.",
      };
    case "audio-capture":
      return { kind: "no_microphone", fatal: true, retryable: false, message: "No microphone was found. You can type below." };
    case "network":
      if (!env.online) {
        return {
          kind: "offline",
          fatal: false,
          retryable: true,
          message: "This device looks offline, so voice input is paused. It will resume when the connection returns.",
        };
      }
      // The network is up, so the recognition service itself is unreachable. Chrome streams audio to a
      // remote speech service; Chromium builds, Brave, privacy settings or network filters can block it.
      return {
        kind: "service_unreachable",
        fatal: false,
        retryable: true,
        message: "This browser's speech service can't be reached, although the internet seems to be working. Chrome or Edge usually work. You can type below.",
      };
    case "language-not-supported":
      return { kind: "language", fatal: true, retryable: false, message: "This browser can't recognise speech in your language. You can type below." };
    case "no-speech":
      return { kind: "no_speech", fatal: false, retryable: true, message: "I didn't hear anything." };
    case "aborted":
      return { kind: "aborted", fatal: false, retryable: false, message: "" };
    default:
      return { kind: "unknown", fatal: false, retryable: true, message: "Voice input stopped unexpectedly. You can type below." };
  }
}
