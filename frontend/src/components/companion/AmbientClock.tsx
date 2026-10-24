"use client";

import { SERIF } from "./AmbientDisplay";
import { useNow } from "./useNow";

export function AmbientClock({ line }: { line: string }) {
  const now = useNow();
  return (
    <section aria-label="Current time and date" className="[container-type:inline-size]">
      <p className={`${SERIF} anchor-clock font-medium tracking-tight tabular-nums`}>
        {now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--:--"}
      </p>
      <p className="mt-1 text-[clamp(1.375rem,3.2vh,1.875rem)] text-[var(--a-muted)]">
        {now ? now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : " "}
      </p>
      <p aria-live="off" className={`${SERIF} mt-2 min-h-[1.75em] text-[clamp(1.5rem,3.6vh,2.25rem)] leading-tight text-[var(--a-sage)]`}>
        {line || " "}
      </p>
    </section>
  );
}
