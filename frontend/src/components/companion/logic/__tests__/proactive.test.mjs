import test from "node:test";
import assert from "node:assert/strict";
import { buildDay, classifyEvent, localIntent, proactiveSpeech, briefingSpeech, visitorsSpeech, refreshScene, primaryUser, minutesPhrase } from "../briefing.ts";
import { createAckStore } from "../ack-store.ts";
import { dueCheckIn, parseCheckIns, checkInKey } from "../checkins.ts";

const now = new Date(2026, 9, 24, 16, 45);
const iso = (h, m = 0, d = 24) => new Date(2026, 9, d, h, m).toISOString();
const margaret = { id: 1, name: "Margaret", relationship: "Self", description: "", photo_url: null };
const elena = { id: 2, name: "Elena", relationship: "Daughter", description: "", photo_url: null };
const chen = { id: 4, name: "Dr. Chen", relationship: "Primary care doctor", description: "", photo_url: null };
const people = [margaret, elena, chen];
const ev = (id, title, start, person_id) => ({ id, title, description: "", start_time: start, person_id, reminder_minutes: 30, status: "scheduled" });
const events = [
  ev(1, "Elena visits", iso(17), 2),
  ev(2, "Afternoon tea", iso(18), 1),
  ev(3, "Appointment with Dr. Chen", iso(19), 4),
  ev(4, "Tomorrow thing", iso(10, 0, 25), 2),
  { ...ev(5, "Cancelled", iso(20), 2), status: "cancelled" },
];

test("primary user is the caregiver record with relationship Self", () => {
  assert.equal(primaryUser(people).name, "Margaret");
});

test("event kinds: visit, appointment, routine", () => {
  assert.equal(classifyEvent(events[0], elena), "visit");
  assert.equal(classifyEvent(events[2], chen), "appointment");
  assert.equal(classifyEvent(events[1], margaret), "routine");
});

test("daily briefing includes only today's scheduled events, never the user as a visitor", () => {
  const day = buildDay(events, people, now, "briefing");
  assert.deepEqual(day.map((i) => i.event.id), [1, 2, 3]);
  assert.equal(day[1].person, null);
  const visitors = buildDay(events, people, now, "visitors");
  assert.deepEqual(visitors.map((i) => i.person.name), ["Elena"]);
});

test("proactive visit speech is honest and names no pronoun", () => {
  const text = proactiveSpeech(events[0], elena, now, "Margaret");
  assert.equal(minutesPhrase(events[0].start_time, now), "in about 15 minutes");
  assert.match(text, /^Margaret, Elena is scheduled to visit in about 15 minutes\. Would you like to see a picture of Elena\?$/);
  assert.doesNotMatch(text, /\b(her|his|she|he|arrived|on (her|his|their) way)\b/i);
});

test("briefing and visitor speech use only record data", () => {
  const text = briefingSpeech(buildDay(events, people, now, "briefing"), now, "Margaret");
  assert.match(text, /Good afternoon, Margaret\./);
  assert.match(text, /Elena is scheduled to visit/);
  assert.match(text, /Appointment with Dr\. Chen is scheduled/);
  assert.match(briefingSpeech([], now, null), /I don't see anything planned/);
  assert.match(visitorsSpeech([]), /don't see any visitors/);
  assert.match(visitorsSpeech(buildDay(events, people, now, "visitors")), /^Elena at .* is scheduled to visit today\.$/);
});

test("local intents", () => {
  assert.equal(localIntent("What's happening today?"), "briefing");
  assert.equal(localIntent("what is on my schedule today"), "briefing");
  assert.equal(localIntent("Who's visiting today?"), "visitors");
  assert.equal(localIntent("Who is visiting?"), "visitors");
  assert.equal(localIntent("Who is Elena?"), null);
  assert.equal(localIntent("When is Sophie coming?"), null);
});

test("acknowledged reminders are remembered across reloads; spoken ones are not repeated", () => {
  const backing = new Map();
  const storage = { getItem: (k) => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, v) };
  const a = createAckStore(storage);
  a.markSpoken("1@x");
  a.acknowledge("2@x");
  const b = createAckStore(storage); // "reload"
  assert.equal(b.wasSpoken("1@x"), true);
  assert.equal(b.isAcknowledged("1@x"), false);
  assert.equal(b.isAcknowledged("2@x"), true);
  b.clear();
  assert.equal(createAckStore(storage).isAcknowledged("2@x"), false);
});

test("ack store survives broken storage", () => {
  const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
  const s = createAckStore(broken);
  s.acknowledge("k");
  assert.equal(s.isAcknowledged("k"), true);
});

test("daily check-ins fire once per day inside their window", () => {
  const list = parseCheckIns({ items: [{ id: "m", time: "09:00", message: "Morning" }, { id: "bad", time: "25:00" }, { id: "w", time: "09:00", days: [1] }] });
  assert.equal(list.length, 2);
  const at = (h, m) => new Date(2026, 9, 24, h, m); // a Saturday (6)
  assert.equal(dueCheckIn(list, at(8, 59), () => false), null);
  assert.equal(dueCheckIn(list, at(9, 5), () => false).id, "m");
  assert.equal(dueCheckIn(list, at(9, 5), (k) => k === checkInKey(list[0], at(9, 5))), null);
  assert.equal(dueCheckIn(list, at(12, 0), () => false), null); // too late
});

test("a displayed scene picks up caregiver edits", () => {
  const scene = { kind: "person", stamp: 3, person: elena, memory: null, event: null };
  const edited = { people: [margaret, { ...elena, relationship: "Daughter and caregiver" }], memories: [], upcoming_events: [events[0]] };
  const next = refreshScene(scene, edited, now);
  assert.equal(next.person.relationship, "Daughter and caregiver");
  assert.equal(next.event.id, 1);
});
