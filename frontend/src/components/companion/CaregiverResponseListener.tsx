"use client";

import { useEffect, useRef } from "react";
import type { Handoff, Person } from "@/lib/api/types";
import { getAnsweredHandoffs, markHandoffDelivered } from "./companion-api";
import { createDeliveryTracker } from "./logic/delivery-tracker";

const POLL_MS = 10_000;

interface Props {
  people: Person[];
  isReady: () => boolean;
  canSpeak: boolean;
  /** Shows and speaks the reply; resolves true only if speech ran to completion. */
  announce: (handoff: Handoff, caregiver: Person | null) => Promise<boolean>;
  onDelivered: () => void;
}

/**
 * Headless. Polls answered handoffs. A reply is read aloud, and only after speech completes is it marked
 * delivered. Interrupted speech is retried (bounded); a failed delivery request retries without re-reading.
 */
export function CaregiverResponseListener({ people, isReady, canSpeak, announce, onDelivered }: Props) {
  const latest = useRef({ people, isReady, canSpeak, announce, onDelivered });
  useEffect(() => {
    latest.current = { people, isReady, canSpeak, announce, onDelivered };
  });
  const tracker = useRef(createDeliveryTracker());
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const first = latest.current;
      if (cancelled || busy.current || !first.canSpeak || !first.isReady()) return;
      busy.current = true;
      try {
        const answered = await getAnsweredHandoffs();
        for (const handoff of answered) {
          const { people: all, isReady: ready, announce: say, onDelivered: done } = latest.current;
          if (cancelled || !handoff.response) continue;
          let plan = tracker.current.plan(handoff.id);
          if (plan === "skip") continue;
          if (plan === "speak") {
            if (!ready()) return;
            tracker.current.beginSpeak(handoff.id);
            const completed = await say(handoff, all.find((p) => p.id === handoff.caregiver_person_id) ?? null);
            tracker.current.spoke(handoff.id, completed);
            plan = tracker.current.plan(handoff.id);
          }
          if (plan === "deliver") {
            await markHandoffDelivered(handoff.id);
            tracker.current.delivered(handoff.id);
            done();
          }
          return; // one reply per poll keeps announcements calm
        }
      } catch {
        // Retry on the next poll; the reply stays "answered" on the server until delivery succeeds.
      } finally {
        busy.current = false;
      }
    };

    const first = setTimeout(poll, 0);
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return null;
}
