"use client";

import { SERIF } from "./AmbientDisplay";
import { useNow } from "./useNow";

export function AmbientClock({ line }: { line: string }) {
  const now = useNow();
  return (
    <section aria-label="Current time and date">
      <p className={`${SERIF} text-[clamp(5rem,13vw,11rem)] font-medium leading-none tracking-tight tabular-nums`}>
        {now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--:--"}
      </p>
      <p className="mt-3 text-3xl text-[var(--a-muted)]">
        {now ? now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : " "}
      </p>
      <p aria-live="off" className={`${SERIF} mt-5 min-h-[2.5rem] text-3xl text-[var(--a-sage)] sm:text-4xl`}>
        {line || " "}
      </p>
    </section>
  );
}
