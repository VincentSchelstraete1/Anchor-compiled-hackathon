"use client";

import { CalendarClock, Users } from "lucide-react";
import type { Memory } from "@/lib/api/types";
import { SERIF } from "./AmbientDisplay";
import { PersonAvatar } from "./PersonAvatar";
import { formatTime, type DayItem } from "./logic/briefing";

const TAG: Record<DayItem["kind"], string> = { visit: "Visit", appointment: "Appointment", routine: "Routine" };

/** Today's caregiver-entered schedule. Reads only from records; nothing here is generated. */
export function DayAgenda({ mode, items, routines }: { mode: "briefing" | "visitors"; items: DayItem[]; routines: Memory[] }) {
  const Icon = mode === "visitors" ? Users : CalendarClock;
  return (
    <section aria-label={mode === "visitors" ? "Visitors today" : "Today"} className="rounded-3xl border border-[var(--a-border)] bg-[var(--a-card)] p-5" data-testid="day-agenda">
      <h3 className="flex items-center gap-3 text-xl font-semibold uppercase tracking-wider text-[var(--a-terra)]">
        <Icon aria-hidden="true" className="size-6" />
        {mode === "visitors" ? "Visitors today" : "Today"}
      </h3>
      {items.length === 0 ? (
        <p className="mt-3 text-2xl text-[var(--a-muted)]">{mode === "visitors" ? "No visitors are scheduled for today." : "Nothing else is planned for today."}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.slice(0, 4).map((item, index) => (
            <li key={item.event.id} className="flex items-center gap-4">
              {item.person ? <PersonAvatar person={item.person} className="size-14" /> : <span className="size-14 shrink-0" aria-hidden="true" />}
              <p className={`${SERIF} w-28 shrink-0 whitespace-nowrap text-[clamp(1.5rem,3.6vh,2rem)] font-medium tabular-nums text-[var(--a-terra)]`}>
                {formatTime(item.event.start_time)}
              </p>
              <div className="min-w-0">
                <p className="truncate text-[clamp(1.25rem,3vh,1.625rem)] font-semibold leading-tight">{item.event.title}</p>
                <p className="text-xl text-[var(--a-muted)]">
                  {index === 0 ? "Next · " : ""}
                  {item.person ? `${item.person.name}, ${item.person.relationship.toLowerCase()}` : TAG[item.kind]}
                </p>
              </div>
            </li>
          ))}
          {items.length > 4 ? <li className="text-xl text-[var(--a-muted)]">and {items.length - 4} more later today</li> : null}
        </ul>
      )}
      {mode === "briefing" && routines.length > 0 ? (
        <p className="mt-3 border-t border-[var(--a-border)] pt-3 text-xl text-[var(--a-muted)]">
          Familiar routines: {routines.slice(0, 2).map((m) => m.title).join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
