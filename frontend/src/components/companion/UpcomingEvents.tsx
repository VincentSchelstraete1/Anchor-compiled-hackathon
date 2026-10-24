"use client";

import { CalendarClock } from "lucide-react";
import type { Event, Person } from "@/lib/api/types";
import { SERIF } from "./AmbientDisplay";
import { nextUpcoming } from "./logic/home-context";
import { useNow } from "./useNow";

export function dayLabel(start: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOfDay(start) - startOfDay(now)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return start.toLocaleDateString([], { weekday: "long" });
}

export function EventCard({ event, person, now }: { event: Event; person: Person | null; now: Date | null }) {
  const start = new Date(event.start_time);
  return (
    <div className="flex items-center gap-6">
      <div className="text-center">
        <p className={`${SERIF} text-5xl font-medium tabular-nums text-[var(--a-terra)]`}>
          {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
        <p className="text-xl text-[var(--a-muted)]">{now ? dayLabel(start, now) : ""}</p>
      </div>
      <div className="min-w-0 border-l-2 border-[var(--a-border)] pl-6">
        <p className="text-3xl font-semibold leading-tight">{event.title}</p>
        <p className="text-2xl text-[var(--a-muted)]">{person ? `with ${person.name}` : "Scheduled"}</p>
      </div>
    </div>
  );
}

export function UpcomingEvents({ events, people }: { events: Event[]; people: Person[] }) {
  const now = useNow();
  const next = now ? nextUpcoming(events, now) : null;
  return (
    <section aria-label="Coming up" className="rounded-3xl border border-[var(--a-border)] bg-[var(--a-card)] p-7">
      <h3 className="flex items-center gap-3 text-xl font-semibold uppercase tracking-wider text-[var(--a-terra)]">
        <CalendarClock aria-hidden="true" className="size-6" />
        Coming up
      </h3>
      <div className="mt-4">
        {next ? (
          <EventCard event={next} person={people.find((p) => p.id === next.person_id) ?? null} now={now} />
        ) : (
          <p className="text-2xl text-[var(--a-muted)]">Nothing is planned right now.</p>
        )}
      </div>
    </section>
  );
}
