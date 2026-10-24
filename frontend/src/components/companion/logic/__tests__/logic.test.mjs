import test from "node:test";
import assert from "node:assert/strict";
import { ambientReducer, initialAmbient, deriveAmbientState } from "../ambient-state.ts";
import { selectScene, questionFocus } from "../scene-selector.ts";
import { classifyConsent, stepOffer, peopleNamedIn } from "../consent.ts";
import { gateTranscript, isEcho } from "../activation.ts";
import { createReminderQueue, isQuietHour, parseQuietHours, reminderSpeech, isAcknowledgement } from "../reminders.ts";
import { createDeliveryTracker } from "../delivery-tracker.ts";
import { classifyRecognitionError } from "../speech-errors.ts";
import { homeNarrative, timeOfDay, pickHomeMemory } from "../home-context.ts";
import { people, memories, events, ctx } from "./fixtures.mjs";

const run = (actions, state = initialAmbient) => actions.reduce(ambientReducer, state);
const at = (h, m = 0) => new Date(2026, 9, 24, h, m);

test("voice state: listening -> processing -> speaking -> idle", () => {
  let s = run([{ type: "listen_start" }]);
  assert.equal(s.voice, "listening");
  s = run([{ type: "processing" }], s);
  assert.equal(s.voice, "processing");
  s = run([{ type: "speak_start" }], s);
  assert.equal(s.voice, "speaking");
  s = run([{ type: "speak_end" }], s);
  assert.equal(s.voice, "idle");
});

test("voice state: ignores illegal transitions", () => {
  assert.equal(run([{ type: "speak_end" }]).voice, "idle");
  assert.equal(run([{ type: "listen_end" }]).voice, "idle");
  assert.equal(run([{ type: "processing" }, { type: "listen_start" }]).voice, "processing");
  assert.equal(run([{ type: "listen_start" }, { type: "speak_start" }]).voice, "listening");
});

test("interruption: listening cuts off speech; interrupt returns to idle", () => {
  assert.equal(run([{ type: "speak_start" }, { type: "listen_start" }]).voice, "listening");
  assert.equal(run([{ type: "speak_start" }, { type: "interrupt" }]).voice, "idle");
  assert.equal(run([{ type: "processing" }, { type: "interrupt" }]).voice, "idle");
});

test("scene timeouts only apply to the scene they were scheduled for", () => {
  let s = run([{ type: "show", scene: { kind: "memory", person: null, memory: memories[0] } }]);
  const stale = s.scene.stamp;
  s = run([{ type: "show", scene: { kind: "event", person: null, event: events[0] } }], s);
  assert.equal(run([{ type: "scene_timeout", stamp: stale }], s).scene.kind, "event");
  assert.equal(run([{ type: "scene_timeout", stamp: s.scene.stamp }], s).scene.kind, "home");
});

test("derived ambient state names", () => {
  const home = initialAmbient;
  assert.equal(deriveAmbientState(home, false), "idle");
  assert.equal(deriveAmbientState(home, true), "waiting_for_caregiver");
  const person = run([{ type: "show", scene: { kind: "person", person: people[0], memory: null, event: null } }]);
  assert.equal(deriveAmbientState(person, false), "showing_person");
  assert.equal(deriveAmbientState(run([{ type: "speak_start" }], person), false), "speaking");
  const reminder = run([{ type: "show", scene: { kind: "reminder", person: null, event: events[0] } }, { type: "speak_start" }]);
  assert.equal(deriveAmbientState(reminder, false), "delivering_reminder");
});

test("scene selection uses structured sources", () => {
  const who = selectScene({ sources: [{ type: "person", id: 1 }], handoff_offered: false }, ctx, "Who is Elena?", at(10));
  assert.equal(who.scene.kind, "person");
  assert.equal(who.scene.memory.id, 11, "newest memory of that person");
  const when = selectScene({ sources: [{ type: "person", id: 1 }, { type: "event", id: 20 }], handoff_offered: false }, ctx, "When is she visiting?", at(10));
  assert.equal(when.scene.kind, "event");
  assert.equal(when.scene.person.id, 1);
  const mem = selectScene({ sources: [{ type: "person", id: 1 }, { type: "memory", id: 10 }, { type: "event", id: 20 }], handoff_offered: false }, ctx, "What do we usually do together?", at(10));
  assert.equal(mem.scene.kind, "memory");
  assert.equal(mem.scene.memory.id, 10);
});

