import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceOutput, AI_RETRY_AFTER_MS } from "../voice-output.ts";

/** Controllable fakes: each play() stays pending until finish() or stop(). */
function setup({ audio = new Blob(["x"]), playResult = "completed" } = {}) {
  const calls = { fetch: [], play: 0, stop: 0, browser: [], cancelBrowser: 0 };
  let clock = 0;
  const pending = [];
  const player = {
    play() {
      calls.play++;
      return new Promise((resolve) => {
        const entry = { resolve };
        pending.push(entry);
        if (playResult !== "hold") queueMicrotask(() => resolve(playResult));
      });
    },
    stop() {
      calls.stop++;
      while (pending.length) pending.pop().resolve("interrupted");
    },
  };
  const deps = {
    fetchAudio: async (text) => { calls.fetch.push(text); return typeof audio === "function" ? audio() : audio; },
    player,
    speakBrowser: async (text) => { calls.browser.push(text); return "completed"; },
    cancelBrowser: () => calls.cancelBrowser++,
    now: () => clock,
  };
  return { out: createVoiceOutput(deps), calls, advance: (ms) => (clock += ms), pending };
}

test("speaks via the AI voice when /speech succeeds", async () => {
  const { out, calls } = setup();
  assert.equal(await out.speak("Hello"), "completed");
  assert.deepEqual(calls.fetch, ["Hello"]);
  assert.equal(calls.browser.length, 0);
  assert.equal(out.getSource(), "ai");
});

test("falls back to browser speech when the API fails, then skips the API for a while", async () => {
  const { out, calls, advance } = setup({ audio: null });
  assert.equal(await out.speak("One"), "completed");
  assert.deepEqual(calls.browser, ["One"]);
  assert.equal(out.getSource(), "browser");
  await out.speak("Two");
  assert.equal(calls.fetch.length, 1, "no new API attempt inside the retry window");
  advance(AI_RETRY_AFTER_MS);
  await out.speak("Three");
  assert.equal(calls.fetch.length, 2, "API is retried afterwards");
});

test("falls back when the request throws or audio cannot be played", async () => {
  const thrown = setup({ audio: () => { throw new Error("network"); } });
  assert.equal(await thrown.out.speak("a"), "completed");
  assert.equal(thrown.calls.browser.length, 1);
  const broken = setup({ playResult: "failed" });
  await broken.out.speak("b");
  assert.deepEqual(broken.calls.browser, ["b"]);
});

test("autoplay-blocked audio reports blocked instead of speaking twice", async () => {
  const { out, calls } = setup({ playResult: "blocked" });
  assert.equal(await out.speak("hi"), "blocked");
  assert.equal(calls.browser.length, 0);
});

test("new speech cancels the previous one: only one active at a time", async () => {
  const { out, calls } = setup({ playResult: "hold" });
  const first = out.speak("first");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.play, 1);
  const second = out.speak("second");
  assert.equal(await first, "interrupted");
  assert.ok(calls.stop >= 2, "previous audio stopped before the new one starts");
  assert.ok(calls.cancelBrowser >= 2, "browser speech cancelled too");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.play, 2);
  out.cancel();
  assert.equal(await second, "interrupted");
});

test("cancel() during the request discards the audio that arrives later", async () => {
  let release;
  const { out, calls } = setup({ audio: () => new Promise((r) => (release = () => r(new Blob(["x"])))) });
  const pendingSpeech = out.speak("late");
  await new Promise((r) => setTimeout(r, 0));
  out.cancel();
  release();
  assert.equal(await pendingSpeech, "interrupted");
  assert.equal(calls.play, 0);
  assert.equal(calls.browser.length, 0);
});

test("source changes notify subscribers", async () => {
  const { out } = setup({ audio: null });
  let n = 0;
  const off = out.subscribe(() => n++);
  await out.speak("x");
  assert.equal(n, 1);
  off();
});
