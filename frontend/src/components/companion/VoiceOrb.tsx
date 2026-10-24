import { AudioLines, Brain, Mic, Square } from "lucide-react";

export type Phase = "ready" | "listening" | "thinking" | "speaking";

const LABELS: Record<Phase, string> = { ready: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

export function VoiceOrb({ phase, onPress, disabled }: { phase: Phase; onPress: () => void; disabled?: boolean }) {
  const Icon = phase === "listening" ? Square : phase === "thinking" ? Brain : phase === "speaking" ? AudioLines : Mic;
  const action = phase === "listening" ? "Stop listening" : phase === "ready" ? "Talk to Anchor" : phase === "speaking" ? "Interrupt and talk" : "Thinking";
  return (
    <div className="flex items-center justify-center gap-6 lg:justify-start">
      <button
        type="button"
        onClick={onPress}
        disabled={disabled || phase === "thinking"}
        aria-label={action}
        className={`relative flex size-28 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md outline-offset-4 focus-visible:outline-4 focus-visible:outline-ring disabled:opacity-70 ${
          phase === "listening" ? "motion-safe:animate-pulse ring-8 ring-primary/30" : ""
        }`}
      >
        <Icon aria-hidden="true" className="size-12" />
      </button>
      <div>
        <p className="text-4xl font-semibold" data-phase={phase}>
          {LABELS[phase]}
        </p>
        <p className="text-lg text-muted-foreground">Hold Space to talk</p>
      </div>
    </div>
  );
}
