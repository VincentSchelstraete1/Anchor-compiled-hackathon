"use client";

import { useNow } from "./useNow";

function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function AmbientClock() {
  const now = useNow();
  return (
    <section aria-label="Current time and date" className="text-center lg:text-left">
      <p className="text-2xl text-muted-foreground">{now ? greeting(now.getHours()) : " "}</p>
      <p className="text-7xl font-semibold tabular-nums tracking-tight sm:text-8xl xl:text-9xl">
        {now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--:--"}
      </p>
      <p className="mt-2 text-3xl">
        {now ? now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : " "}
      </p>
    </section>
  );
}
