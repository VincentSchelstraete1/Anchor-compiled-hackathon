"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationContext, Person } from "@/lib/api/types";
import { createHandoff, getContext, sendChat } from "./companion-api";
import { demoContext } from "./demo-data";
import { AmbientClock } from "./AmbientClock";
import { PersonSpotlight } from "./PersonSpotlight";
import { ReminderAnnouncer } from "./ReminderAnnouncer";
import { SpeechCaption, type Caption } from "./SpeechCaption";
import { UpcomingCard } from "./UpcomingCard";
import { VoiceController } from "./VoiceController";
import type { Phase } from "./VoiceOrb";
import { cancelSpeech, speak, synthesisSupported } from "./speech";

const CONTEXT_REFRESH_MS = 60000;
const CAPTION_LINGER_MS = 60000;
const AFFIRMATIVE = /^(yes|yeah|yep|yup|please|sure|ok|okay|go ahead|do that|that would be nice)\b/i;
const FAILURE_LINE = "I'm having trouble reaching my notes right now. Please try again in a moment.";

interface HandoffOffer {
  caregiver: Person;
  question: string;
}

function isConsent(text: string): boolean {
  return text.split(/\s+/).length <= 6 && AFFIRMATIVE.test(text.trim());
}

/** Picks the person Anchor offered to ask, using only the names in its own reply. */
function findOfferedCaregiver(reply: string, people: Person[]): Person | null {
  const lower = reply.toLowerCase();
  return people.find((p) => lower.includes(p.name.toLowerCase())) ?? null;
}

export function CompanionScreen() {
  const [context, setContext] = useState<ConversationContext | null>(null);
  const [offline, setOffline] = useState(false);
  const [phase, setPhaseState] = useState<Phase>("ready");
  const [caption, setCaption] = useState<Caption | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceUnlocked, setVoiceUnlocked] = useState(false);

  const phaseRef = useRef<Phase>("ready");
  const turn = useRef(0);
  const speechId = useRef(0);
  const offer = useRef<HandoffOffer | null>(null);
  const peopleRef = useRef<Person[]>([]);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await getContext();
      setContext(next);
      peopleRef.current = next.people;
      setOffline(false);
    } catch {
      setContext((current) => {
        if (current) return current;
        const demo = demoContext(new Date());
        peopleRef.current = demo.people;
        return demo;
      });
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, CONTEXT_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  // Browsers only allow speech after a user gesture.
  useEffect(() => {
    const unlock = () => setVoiceUnlocked(true);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Captions fade away after a quiet minute so the frame stays calm.
  useEffect(() => {
    if (phase !== "ready" || !caption) return;
    const id = setTimeout(() => setCaption(null), CAPTION_LINGER_MS);
    return () => clearTimeout(id);
  }, [phase, caption]);

  const say = useCallback(
    async (text: string): Promise<boolean> => {
      const id = ++speechId.current;
      setCaption({ speaker: "anchor", text });
      setPhase("speaking");
      const finished = await speak(text);
      if (id === speechId.current && phaseRef.current === "speaking") setPhase("ready");
      return finished;
    },
    [setPhase],
  );

  const handleUtterance = useCallback(
    async (text: string) => {
      const id = ++turn.current;
      speechId.current++;
      cancelSpeech();
      setCaption({ speaker: "you", text });
      setPhase("thinking");
      try {
        const pending = offer.current;
        offer.current = null;
        if (pending && isConsent(text)) {
          // Explicit spoken consent in this turn; the backend still requires consent_confirmed: true.
          await createHandoff(pending.caregiver.id, pending.question);
          if (id !== turn.current) return;
          void refresh();
          await say(`Okay, I've asked ${pending.caregiver.name}. I'll tell you as soon as there's a reply.`);
          return;
        }
        const response = await sendChat(text);
        if (id !== turn.current) return;
        if (response.handoff_offered) {
          const caregiver = findOfferedCaregiver(response.message.content, peopleRef.current);
          if (caregiver) offer.current = { caregiver, question: text };
        }
        await say(response.message.content);
      } catch {
        if (id === turn.current) await say(FAILURE_LINE);
      }
    },
    [refresh, say, setPhase],
  );

  const people = context?.people ?? [];
  const idle = phase === "ready";
  const canSpeak = voiceUnlocked && synthesisSupported();

  return (
    <main className="grid min-h-dvh gap-8 p-6 lg:grid-cols-[1.15fr_1fr] lg:p-10">
      <PersonSpotlight people={people} />
      <div className="flex flex-col justify-between gap-8">
        <AmbientClock />
        <UpcomingCard events={context?.upcoming_events ?? []} people={people} />
        <SpeechCaption caption={caption} notice={notice} />
        <VoiceController
          phase={phase}
          onListenStart={() => {
            turn.current++;
            speechId.current++;
            cancelSpeech();
            setPhase("listening");
          }}
          onListenEnd={() => {
            if (phaseRef.current === "listening") setPhase("ready");
          }}
          onInterim={(text) => setCaption({ speaker: "you", text })}
          onUtterance={(text) => void handleUtterance(text)}
          onNotice={setNotice}
        />
        {offline ? <p className="text-lg text-muted-foreground">Showing sample content while Anchor&apos;s notes are unavailable.</p> : null}
        {!voiceUnlocked ? <p className="text-lg text-muted-foreground">Press any key or tap once to turn on spoken reminders.</p> : null}
      </div>
      <ReminderAnnouncer people={people} idle={idle} canSpeak={canSpeak} announce={say} onDelivered={() => void refresh()} />
    </main>
  );
}
