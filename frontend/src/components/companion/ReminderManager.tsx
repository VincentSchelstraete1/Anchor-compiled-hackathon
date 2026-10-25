"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Event, Person } from "@/lib/api/types";
import { getCheckIns, getDueReminders } from "./companion-api";
import type { AckStore } from "./logic/ack-store";
import { DEFAULT_CHECKIN } from "./logic/briefing";
import { checkInKey, dueCheckIn, parseCheckIns, type CheckIn } from "./logic/checkins";
import { createReminderQueue, isQuietHour, parseQuietHours, reminderKey } from "./logic/reminders";

const POLL_MS = 30_000;
const CHECKIN_POLL_MS = 10 * 60_000;
const DRAIN_MS = 2_000;
export const QUIET_HOURS_KEY = "anchor.quiet_hours";
export const LOCAL_CHECKINS_KEY = "anchor.checkins";

export type ProactiveItem =
  | { kind: "event"; key: string; event: Event; person: Person | null; demo?: boolean }
  | { kind: "checkin"; key: string; message: string; demo?: boolean };

/** speak: say it now. quiet: quiet hours, card only. locked: browser needs a gesture first. spoken: already announced earlier. */
export type PresentMode = "speak" | "quiet" | "locked" | "spoken";

export interface ReminderHandle {
  /** Demo/testing: presents immediately through the real pipeline, ignoring acknowledgements and the idle check. */
  injectEvent(event: Event): void;
  injectCheckIn(message: string): void;
}

interface Props {
  people: Person[];
  /** True only when Anchor is idle, no conversation is open, and nothing else is being announced. */
  isReady: () => boolean;
  canSpeak: boolean;
  acks: AckStore;
  present: (item: ProactiveItem, mode: PresentMode) => Promise<void>;
  handle?: Ref<ReminderHandle>;
}

function configuredQuietHours() {
  try {
    return parseQuietHours(window.localStorage.getItem(QUIET_HOURS_KEY));
  } catch {
    return null;
  }
}

function localCheckIns(): CheckIn[] {
  try {
    return parseCheckIns(JSON.parse(window.localStorage.getItem(LOCAL_CHECKINS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/**
 * Headless. Polls due reminders and daily check-ins and presents them one at a time when Anchor is idle.
 * Acknowledged reminders are never presented again; reminders already spoken are shown without repeating speech.
 */
export function ReminderManager({ people, isReady, canSpeak, acks, present, handle }: Props) {
  const latest = useRef({ people, isReady, canSpeak, present });
  useEffect(() => {
    latest.current = { people, isReady, canSpeak, present };
  });
  const queue = useRef(createReminderQueue());
  const checkIns = useRef<CheckIn[]>([]);
  const checkInsSupported = useRef(true);
  const pendingCheckIn = useRef<ProactiveItem | null>(null);
  const busy = useRef(false);

  const modeFor = useCallback(
    (key: string): PresentMode => {
      if (acks.wasSpoken(key)) return "spoken";
      if (isQuietHour(new Date(), configuredQuietHours())) return "quiet";
      return latest.current.canSpeak ? "speak" : "locked";
    },
    [acks],
  );

  const run = useCallback(async (item: ProactiveItem, mode: PresentMode) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await latest.current.present(item, mode);
    } finally {
      busy.current = false;
    }
  }, []);

  useImperativeHandle(handle, () => ({
    injectEvent(event) {
      const person = latest.current.people.find((p) => p.id === event.person_id) ?? null;
      const key = `demo:${reminderKey(event)}:${Date.now()}`;
      busy.current = false;
      const { canSpeak: speech } = latest.current;
      void run({ kind: "event", key, event, person, demo: true }, speech ? "speak" : "locked");
    },
    injectCheckIn(message) {
      busy.current = false;
      const { canSpeak: speech } = latest.current;
      void run({ kind: "checkin", key: `demo:checkin:${Date.now()}`, message, demo: true }, speech ? "speak" : "locked");
    },
  }));

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const due = await getDueReminders(new Date());
        queue.current.offer(due.filter((e) => !acks.isAcknowledged(reminderKey(e))));
      } catch {
        // Backend briefly unavailable; the next poll retries.
      }
      const now = new Date();
      if (!pendingCheckIn.current) {
        const found = dueCheckIn([...checkIns.current, ...localCheckIns()], now, (k) => acks.isAcknowledged(k) || acks.wasSpoken(k));
        if (found) {
          pendingCheckIn.current = { kind: "checkin", key: checkInKey(found, now), message: found.message ?? DEFAULT_CHECKIN };
        }
      }
    };

    const loadCheckIns = async () => {
      if (!checkInsSupported.current) return;
      const data = await getCheckIns();
      if (data === null) checkInsSupported.current = false;
      else checkIns.current = parseCheckIns(data);
    };

    const drain = async () => {
      const { isReady: ready, people: all } = latest.current;
      if (cancelled || busy.current || !ready()) return;
      const checkIn = pendingCheckIn.current;
      if (checkIn) {
        pendingCheckIn.current = null;
        if (!acks.isAcknowledged(checkIn.key)) await run(checkIn, modeFor(checkIn.key));
        return;
      }
      if (!queue.current.hasPending()) return;
      const event = queue.current.take();
      if (!event) return;
      const key = reminderKey(event);
      if (acks.isAcknowledged(key)) return;
      const person = all.find((p) => p.id === event.person_id) ?? null;
      await run({ kind: "event", key, event, person }, modeFor(key));
    };

    const first = setTimeout(() => {
      void loadCheckIns().then(poll);
    }, 0);
    const pollTimer = setInterval(poll, POLL_MS);
    const checkInTimer = setInterval(loadCheckIns, CHECKIN_POLL_MS);
    const drainTimer = setInterval(drain, DRAIN_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(pollTimer);
      clearInterval(checkInTimer);
      clearInterval(drainTimer);
    };
  }, [acks, modeFor, run]);

  return null;
}