test("scene selection: unknown answers, no sources, and missing records", () => {
  const unknown = selectScene({ sources: [{ type: "person", id: 1 }], handoff_offered: true }, ctx, "Is she bringing lunch?", at(10));
  assert.equal(unknown.scene.kind, "uncertain");
  assert.equal(unknown.scene.subject.id, 1);
  assert.equal(selectScene({ sources: [], handoff_offered: false }, ctx, "Hello", at(10)).scene.kind, "home");
  const stale = selectScene({ sources: [{ type: "memory", id: 999 }], handoff_offered: false }, ctx, "x", at(10));
  assert.equal(stale.missing, true);
  assert.equal(stale.scene.kind, "home");
});

test("question focus reads only the person's own words", () => {
  assert.equal(questionFocus("When is she coming?"), "event");
  assert.equal(questionFocus("What do we like doing together?"), "memory");
  assert.equal(questionFocus("Who is Sarah?"), "person");
  assert.equal(questionFocus("hello"), null);
});

test("consent classification requires a whole-utterance match", () => {
  for (const t of ["Yes.", "yes please", "Yeah", "Sure!", "okay", "go ahead", "Please do"]) assert.equal(classifyConsent(t), "yes", t);
  for (const t of ["No", "no thanks", "Not now", "don't", "Never mind."]) assert.equal(classifyConsent(t), "no", t);
  for (const t of ["okay what time is it", "yes she is my daughter", "who is that", "maybe"]) assert.equal(classifyConsent(t), "unclear", t);
});

test("handoff offer flow", () => {
  const now = 1000;
  const offer = { question: "Is she bringing lunch?", caregiverId: 1, awaitingWho: false, expiresAt: now + 60_000 };
  assert.deepEqual(stepOffer(offer, "Yes", people, now), { kind: "create", caregiverId: 1, question: offer.question });
  assert.equal(stepOffer(offer, "no thanks", people, now).kind, "decline");
  assert.equal(stepOffer(offer, "what day is it", people, now).kind, "pass");
  assert.equal(stepOffer(offer, "yes", people, now + 61_000).kind, "pass", "expired offers never create handoffs");
});

test("without a structured caregiver, consent alone creates nothing", () => {
  const offer = { question: "q", caregiverId: null, awaitingWho: false, expiresAt: 10_000 };
  assert.equal(stepOffer(offer, "yes", people, 0).kind, "ask_who");
  const waiting = { ...offer, awaitingWho: true };
  assert.deepEqual(stepOffer(waiting, "Elena", people, 0), { kind: "create", caregiverId: 1, question: "q" });
  assert.equal(stepOffer(waiting, "my daughter", people, 0).kind, "pass");
  assert.deepEqual(stepOffer(offer, "yes ask Theo", people, 0), { kind: "create", caregiverId: 2, question: "q" });
  assert.equal(peopleNamedIn("Elena or Theo", people).length, 2);
  assert.equal(stepOffer(waiting, "Elena or Theo", people, 0).kind, "pass", "ambiguous names create nothing");
});

test("wake word gating", () => {
  assert.deepEqual(gateTranscript("Anchor, who is Sarah?", false), { accepted: true, text: "who is Sarah?", wake: true });
  assert.deepEqual(gateTranscript("hey anchor what time is it", false).text, "what time is it");
  assert.deepEqual(gateTranscript("Anchor", false), { accepted: true, text: "", wake: true });
  assert.equal(gateTranscript("the television is on", false).accepted, false);
  assert.equal(gateTranscript("could you ask anchor something", false).accepted, false);
  assert.deepEqual(gateTranscript("when is she coming", true), { accepted: true, text: "when is she coming", wake: false });
});

