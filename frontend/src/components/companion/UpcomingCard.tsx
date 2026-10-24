"use client";

import { CalendarClock } from "lucide-react";
import type { Event, Person } from "@/lib/api/types";
import { useNow } from "./useNow";

function dayLabel(start: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOfDay(start) - startOfDay(now)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return start.toLocaleDateString([], { weekday: "long" });
}

export function UpcomingCard({ events, people }: { events: Event[]; people: Person[] }) {
  const now = useNow();
  const upcoming = now
    ? events
        .filter((e) => e.status === "scheduled" && new Date(e.start_time).getTime() >= now.getTime() - 15 * 60000)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .slice(0, 2)
    : [];

  return (
    <section aria-label="Coming up" className="rounded-3xl border bg-card p-6 shadow-sm">
      <h2 className="flex items-center gap-3 text-2xl font-semibold text-primary">
        <CalendarClock aria-hidden="true" className="size-7" />
        Coming up
      </h2>
      {upcoming.length === 0 ? (
        <p className="mt-3 text-2xl text-muted-foreground">Nothing is planned right now.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {upcoming.map((event) => {
            const start = new Date(event.start_time);
            const person = people.find((p) => p.id === event.person_id);
            return (
              <li key={event.id}>
                <p className="text-3xl font-semibold">{event.title}</p>
                <p className="text-2xl text-muted-foreground">
                  {now ? dayLabel(start, now) : ""} at {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {person ? ` · with ${person.name}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
