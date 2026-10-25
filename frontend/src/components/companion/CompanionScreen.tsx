"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Event, Handoff, Person } from "@/lib/api/types";
import { AmbientClock } from "./AmbientClock";
import { AmbientDisplay } from "./AmbientDisplay";
import { CaregiverResponseListener } from "./CaregiverResponseListener";
import { ConversationContextDisplay, type ConsentView } from "./ConversationContextDisplay";
import { PersonSpotlight } from "./PersonSpotlight";
import { DemoControls } from "./DemoControls";
import { ReminderManager, type PresentMode, type ProactiveItem, type ReminderHandle } from "./ReminderManager";
import { SpeechCaption, type Caption } from "./SpeechCaption";
import { VoiceController } from "./VoiceController";
import { createHandoff, getContext, sendChat } from "./companion-api";
import { demoContext } from "./demo-data";
import { gateTranscript, isEcho } from "./logic/activation";
import {
  ambientReducer,
  deriveAmbientState,
  initialAmbient,
  sceneLinger,
  type SceneData,
} from "./logic/ambient-state";
import { createAckStore } from "./logic/ack-store";
import {
  briefingSpeech,
  buildDay,
  classifyEvent,
  DEFAULT_CHECKIN,
  isSelf,
  localIntent,
  primaryUser,
  proactiveSpeech,
  refreshScene,
  visitorsSpeech,
  type LocalIntent,
} from "./logic/briefing";
import { stepOffer, type HandoffOffer } from "./logic/consent";
import { homeNarrative, pickHomeMemory, timeOfDay } from "./logic/home-context";
import { isAcknowledgement } from "./logic/reminders";
import { selectScene } from "./logic/scene-selector";
import { cancelSpeech, speak, synthesisSupported, useVoiceSource, type SpeakResult } from "./speech";
import { useNow } from "./useNow";
import { useVoiceInput, type TranscriptSource } from "./useVoiceInput";
import type { ConversationContext } from "@/lib/api/types";

const CONTEXT_REFRESH_MS = 30_000;
const CAPTION_LINGER_MS = 60_000;
const ROTATE_MS = 45_000;
const SESSION_MS = 45_000;
const OFFER_MS = 90_000;
const FAILURE_LINE = "I'm having trouble reaching my notes right now. Please try again in a moment.";