test("echo detection", () => {
  assert.equal(isEcho("elena is your daughter", "Elena is your daughter, and she visits on Sundays."), true);
  assert.equal(isEcho("what time is it", "Elena is your daughter."), false);
  assert.equal(isEcho("yes", "Yes, of course."), false, "short replies are never discarded");
});

test("reminder queue announces each reminder once", () => {
  const q = createReminderQueue();
  assert.equal(q.offer(events), 1);
  assert.equal(q.offer(events), 0);
  assert.equal(q.take().id, 20);
  assert.equal(q.take(), null);
  assert.equal(q.offer(events), 0, "already announced stays announced");
  assert.equal(q.offer([{ ...events[0], start_time: "2026-10-24T16:00:00Z" }]), 1, "a rescheduled event is a new reminder");
  assert.equal(q.offer([{ ...events[0], id: 21, status: "cancelled" }]), 0);
});

test("reminder wording never claims arrival or confirmation", () => {
  const text = reminderSpeech(events[0], people[0]);
  assert.match(text, /is scheduled for/);
  assert.doesNotMatch(text, /arriv|here|confirmed|on her way/i);
});

test("quiet hours, including overnight ranges", () => {
  const q = parseQuietHours("22:00-07:00");
  assert.equal(isQuietHour(at(23), q), true);
  assert.equal(isQuietHour(at(6, 59), q), true);
  assert.equal(isQuietHour(at(7), q), false);
  assert.equal(isQuietHour(at(12), q), false);
  assert.equal(isQuietHour(at(12), null), false);
  assert.equal(parseQuietHours("bad"), null);
  assert.equal(isAcknowledgement("Okay, thank you."), true);
  assert.equal(isAcknowledgement("okay who is that"), false);
});

test("delivery tracker: speak once, deliver only after completed speech, retry delivery without re-speaking", () => {
  const t = createDeliveryTracker(2);
  assert.equal(t.plan(1), "speak");
  t.beginSpeak(1);
  t.spoke(1, false);
  assert.equal(t.plan(1), "speak", "interrupted speech is retried");
  t.beginSpeak(1);
  t.spoke(1, false);
  assert.equal(t.plan(1), "skip", "gives up after max attempts and is never marked delivered");
  t.beginSpeak(2);
  t.spoke(2, true);
  assert.equal(t.plan(2), "deliver", "failed delivery request retries without speaking again");
  t.delivered(2);
  assert.equal(t.plan(2), "skip");
});

test("speech recognition failures distinguish offline from an unreachable service", () => {
  const online = { online: true, secure: true };
  assert.equal(classifyRecognitionError("network", { ...online, online: false }).kind, "offline");
  assert.equal(classifyRecognitionError("network", online).kind, "service_unreachable");
  assert.equal(classifyRecognitionError("not-allowed", online).kind, "blocked");
  assert.equal(classifyRecognitionError("not-allowed", { online: true, secure: false }).kind, "insecure_context");
  assert.equal(classifyRecognitionError("audio-capture", online).fatal, true);
  assert.equal(classifyRecognitionError("no-speech", online).fatal, false);
  assert.equal(classifyRecognitionError("aborted", online).message, "");
  assert.equal(classifyRecognitionError("network", online).message.includes("internet connection right now"), false);
});

test("home narrative is contextual and never infers arrival", () => {
  const morning = homeNarrative(at(9), []);
  assert.equal(morning.line, "Good morning. It's Saturday, October 24.");
  assert.equal(homeNarrative(at(19), []).line, "Good evening.");
  const local = [{ ...events[0], start_time: at(15).toISOString() }];
  const soon = homeNarrative(at(13), local);
  assert.match(soon.line, /Visit from Elena is scheduled for/);
  assert.equal(soon.focusPersonId, 1);
  assert.doesNotMatch(homeNarrative(at(16), local).line, /Visit from Elena/, "a passed start time is not reported as having happened");
  assert.equal(timeOfDay(3), "night");
  assert.equal(pickHomeMemory(memories, people[0], 0).id, 11);
  assert.equal(pickHomeMemory(memories, people[0], 1).id, 10);
  assert.equal(pickHomeMemory(memories, people[1], 0), null);
});
