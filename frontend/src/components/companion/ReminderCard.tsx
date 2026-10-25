"use client";

import { Bell, Heart, Volume2 } from "lucide-react";
import type { Event, Person } from "@/lib/api/types";
import { SERIF } from "./AmbientDisplay";
import { PersonAvatar } from "./PersonAvatar";
import { classifyEvent, formatTime, minutesPhrase } from "./logic/briefing";

const button =
  "min-h-14 rounded-2xl px-5 text-xl font-semibold outline-offset-4 focus-visible:outline-4 focus-visible:outline-[var(--a-sage)]";

interface Props {
  event: Event | null;
  person: Person | null;
  checkInMessage?: string;
  now: Date | null;
  demo?: boolean;
  canHear: boolean;
  onThanks: () => void;
  onTellMore?: () => void;
  onHear: () => void;
}

/** Prominent proactive card: shows without any click; every action is optional. */
export function ReminderCard({ event, person, checkInMessage, now, demo, canHear, onThanks, onTellMore, onHear }: Props) {
  const isVisit = event && person && classifyEvent(event, person) === "visit";
  return (
    <section aria-label={checkInMessage ? "Daily check-in" : "Reminder"} className="rounded-3xl bg-[var(--a-terra-soft)] p-5" data-testid="reminder-card">
      <h3 className="flex items-center gap-3 text-xl font-semibold uppercase tracking-wider text-[var(--a-terra)]">
        {checkInMessage ? <Heart aria-hidden="true" className="size-6" /> : <Bell aria-hidden="true" className="size-6" />}
        {checkInMessage ? "Daily check-in" : "Reminder"}
        {demo ? <span className="rounded-full border border-[var(--a-terra)] px-3 text-base normal-case">Demo</span> : null}
      </h3>
      {event ? (
        <div className="mt-2 flex items-center gap-4">
          {person ? <PersonAvatar person={person} className="size-16" /> : null}
          <div className="min-w-0">
            {person ? (
              <p className={`${SERIF} line-clamp-1 text-[clamp(1.5rem,3.6vh,2rem)] font-medium leading-tight`}>
                {person.name} <span className="text-[var(--a-muted)]">· {person.relationship}</span>
              </p>
            ) : null}
            <p className="text-[clamp(1.25rem,3vh,1.625rem)] font-semibold leading-tight">{event.title}</p>
            <p className="text-[clamp(1.25rem,3vh,1.625rem)] text-[var(--a-terra)]">
              <span className={`${SERIF} text-[1.4em] tabular-nums`}>{formatTime(event.start_time)}</span>
              {now ? ` · ${minutesPhrase(event.start_time, now)}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <p className={`${SERIF} mt-3 text-[clamp(1.5rem,3.4vh,1.875rem)] leading-snug`}>{checkInMessage}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={onThanks} className={`${button} bg-[var(--a-terra)] text-[var(--a-on-accent)]`}>
          Thank you
        </button>
        {isVisit && onTellMore ? (
          <button type="button" onClick={onTellMore} className={`${button} bg-[var(--a-sage)] text-[var(--a-on-accent)]`}>
            Tell me about {person!.name}
          </button>
        ) : null}
        {!event && onTellMore ? (
          <button type="button" onClick={onTellMore} className={`${button} bg-[var(--a-sage)] text-[var(--a-on-accent)]`}>
            Talk with me
          </button>
        ) : null}
        {canHear ? (
          <button type="button" onClick={onHear} className={`${button} flex items-center gap-2 border-2 border-[var(--a-border)] text-[var(--a-fg)]`}>
            <Volume2 aria-hidden="true" className="size-6" />
            Hear this
          </button>
        ) : null}
      </div>
    </section>
  );
}
