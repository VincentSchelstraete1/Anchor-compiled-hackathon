export interface Caption {
  speaker: "anchor" | "you";
  text: string;
}

export function SpeechCaption({ caption, notice }: { caption: Caption | null; notice: string | null }) {
  return (
    <section aria-label="Captions" className="min-h-40 rounded-3xl bg-secondary p-6 text-secondary-foreground">
      <div role="status" aria-live="polite">
        {caption ? (
          <>
            <p className="text-lg font-semibold uppercase tracking-wide text-muted-foreground">
              {caption.speaker === "anchor" ? "Anchor" : "You said"}
            </p>
            <p className={caption.speaker === "anchor" ? "text-3xl leading-snug" : "text-3xl italic leading-snug"}>{caption.text}</p>
          </>
        ) : (
          <p className="text-2xl text-muted-foreground">Hold the space bar, or press the microphone, and ask me anything.</p>
        )}
      </div>
      {notice ? (
        <p role="alert" className="mt-3 text-xl font-medium text-destructive">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
