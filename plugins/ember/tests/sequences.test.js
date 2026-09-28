const { test, report, assert } = require("./harness");

require("../ember-core.js");
const Ember = global.Ember;
require("../ember-sequences.js");

function fakeDocument(elementsById) {
  return { getElementById: (id) => elementsById[id] || null };
}

function fakeClock() {
  let now = 0;
  const pendingFrames = [];
  const pendingTimeouts = [];
  return {
    clock: {
      now: () => now,
      raf: (fn) => pendingFrames.push(fn),
      setTimeout: (fn, ms) => pendingTimeouts.push({ fn, at: now + ms }),
    },
    // Advances fake time, then settles in a fixed, non-looping sequence
    // — see core.test.js's copy of this helper for exactly why a looping
    // version isn't safe (confirmed directly: it hangs real test runs).
    async tick(ms) {
      now += ms;
      for (let i = pendingTimeouts.length - 1; i >= 0; i--) {
        if (pendingTimeouts[i].at <= now) {
          pendingTimeouts.splice(i, 1)[0].fn();
        }
      }
      await Promise.resolve();
      pendingFrames.splice(0, pendingFrames.length).forEach((fn) => fn());
    },
  };
}

function installFakeClock() {
  const { clock, tick } = fakeClock();
  Ember._clock.now = clock.now;
  Ember._clock.raf = clock.raf;
  Ember._clock.setTimeout = clock.setTimeout;
  return tick;
}

// A minimal instant preset — resolves on the very first frame regardless
// of duration, so these tests are about ORDERING/TIMING of stagger/chain
// themselves, not preset math (already covered in presets.test.js).
Ember.registerPreset("__test_instant", () => ({}));

test("stagger(): plays every element, delay*index apart — not all at once", async () => {
  const els = { a: { style: {} }, b: { style: {} }, c: { style: {} } };
  global.document = fakeDocument(els);
  const tick = installFakeClock();

  Ember.registerPreset("__test_mark", () => ({ opacity: "1" }));

  const done = Ember.stagger(["a", "b", "c"], "__test_mark", [], { delay: 50, duration: 0 });

  await tick(0);
  assert.strictEqual(els.a.style.opacity, "1", "a should have started immediately");
  assert.strictEqual(els.b.style.opacity, undefined, "b should not have started yet");
  assert.strictEqual(els.c.style.opacity, undefined, "c should not have started yet");

  await tick(50);
  assert.strictEqual(els.b.style.opacity, "1", "b should have started after its own 1x delay");
  assert.strictEqual(els.c.style.opacity, undefined, "c should still be waiting on its 2x delay");

  await tick(50);
  assert.strictEqual(els.c.style.opacity, "1", "c should have started after its own 2x delay");

  await done;
});

test("stagger(): resolves only after every element's animation has actually completed", async () => {
  const els = { a: { style: {} }, b: { style: {} } };
  global.document = fakeDocument(els);
  const tick = installFakeClock();

  Ember.registerPreset("__test_slow", (t) => ({ opacity: String(t) }));

  let resolved = false;
  const done = Ember.stagger(["a", "b"], "__test_slow", [], { delay: 100, duration: 200 }).then(() => (resolved = true));

  await tick(0); // a starts
  assert.strictEqual(resolved, false);

  await tick(100); // b's delay elapses, b starts; a is now 100/200 through
  assert.strictEqual(resolved, false);

  await tick(100); // a finishes (200 elapsed since its own start)
  assert.strictEqual(resolved, false, "b hasn't finished yet — stagger must wait for it too");

  await tick(100); // b finishes (200 elapsed since ITS start at t=100)
  await done;
  assert.strictEqual(resolved, true);
});

test("chain(): runs steps on one element strictly in order, each waiting for the previous to finish", async () => {
  const el = { style: {} };
  global.document = fakeDocument({ el });
  const tick = installFakeClock();

  const order = [];
  Ember.registerPreset("__test_step_a", () => {
    order.push("a");
    return {};
  });
  Ember.registerPreset("__test_step_b", () => {
    order.push("b");
    return {};
  });

  const done = Ember.chain("el", [
    { preset: "__test_step_a", params: { duration: 0 } },
    { preset: "__test_step_b", params: { duration: 0 } },
  ]);

  // duration: 0 means each step completes on its own very first frame —
  // avoids tracking multiple in-progress frames per step, this test only
  // cares about ordering. Two full ticks are needed: the first flushes
  // step a's frame (which resolves it, scheduling step b's play() call
  // as a microtask on chain()'s own continuation); the second flushes
  // step b's now-pending frame. Traced precisely against tick()'s actual
  // microtask ordering, not guessed.
  await tick(0);
  assert.deepStrictEqual(order, ["a"], "step b must not start before step a's animation finishes");

  await tick(0);
  assert.deepStrictEqual(order, ["a", "b"]);

  await done;
  assert.deepStrictEqual(order, ["a", "b"]);
});

report();
