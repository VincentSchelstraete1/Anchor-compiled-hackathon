"use client";

import { useEffect, useRef } from "react";
import type { Event, Handoff, Person } from "@/lib/api/types";
import { getAnsweredHandoffs, getDueReminders, markHandoffDelivered } from "./companion-api";

const REMINDER_POLL_MS = 30000;
const HANDOFF_POLL_MS = 10000;

interface Props {
  people: Person[];
  /** True only when Anchor is idle and may speak without interrupting a conversation. */
  idle: boolean;
  /** True once the browser will allow speech (a user gesture has happened). */
  canSpeak: boolean;
  /** Speaks `text`; resolves true if playback finished. */
  announce: (text: string) => Promise<boolean>;
  onDelivered: () => void;
}

function reminderText(event: Event, people: Person[]): string {
  const person = people.find((p) => p.id === event.person_id);
  const time = new Date(event.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const who = person ? ` with ${person.name}, your ${person.relationship.toLowerCase()}` : "";
  return `Reminder: ${event.title}${who} is at ${time}.`;
}

function handoffText(handoff: Handoff, people: Person[]): string {
  const name = people.find((p) => p.id === handoff.caregiver_person_id)?.name ?? "Your caregiver";
  return `I have a reply from ${name}. ${handoff.response ?? ""}`;
}

/** Headless: polls for due reminders and answered caregiver questions and speaks each once per session. */
export function ReminderAnnouncer({ people, idle, canSpeak, announce, onDelivered }: Props) {
  const latest = useRef({ people, idle, canSpeak, announce, onDelivered });
  useEffect(() => {
    latest.current = { people, idle, canSpeak, announce, onDelivered };
  });
  const announced = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const ready = () => !cancelled && !busy.current && latest.current.idle && latest.current.canSpeak;

    const pollReminders = async () => {
      if (!ready()) return;
      try {
        const due = await getDueReminders(new Date());
        const next = due.find((e) => !announced.current.has(`event:${e.id}`));
        if (!next || !ready()) return;
        announced.current.add(`event:${next.id}`);
        busy.current = true;
        await latest.current.announce(reminderText(next, latest.current.people));
      } catch {
        // Backend briefly unavailable; the next poll retries.
      } finally {
        busy.current = false;
      }
    };

    const pollHandoffs = async () => {
      if (!ready()) return;
      try {
        const answered = await getAnsweredHandoffs();
        const next = answered.find((h) => h.response && !announced.current.has(`handoff:${h.id}`));
        if (!next || !ready()) return;
        announced.current.add(`handoff:${next.id}`);
        busy.current = true;
        const finished = await latest.current.announce(handoffText(next, latest.current.people));
        // Only mark delivered once speech actually completed.
        if (finished) {
          await markHandoffDelivered(next.id);
          latest.current.onDelivered();
        }
      } catch {
        // Retry is not attempted for this handoff this session; it stays "answered" on the server.
      } finally {
        busy.current = false;
      }
    };

    void pollHandoffs();
    void pollReminders();
    const handoffTimer = setInterval(pollHandoffs, HANDOFF_POLL_MS);
    const reminderTimer = setInterval(pollReminders, REMINDER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handoffTimer);
      clearInterval(reminderTimer);
    };
  }, []);

  return null;
}
