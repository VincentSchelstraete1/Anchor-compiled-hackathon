"use client";

import { useEffect, useRef } from "react";
import type { Event, Person } from "@/lib/api/types";
import { getDueReminders } from "./companion-api";
import { createReminderQueue, isQuietHour, parseQuietHours } from "./logic/reminders";

const POLL_MS = 30_000;
const DRAIN_MS = 2_000;
export const QUIET_HOURS_KEY = "anchor.quiet_hours";

interface Props {
  people: Person[];
  /** True only when Anchor is idle, no conversation is open, and nothing else is being announced. */
  isReady: () => boolean;
  canSpeak: boolean;
  /** Shows the reminder card; speaks it only when `speakIt` is true. */
  present: (event: Event, person: Person | null, speakIt: boolean) => Promise<void>;
}

function configuredQuietHours() {
  try {
    return parseQuietHours(window.localStorage.getItem(QUIET_HOURS_KEY));
  } catch {
    return null;
  }
}

/**
 * Headless. Polls due reminders into a queue (each reminder once per session) and presents them one at a time
 * when Anchor is idle. During configured quiet hours the card is shown without speech.
 */
export function ReminderManager({ people, isReady, canSpeak, present }: Props) {
  const latest = useRef({ people, isReady, canSpeak, present });
  useEffect(() => {
    latest.current = { people, isReady, canSpeak, present };
  });
  const queue = useRef(createReminderQueue());
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        queue.current.offer(await getDueReminders(new Date()));
      } catch {
        // Backend briefly unavailable; the next poll retries.
      }
    };

    const drain = async () => {
      const { isReady: ready, people: all, canSpeak: speech, present: show } = latest.current;
      if (cancelled || busy.current || !queue.current.hasPending() || !ready()) return;
      const event = queue.current.take();
      if (!event) return;
      busy.current = true;
      try {
        const person = all.find((p) => p.id === event.person_id) ?? null;
        await show(event, person, speech && !isQuietHour(new Date(), configuredQuietHours()));
      } finally {
        busy.current = false;
      }
    };

    const first = setTimeout(poll, 0);
    const pollTimer = setInterval(poll, POLL_MS);
    const drainTimer = setInterval(drain, DRAIN_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(pollTimer);
      clearInterval(drainTimer);
    };
  }, []);

  return null;
}