export function CompanionScreen() {
  const now = useNow();
  const voiceSource = useVoiceSource();
  const [context, setContext] = useState<ConversationContext | null>(null);
  const [offline, setOffline] = useState(false);
  const [ambient, dispatch] = useReducer(ambientReducer, initialAmbient);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceUnlocked, setVoiceUnlocked] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [offer, setOfferState] = useState<HandoffOffer | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [hearPending, setHearPending] = useState<{ key: string; text: string } | null>(null);
  const [acks] = useState(() => {
    let storage: Storage | null = null;
    try {
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      storage = null;
    }
    return createAckStore(storage);
  });
  const reminders = useRef<ReminderHandle>(null);

  const contextRef = useRef<ConversationContext | null>(null);
  const ambientRef = useRef(ambient);
  const offerRef = useRef<HandoffOffer | null>(null);
  const turn = useRef(0);
  const speechId = useRef(0);
  const lastSpoken = useRef("");
  const announcing = useRef(false);
  const sessionUntil = useRef(0);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockedRef = useRef(false);
  useEffect(() => {
    ambientRef.current = ambient;
  });

  const setOffer = useCallback((next: HandoffOffer | null) => {
    offerRef.current = next;
    setOfferState(next);
  }, []);

  const refresh = useCallback(async (): Promise<ConversationContext | null> => {
    try {
      const next = await getContext();
      contextRef.current = next;
      setContext(next);
      setOffline(false);
      return next;
    } catch {
      if (!contextRef.current) {
        const demo = demoContext(new Date());
        contextRef.current = demo;
        setContext(demo);
      }
      setOffline(true);
      return null;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, CONTEXT_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Browsers only allow speech after a user gesture.
  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
      setVoiceUnlocked(true);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setRotation((r) => r + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  // Scenes return home a while after Anchor goes quiet; timers are tied to the scene's stamp.
  useEffect(() => {
    if (ambient.voice !== "idle" || ambient.scene.kind === "home") return;
    const stamp = ambient.scene.stamp;
    const id = setTimeout(() => dispatch({ type: "scene_timeout", stamp }), sceneLinger(ambient.scene.kind));
    return () => clearTimeout(id);
  }, [ambient.voice, ambient.scene.kind, ambient.scene.stamp]);

  useEffect(() => {
    if (!offer) return;
    const id = setTimeout(() => setOffer(null), Math.max(0, offer.expiresAt - Date.now()));
    return () => clearTimeout(id);
  }, [offer, setOffer]);

  useEffect(() => {
    if (ambient.voice !== "idle" || !caption) return;
    const id = setTimeout(() => setCaption(null), CAPTION_LINGER_MS);
    return () => clearTimeout(id);
  }, [ambient.voice, caption]);

  const touchSession = useCallback(() => {
    sessionUntil.current = Date.now() + SESSION_MS;
    setSessionOpen(true);
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => setSessionOpen(false), SESSION_MS);
  }, []);
  useEffect(
    () => () => {
      if (sessionTimer.current) clearTimeout(sessionTimer.current);
    },
    [],
  );

  const say = useCallback(async (text: string, scene?: SceneData): Promise<SpeakResult> => {
    const id = ++speechId.current;
    lastSpoken.current = text;
    setCaption({ speaker: "anchor", text });
    if (scene) dispatch({ type: "show", scene });
    dispatch({ type: "speak_start" });
    const result = await speak(text);
    if (id === speechId.current) dispatch({ type: "speak_end" });
    return result;
  }, []);

  const interrupt = useCallback(() => {
    turn.current++;
    speechId.current++;
    cancelSpeech();
    dispatch({ type: "interrupt" });
  }, []);

  const sendHandoff = useCallback(
    async (caregiverId: number, question: string, id: number) => {
      const caregiver = contextRef.current?.people.find((p) => p.id === caregiverId) ?? null;
      try {
        await createHandoff(caregiverId, question);
        if (id !== turn.current) return;
        setOffer(null);
        void refresh();
        await say(`Okay, I'll send ${caregiver?.name ?? "them"} your question.`, { kind: "waiting", caregiver, question });
      } catch {
        if (id !== turn.current) return;
        setOffer({ question, caregiverId, awaitingWho: false, expiresAt: Date.now() + OFFER_MS });
        await say("I couldn't send that just now. Would you like me to try again?");
      }
    },
    [refresh, say, setOffer],
  );

  /** Questions answerable straight from caregiver records. Speech and cards come from the same fresh data. */
  const answerLocal = useCallback(
    async (intent: LocalIntent, id: number) => {
      const fresh = await refresh();
      if (id !== turn.current) return;
      if (!fresh) {
        await say("I can't reach my notes right now, so I can't tell you what is planned. Please try again in a moment.", { kind: "home" });
        return;
      }
      const at = new Date();
      const items = buildDay(fresh.upcoming_events, fresh.people, at, intent);
      const userName = primaryUser(fresh.people)?.name ?? null;
      const text = intent === "visitors" ? visitorsSpeech(items) : briefingSpeech(items, at, userName);
      await say(text, { kind: "day", mode: intent });
    },
    [refresh, say],
  );

  const handleUtterance = useCallback(
    async (text: string) => {
      const id = ++turn.current;
      speechId.current++;
      cancelSpeech();
      setNotice(null);
      setCaption({ speaker: "you", text });
      dispatch({ type: "processing" });
      try {
        const scene = ambientRef.current.scene;
        if ((scene.kind === "reminder" || scene.kind === "checkin") && isAcknowledgement(text)) {
          acks.acknowledge(scene.kind === "reminder" ? scene.reminderKey : scene.checkInKey);
          setHearPending(null);
          dispatch({ type: "scene_timeout", stamp: scene.stamp });
          await say("Okay.");
          return;
        }

        const pending = offerRef.current;
        if (pending) {
          const people = contextRef.current?.people ?? [];
          const step = stepOffer(pending, text, people, Date.now());
          if (step.kind === "create") return await sendHandoff(step.caregiverId, step.question, id);
          if (step.kind === "decline") {
            setOffer(null);
            await say("Okay, I won't ask.", { kind: "home" });
            return;
          }
          if (step.kind === "ask_who") {
            setOffer({ ...pending, awaitingWho: true, expiresAt: Date.now() + OFFER_MS });
            await say("Who would you like me to ask?");
            return;
          }
          setOffer(null); // anything else withdraws the offer: consent never carries over to a new topic
        }

        const local = localIntent(text);
        if (local) return await answerLocal(local, id);

        const response = await sendChat(text);
        if (id !== turn.current) return;
        let ctx = contextRef.current ?? demoContext(new Date());
        let selection = selectScene(response, ctx, text, new Date());
        if (selection.missing) {
          const fresh = await refresh();
          if (fresh) {
            ctx = fresh;
            selection = selectScene(response, ctx, text, new Date());
          }
        }
        if (id !== turn.current) return;
        if (response.handoff_offered) {
          const named = response.handoff_caregiver_person_id;
          const caregiverId = typeof named === "number" && ctx.people.some((p) => p.id === named) ? named : null;
          setOffer({ question: text, caregiverId, awaitingWho: false, expiresAt: Date.now() + OFFER_MS });
        }
        await say(response.message.content, selection.scene);
      } catch {
        if (id === turn.current) {
          setNotice("I couldn't reach my notes. You can try again or type your question.");
          await say(FAILURE_LINE);
        }
      }
    },
    [acks, answerLocal, refresh, say, sendHandoff, setOffer],
  );

  const voice = useVoiceInput({
    outputBusy: ambient.voice === "speaking" || ambient.voice === "processing",
    onNotice: setNotice,
    onInterim: (text) => setCaption({ speaker: "you", text }),
    onListening: (listening) => {
      if (listening) {
        turn.current++;
        speechId.current++;
        cancelSpeech();
        dispatch({ type: "listen_start" });
      } else {
        dispatch({ type: "listen_end" });
      }
    },
    onTranscript: (raw: string, source: TranscriptSource) => {
      if (source === "ptt") return void handleUtterance(raw);
      if (isEcho(raw, lastSpoken.current)) return;
      const gate = gateTranscript(raw, Date.now() < sessionUntil.current);
      if (!gate.accepted) return;
      touchSession();
      if (!gate.text) return void say("I'm listening.");
      void handleUtterance(gate.text);
    },
  });

  // After Anchor finishes, keep an open conversation open so follow-ups need no wake word.
  const previousVoice = useRef(ambient.voice);
  useEffect(() => {
    if (previousVoice.current !== "idle" && ambient.voice === "idle" && voice.handsFree && Date.now() < sessionUntil.current) touchSession();
    previousVoice.current = ambient.voice;
  }, [ambient.voice, voice.handsFree, touchSession]);

  const isReady = useCallback(
    () => ambientRef.current.voice === "idle" && Date.now() >= sessionUntil.current && !offerRef.current && !announcing.current,
    [],
  );

  const presentProactive = useCallback(
    async (item: ProactiveItem, mode: PresentMode) => {
      announcing.current = true;
      try {
        const at = new Date();
        const people = contextRef.current?.people ?? [];
        const userName = primaryUser(people)?.name ?? null;
        const visible = item.kind === "event" && item.person && !isSelf(item.person) ? item.person : null;
        const text = item.kind === "event" ? proactiveSpeech(item.event, item.person, at, userName) : item.message;
        const scene: SceneData =
          item.kind === "event"
            ? { kind: "reminder", person: visible, event: item.event, reminderKey: item.key, demo: item.demo }
            : { kind: "checkin", message: item.message, checkInKey: item.key, demo: item.demo };
        setHearPending(null);
        if (mode === "speak") {
          const result = await say(text, scene);
          if (result === "completed") acks.markSpoken(item.key);
          else if (result === "blocked") setHearPending({ key: item.key, text });
        } else {
          setCaption({ speaker: "anchor", text });
          dispatch({ type: "show", scene });
          if (mode === "locked") setHearPending({ key: item.key, text });
        }
      } finally {
        announcing.current = false;
      }
    },
    [acks, say],
  );

  const hearNow = useCallback(async () => {
    if (!hearPending) return;
    const { key, text } = hearPending;
    setHearPending(null);
    const result = await say(text);
    if (result === "completed") acks.markSpoken(key);
    else if (result === "blocked") setHearPending({ key, text });
  }, [acks, hearPending, say]);

  // The first key press or tap gives the browser permission to play sound: speak a card that was waiting for it.
  useEffect(() => {
    if (!voiceUnlocked || !hearPending || ambient.voice !== "idle") return;
    const id = setTimeout(() => void hearNow(), 0);
    return () => clearTimeout(id);
  }, [voiceUnlocked, hearPending, ambient.voice, hearNow]);

  const acknowledgeScene = useCallback(() => {
    const current = ambientRef.current.scene;
    if (current.kind === "reminder") acks.acknowledge(current.reminderKey);
    else if (current.kind === "checkin") acks.acknowledge(current.checkInKey);
    setHearPending(null);
    turn.current++;
    speechId.current++;
    cancelSpeech();
    dispatch({ type: "interrupt" });
    dispatch({ type: "scene_timeout", stamp: current.stamp });
  }, [acks]);

  const announceReply = useCallback(
    async (handoff: Handoff, caregiver: Person | null): Promise<boolean> => {
      announcing.current = true;
      try {
        const text = `I have a reply from ${caregiver?.name ?? "your caregiver"}. ${handoff.response ?? ""}`;
        return (await say(text, { kind: "reply", caregiver, handoff })) === "completed";
      } finally {
        announcing.current = false;
      }
    },
    [say],
  );

  const allPeople = context?.people ?? [];
  const people = allPeople.filter((p) => !isSelf(p));
  const events = context?.upcoming_events ?? [];
  const pending = context?.pending_handoffs.find((h) => h.status === "pending") ?? null;
  const pendingCaregiver = pending ? people.find((p) => p.id === pending.caregiver_person_id) ?? null : null;
  const stateName = deriveAmbientState(ambient, pending !== null);

  const narrative = now ? homeNarrative(now, events) : { line: "", focusPersonId: null };
  const homePerson = people.find((p) => p.id === narrative.focusPersonId) ?? (people.length ? people[rotation % people.length] : null);
  const scene = useMemo(
    () => (context && now ? refreshScene(ambient.scene, context, now) : ambient.scene),
    [ambient.scene, context, now],
  );
  const dayFirst = scene.kind === "day" && now && context ? buildDay(context.upcoming_events, context.people, now, scene.mode)[0]?.person ?? null : null;
  const scenePerson =
    scene.kind === "day"
      ? dayFirst
      :
    scene.kind === "person" || scene.kind === "memory" || scene.kind === "event" || scene.kind === "reminder"
      ? scene.person
      : scene.kind === "uncertain"
        ? scene.subject
        : scene.kind === "waiting" || scene.kind === "reply"
          ? scene.caregiver
          : null;
  const shownPerson = scenePerson ?? homePerson;
  const homeMemory = context ? pickHomeMemory(context.memories, shownPerson, rotation) : null;

  const consent: ConsentView | null = offer
    ? { caregiver: people.find((p) => p.id === offer.caregiverId) ?? null, candidates: people, awaitingWho: offer.awaitingWho }
    : null;

  const busy = ambient.voice === "processing";
  const canSpeak = voiceUnlocked && synthesisSupported();

  const demoActions = {
    checkIn: () => reminders.current?.injectCheckIn(DEFAULT_CHECKIN),
    visitor: () => {
      const ctx = contextRef.current;
      if (!ctx) return;
      const others = ctx.people.filter((p) => !isSelf(p));
      const real = ctx.upcoming_events.find((e) => e.status === "scheduled" && others.some((p) => p.id === e.person_id));
      const person = real ? others.find((p) => p.id === real.person_id)! : others[0];
      if (!person) return;
      const start = new Date(Date.now() + 15 * 60_000).toISOString();
      const event: Event = real
        ? { ...real, start_time: start }
        : { id: -1000, title: `Visit from ${person.name}`, description: "", start_time: start, person_id: person.id, reminder_minutes: 15, status: "scheduled" };
      reminders.current?.injectEvent(event);
    },
    personCard: () => {
      const person = people.find((p) => events.some((e) => e.person_id === p.id && classifyEvent(e, p) === "visit")) ?? people[0];
      if (person) void handleUtterance(`Who is ${person.name}?`);
    },
    briefing: () => void handleUtterance("What's happening today?"),
    reset: () => acks.clear(),
  };

  const confirmFromCard = (personId: number) => {
    const current = offerRef.current;
    if (!current) return;
    const id = ++turn.current;
    cancelSpeech();
    dispatch({ type: "processing" });
    void sendHandoff(personId, current.question, id);
  };

  return (
    <AmbientDisplay tod={now ? timeOfDay(now.getHours()) : "morning"} stateName={stateName} focus={scene.kind === "reminder" || scene.kind === "checkin" || scene.kind === "day"}>
      <PersonSpotlight person={shownPerson} />
      <div className="anchor-col flex min-w-0 flex-col gap-[clamp(0.625rem,1.6vh,1.5rem)]">
        <AmbientClock line={narrative.line} />
        <ConversationContextDisplay
          scene={scene}
          people={people}
          events={events}
          homeMemory={homeMemory}
          memories={context?.memories ?? []}
          canHear={hearPending !== null && ((scene.kind === "reminder" && hearPending.key === scene.reminderKey) || (scene.kind === "checkin" && hearPending.key === scene.checkInKey))}
          onHear={() => void hearNow()}
          onTellMore={(person) => {
            if (scene.kind === "reminder") acks.acknowledge(scene.reminderKey);
            setHearPending(null);
            void handleUtterance(scene.kind === "reminder" ? `Tell me about ${person.name}` : `Tell me more about ${person.name}`);
          }}
          onTalk={() => {
            acknowledgeScene();
            voice.pttStart(false);
          }}
          pendingCaregiver={pendingCaregiver}
          consent={scene.kind === "uncertain" ? consent : null}
          onAskCaregiver={confirmFromCard}
          onDecline={() => {
            setOffer(null);
            void say("Okay, I won't ask.", { kind: "home" });
          }}
          onAcknowledge={acknowledgeScene}
        />
        <SpeechCaption caption={caption} notice={notice} />
        <VoiceController
          stateName={stateName}
          voice={ambient.voice}
          waitingFor={pendingCaregiver?.name ?? null}
          supported={voice.supported}
          handsFree={voice.handsFree}
          muted={voice.muted}
          micStatus={voice.status}
          sessionOpen={sessionOpen}
          pttActive={voice.pttActive}
          busy={busy}
          onOrbPress={() => {
            if (voice.pttActive) voice.pttStop();
            else {
              if (ambient.voice === "speaking") interrupt();
              voice.pttStart(false);
            }
          }}
          onHoldStart={() => {
            if (!busy) voice.pttStart(true);
          }}
          onHoldEnd={voice.pttStop}
          onToggleHandsFree={() => {
            const next = !voice.handsFree;
            voice.setHandsFree(next);
            if (next) {
              setCaption({ speaker: "anchor", text: "Hands-free is on. Say “Anchor”, then ask me anything." });
              touchSession();
            }
          }}
          onToggleMute={() => voice.setMuted(!voice.muted)}
          onInterrupt={interrupt}
          onTyped={(text) => void handleUtterance(text)}
        />
        <p className="text-lg text-[var(--a-muted)]" data-testid="voice-disclosure">
          {voiceSource === "ai" ? "Anchor's voice is AI-generated. " : "Computer voice in use; the AI voice is unavailable. "}
          {offline ? "Sample content shown. " : ""}
          {!voiceUnlocked ? "Press any key to turn on sound." : ""}
        </p>
      </div>
      <ReminderManager handle={reminders} people={allPeople} isReady={isReady} canSpeak={canSpeak} acks={acks} present={presentProactive} />
      <DemoControls actions={demoActions} />
      <CaregiverResponseListener people={people} isReady={isReady} canSpeak={canSpeak} announce={announceReply} onDelivered={() => void refresh()} />
    </AmbientDisplay>
  );
}
