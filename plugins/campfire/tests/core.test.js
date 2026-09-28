const { test, report, assert } = require("./harness");

// campfire-core.js has zero DOM dependency, so unlike a component that
// needs jsdom, this can run in plain Node. Its IIFE closes over
// `typeof window !== "undefined" ? window : (real Node `global`)`, so in
// a browser it attaches to `window.Campfire` and in plain Node it
// attaches to the real global object as `global.Campfire` — in both
// cases the same place `setTimeout`/`clearTimeout` actually live, which
// matters below.

// Fake, fully synchronous timers so `wait`-driven auto-advance is
// deterministic in a plain synchronous test harness — no real delays,
// no async test support needed.
const pendingTimers = [];
global.setTimeout = (fn) => {
  const handle = { fn };
  pendingTimers.push(handle);
  return handle;
};
global.clearTimeout = (handle) => {
  const i = pendingTimers.indexOf(handle);
  if (i !== -1) pendingTimers.splice(i, 1);
};
function flushOneTimer() {
  const handle = pendingTimers.shift();
  assert.ok(handle, "expected a pending timer to flush but found none");
  handle.fn();
}

require("../campfire-core.js"); // attaches itself to the real global as `Campfire`
const { Campfire } = global;

function resetAll() {
  Campfire.reset();
  pendingTimers.length = 0;
}

// ---- speakers -------------------------------------------------------------

test("defineSpeaker: converts a 0xRRGGBB number into a CSS hex string", () => {
  resetAll();
  const s = Campfire.defineSpeaker("hero", { name: "Aria", color: 0xffcc00 });
  assert.strictEqual(s.color, "#ffcc00");
});

test("defineSpeaker: pads a short numeric color to six digits", () => {
  resetAll();
  const s = Campfire.defineSpeaker("x", { name: "X", color: 0xf0 });
  assert.strictEqual(s.color, "#0000f0");
});

test("getSpeaker: an undefined speaker gets a plain neutral fallback, not a throw", () => {
  resetAll();
  const s = Campfire.getSpeaker("nobody-defined-this");
  assert.strictEqual(s.name, "nobody-defined-this");
  assert.strictEqual(s.color, "#888888");
});

test("defineSpeaker: emits a 'speaker' event", () => {
  resetAll();
  let seen = null;
  const off = Campfire.on("speaker", (s) => (seen = s));
  Campfire.defineSpeaker("hero", { name: "Aria", color: 0xffffff });
  assert.ok(seen);
  assert.strictEqual(seen.id, "hero");
  off();
});

// ---- say / advance --------------------------------------------------------

test("say: with no wait, emits 'line' immediately and then blocks until advance()", () => {
  resetAll();
  const lines = [];
  const off = Campfire.on("line", (l) => lines.push(l));
  Campfire.say("hero", "Hello");
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].text, "Hello");
  assert.strictEqual(lines[0].wait, null);
  assert.strictEqual(Campfire.isWaitingForAdvance, true);
  off();
});

test("say: two queued lines — the second only emits after advance() on the first", () => {
  resetAll();
  const lines = [];
  const off = Campfire.on("line", (l) => lines.push(l.text));
  Campfire.say("hero", "First");
  Campfire.say("hero", "Second");
  assert.deepStrictEqual(lines, ["First"]);
  Campfire.advance();
  assert.deepStrictEqual(lines, ["First", "Second"]);
  off();
});

test("say: advance() is a no-op when nothing is waiting (safe to wire to 'click anywhere')", () => {
  resetAll();
  Campfire.advance(); // nothing queued at all
  assert.strictEqual(Campfire.isWaitingForAdvance, false);
});

test("say: with an explicit wait, auto-advances once the timer fires, no advance() call needed", () => {
  resetAll();
  const lines = [];
  const off = Campfire.on("line", (l) => lines.push(l.text));
  Campfire.say("hero", "Timed", { wait: 1000 });
  Campfire.say("hero", "Next");
  assert.deepStrictEqual(lines, ["Timed"]);
  assert.strictEqual(Campfire.isWaitingForAdvance, false, "a wait-driven line should not block on advance()");
  flushOneTimer();
  assert.deepStrictEqual(lines, ["Timed", "Next"]);
  off();
});

// ---- choice / resolveChoice / onSignal ------------------------------------

test("choice: emits 'choice' and blocks until resolveChoice()", () => {
  resetAll();
  let seen = null;
  const off = Campfire.on("choice", (c) => (seen = c));
  Campfire.choice("hero", "Well?", [{ label: "Yes", signal: "yes" }, { label: "No", signal: "no" }]);
  assert.ok(seen);
  assert.strictEqual(seen.options.length, 2);
  assert.strictEqual(Campfire.isWaitingForChoice, true);
  off();
});

test("resolveChoice: fires the matching onSignal callback exactly once, then resumes the queue", () => {
  resetAll();
  let firedCount = 0;
  const off = Campfire.onSignal("yes", () => firedCount++);
  const after = [];
  const offLine = Campfire.on("line", (l) => after.push(l.text));

  Campfire.choice("hero", "Well?", [{ label: "Yes", signal: "yes" }]);
  Campfire.say("hero", "Great!");

  Campfire.resolveChoice("yes");

  assert.strictEqual(firedCount, 1);
  assert.deepStrictEqual(after, ["Great!"]);
  assert.strictEqual(Campfire.isWaitingForChoice, false);

  off();
  offLine();
});

test("resolveChoice: an unrecognized signal is ignored, not a crash", () => {
  resetAll();
  Campfire.choice("hero", "Well?", [{ label: "Yes", signal: "yes" }]);
  Campfire.resolveChoice("totally-not-an-option");
  assert.strictEqual(Campfire.isWaitingForChoice, true, "the choice should still be pending");
});

// ---- reset ------------------------------------------------------------

test("reset: clears the queue and cancels a pending wait timer, but keeps defined speakers", () => {
  resetAll();
  Campfire.defineSpeaker("hero", { name: "Aria", color: 0xffffff });
  Campfire.say("hero", "Timed", { wait: 5000 });
  assert.strictEqual(pendingTimers.length, 1);

  Campfire.reset();

  assert.strictEqual(pendingTimers.length, 0, "reset() should cancel the pending wait timer");
  assert.strictEqual(Campfire.getSpeaker("hero").name, "Aria", "reset() should not forget speakers");
});

report();
