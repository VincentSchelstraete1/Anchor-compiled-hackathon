"use client";

import { Bell, Hourglass, MessageCircleQuestion, Send } from "lucide-react";
import type { Event, Memory, Person } from "@/lib/api/types";
import type { Scene } from "./logic/ambient-state";
import { SERIF } from "./AmbientDisplay";
import { Fade } from "./Fade";
import { MemorySpotlight } from "./MemorySpotlight";
import { EventCard, UpcomingEvents } from "./UpcomingEvents";
import { useNow } from "./useNow";

export interface ConsentView {
  /** Caregiver the backend named, or null when the person must choose. */
  caregiver: Person | null;
  candidates: Person[];
  awaitingWho: boolean;
}

interface Props {
  scene: Scene;
  people: Person[];
  events: Event[];
  homeMemory: Memory | null;
  pendingCaregiver: Person | null;
  consent: ConsentView | null;
  onAskCaregiver: (personId: number) => void;
  onDecline: () => void;
  onAcknowledge: () => void;
}

const card = "rounded-3xl border border-[var(--a-border)] bg-[var(--a-card)] p-5";
const body = "text-[clamp(1.375rem,3.2vh,1.875rem)] leading-snug";
const label = "flex items-center gap-3 text-xl font-semibold uppercase tracking-wider";
const button =
  "min-h-14 rounded-2xl px-5 text-xl font-semibold outline-offset-4 focus-visible:outline-4 focus-visible:outline-[var(--a-sage)]";

export function ConversationContextDisplay(props: Props) {
  const { scene, people, events, homeMemory, pendingCaregiver, consent, onAskCaregiver, onDecline, onAcknowledge } = props;
  const now = useNow();
  const personFor = (id: number | null) => people.find((p) => p.id === id) ?? null;

  let content;
  switch (scene.kind) {
    case "person":
      content = (
        <div className="space-y-3">
          {scene.memory ? <MemorySpotlight memory={scene.memory} person={scene.person} /> : null}
          {scene.event ? (
            <section aria-label="Next visit" className={card}>
              <EventCard event={scene.event} person={scene.person} now={now} />
            </section>
          ) : null}
          {!scene.memory && !scene.event ? <p className="text-2xl text-[var(--a-muted)]">That&apos;s {scene.person.name}.</p> : null}
        </div>
      );
      break;
    case "memory":
      content = <MemorySpotlight memory={scene.memory} person={scene.person} />;
      break;
    case "event":
      content = (
        <section aria-label="Upcoming event" className={card}>
          <h3 className={`${label} text-[var(--a-terra)]`}>Scheduled</h3>
          <div className="mt-3">
            <EventCard event={scene.event} person={scene.person} now={now} />
          </div>
          <p className="mt-3 text-xl text-[var(--a-muted)]">This is the plan on the calendar. I can&apos;t tell whether anyone is on their way.</p>
        </section>
      );
      break;
    case "reminder":
      content = (
        <section aria-label="Reminder" className="rounded-3xl bg-[var(--a-terra-soft)] p-5">
          <div className="flex items-center justify-between gap-4">
            <h3 className={`${label} text-[var(--a-terra)]`}>
              <Bell aria-hidden="true" className="size-6" />
              Reminder
            </h3>
            <button type="button" onClick={onAcknowledge} className={`${button} bg-[var(--a-terra)] text-[var(--a-on-accent)]`}>
              Got it
            </button>
          </div>
          <div className="mt-3">
            <EventCard event={scene.event} person={scene.person} now={now} />
          </div>
        </section>
      );
      break;
    case "uncertain":
      content = (
        <section aria-label="Ask a caregiver" className={`${card} border-[var(--a-terra)]`}>
          <h3 className={`${label} text-[var(--a-terra)]`}>
            <MessageCircleQuestion aria-hidden="true" className="size-6" />
            I&apos;m not sure
          </h3>
          {consent ? (
            <>
              <p className={`${SERIF} mt-2 ${body}`}>
                {consent.caregiver
                  ? `Would you like me to ask ${consent.caregiver.name}?`
                  : consent.awaitingWho
                    ? "Who would you like me to ask?"
                    : "I can ask someone for you. Who should I ask?"}
              </p>
              <p className="mt-1 text-xl text-[var(--a-muted)]">Nothing is sent unless you say yes or press a button.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {consent.caregiver ? (
                  <button type="button" onClick={() => onAskCaregiver(consent.caregiver!.id)} className={`${button} bg-[var(--a-sage)] text-[var(--a-on-accent)]`}>
                    Yes, ask {consent.caregiver.name}
                  </button>
                ) : (
                  consent.candidates.map((p) => (
                    <button key={p.id} type="button" onClick={() => onAskCaregiver(p.id)} className={`${button} bg-[var(--a-sage)] text-[var(--a-on-accent)]`}>
                      Ask {p.name}
                    </button>
                  ))
                )}
                <button type="button" onClick={onDecline} className={`${button} border-2 border-[var(--a-border)] text-[var(--a-fg)]`}>
                  No thanks
                </button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-xl text-[var(--a-muted)]">I don&apos;t have that information. Nothing has been sent to anyone.</p>
          )}
        </section>
      );
      break;
    case "waiting":
      content = (
        <section aria-label="Waiting for a caregiver" className={card}>
          <h3 className={`${label} text-[var(--a-sage)]`}>
            <Send aria-hidden="true" className="size-6" />
            Question sent{scene.caregiver ? ` to ${scene.caregiver.name}` : ""}
          </h3>
          <p className={`${SERIF} mt-2 anchor-clamp ${body}`}>&ldquo;{scene.question}&rdquo;</p>
          <p className="mt-2 flex items-center gap-3 text-xl text-[var(--a-muted)]">
            <Hourglass aria-hidden="true" className="size-6" />
            Waiting for a reply. I&apos;ll tell you as soon as it arrives.
          </p>
        </section>
      );
      break;
    case "reply":
      content = (
        <section aria-label="Reply from a caregiver" className="rounded-3xl bg-[var(--a-sage-soft)] p-5">
          <h3 className={`${label} text-[var(--a-sage)]`}>Reply{scene.caregiver ? ` from ${scene.caregiver.name}` : ""}</h3>
          <p className={`${SERIF} mt-2 anchor-clamp ${body}`}>{scene.handoff.response}</p>
        </section>
      );
      break;
    default:
      content = (
        <div className="space-y-3">
          <UpcomingEvents events={events} people={people} />
          {homeMemory ? <MemorySpotlight optional memory={homeMemory} person={personFor(homeMemory.person_id)} /> : null}
        </div>
      );
  }

  return (
    <Fade id={`${scene.kind}-${scene.stamp}`} className="anchor-panel space-y-3">
      {content}
      {scene.kind === "home" && pendingCaregiver ? (
        <p className="flex items-center gap-3 text-2xl text-[var(--a-muted)]">
          <Hourglass aria-hidden="true" className="size-6" />
          Waiting for {pendingCaregiver.name}&apos;s reply to your question.
        </p>
      ) : null}
    </Fade>
  );
}
