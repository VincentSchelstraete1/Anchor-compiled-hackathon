import { SERIF } from "./AmbientDisplay";

export interface Caption {
  speaker: "anchor" | "you";
  text: string;
}

/** Captions for everything spoken, plus any microphone notice. Not a chat transcript: only the latest line shows. */
export function SpeechCaption({ caption, notice }: { caption: Caption | null; notice: string | null }) {
  return (
    <section aria-label="Captions" className="min-h-0">
      <div role="status" aria-live="polite">
        {caption ? (
          <p className={`${SERIF} anchor-clamp text-[clamp(1.375rem,3.2vh,1.875rem)] leading-snug ${caption.speaker === "you" ? "italic text-[var(--a-muted)]" : ""}`}>
            {caption.speaker === "you" ? `“${caption.text}”` : caption.text}
          </p>
        ) : null}
      </div>
      {notice ? (
        <p role="alert" className="mt-2 rounded-2xl bg-[var(--a-terra-soft)] p-3 text-xl font-medium text-[var(--a-terra)]">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
