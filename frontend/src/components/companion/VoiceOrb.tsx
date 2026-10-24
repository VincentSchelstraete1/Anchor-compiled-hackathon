import { AudioLines, Brain, Mic, MicOff } from "lucide-react";

export type OrbPhase = "idle" | "listening" | "processing" | "speaking";

const ACTION: Record<OrbPhase, string> = {
  idle: "Talk to Anchor",
  listening: "Stop listening",
  processing: "Anchor is thinking",
  speaking: "Interrupt and talk",
};

/** The single obvious microphone control. Rings pulse while listening; bars move while speaking. */
export function VoiceOrb({ phase, unavailable, onPress }: { phase: OrbPhase; unavailable?: boolean; onPress: () => void }) {
  const Icon = unavailable ? MicOff : phase === "processing" ? Brain : phase === "speaking" ? AudioLines : Mic;
  return (
    <div className="relative size-32 shrink-0">
      {phase === "listening" ? (
        <>
          <span aria-hidden="true" className="anchor-ring absolute inset-0 rounded-full bg-[var(--a-sage)] opacity-40" />
          <span aria-hidden="true" className="anchor-ring anchor-ring-2 absolute inset-0 rounded-full bg-[var(--a-sage)] opacity-40" />
        </>
      ) : null}
      <button
        type="button"
        onClick={onPress}
        disabled={phase === "processing"}
        aria-label={ACTION[phase]}
        className={`relative flex size-full items-center justify-center rounded-full text-[var(--a-on-accent)] shadow-md outline-offset-4 transition-colors focus-visible:outline-4 focus-visible:outline-[var(--a-sage)] disabled:opacity-80 ${
          phase === "speaking" ? "bg-[var(--a-terra)]" : "bg-[var(--a-sage)]"
        }`}
      >
        {phase === "speaking" ? (
          <span aria-hidden="true" className="flex h-14 items-center gap-1.5">
            {[0, 0.2, 0.4, 0.1, 0.3].map((delay, i) => (
              <span key={i} className="anchor-bar h-full w-2 rounded-full bg-current" style={{ animationDelay: `${delay}s` }} />
            ))}
          </span>
        ) : (
          <Icon aria-hidden="true" className="size-14" />
        )}
      </button>
    </div>
  );
}
