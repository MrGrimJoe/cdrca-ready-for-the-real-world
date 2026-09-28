const { test, report, assert } = require("./harness");

require("../ember-core.js");
const Ember = global.Ember;

// A minimal fake "element" — just enough of the .style surface play()
// actually touches. Deliberately not jsdom here: core.js's own logic
// (registry lookup, progress math, promise resolution) doesn't need a
// real DOM to verify, only something with a settable .style object and
// a document.getElementById that can find it. (ui.test.js-equivalent
// full-DOM verification happens in presets.test.js/sequences.test.js's
// jsdom-based checks where real style computation actually matters.)
function fakeDocument(elementsById) {
  return {
    getElementById: (id) => elementsById[id] || null,
  };
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
    // Async and cascading for the same reason sequences.test.js's copy
    // of this helper is — see that file's comment. core.test.js's own
    // cases happen to be single-chain and worked with a single-pass
    // synchronous flush, but keeping both copies identical means a
    // future test added here that chains play()/wait() calls (the way
    // sequences.test.js's stagger/chain tests do) won't quietly hit the
    // same bug that one did.
    // Advances fake time, then settles in a fixed, non-looping sequence:
    // fire any due timeouts, yield ONE microtask turn (so a `.then()`
    // continuation those timeouts trigger — e.g. stagger()'s
    // wait().then(() => play()) — actually runs and gets the chance to
    // queue a fresh raf frame), then flush whatever frames are pending
    // EXACTLY ONCE. Exactly-once matters: an unfinished animation's own
    // frame() re-queues itself via clock.raf(frame) every time it runs,
    // and since `now` doesn't change again within this same tick() call,
    // flushing frames more than once per tick — an earlier, looping
    // version of this helper did that — fires that SAME frame at the
    // SAME progress value repeatedly and, worse, can spin forever if
    // nothing else ever stops it. Splicing pendingFrames into a snapshot
    // before iterating means a self-requeue lands in the (now-emptied)
    // live array and correctly waits for the next tick() call instead.
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

test("play(): unknown element warns and resolves immediately, doesn't throw", async () => {
  global.document = fakeDocument({});
  const result = await Ember.play("missing", "bounce", [], {});
  assert.strictEqual(result, undefined);
});

test("play(): unknown preset warns and resolves immediately, doesn't throw", async () => {
  global.document = fakeDocument({ el: { style: {} } });
  const result = await Ember.play("el", "not-a-real-preset", [], {});
  assert.strictEqual(result, undefined);
});

test("play(): drives a registered preset frame-by-frame via the injected clock, applies styles, resolves at t>=1", async () => {
  const el = { style: {} };
  global.document = fakeDocument({ el });
  const { clock, tick } = fakeClock();
  Ember._clock.now = clock.now;
  Ember._clock.raf = clock.raf;
  Ember._clock.setTimeout = clock.setTimeout;

  const seenProgress = [];
  Ember.registerPreset("__test_linear_opacity", (t) => {
    seenProgress.push(t);
    return { opacity: String(t) };
  });

  let resolved = false;
  const donePromise = Ember.play("el", "__test_linear_opacity", [], { duration: 100 }).then(() => (resolved = true));

  await tick(0); // first frame, progress 0
  assert.strictEqual(el.style.opacity, "0");
  assert.strictEqual(resolved, false);

  await tick(50); // halfway
  assert.strictEqual(el.style.opacity, "0.5");
  assert.strictEqual(resolved, false);

  await tick(50); // done (elapsed 100 == duration)
  assert.strictEqual(el.style.opacity, "1");
  await donePromise; // let the .then() above actually run before checking `resolved`
  assert.strictEqual(resolved, true);

  assert.deepStrictEqual(seenProgress, [0, 0.5, 1]);
});

test("play(): an easing modifier actually changes the applied progress curve, not just which name gets logged", async () => {
  const el = { style: {} };
  global.document = fakeDocument({ el });
  const { clock, tick } = fakeClock();
  Ember._clock.now = clock.now;
  Ember._clock.raf = clock.raf;
  Ember._clock.setTimeout = clock.setTimeout;

  const seen = [];
  Ember.registerPreset("__test_record", (t) => {
    seen.push(t);
    return {};
  });
  Ember.registerEasing("__test_double_then_clamp", (t) => Math.min(1, t * 2));

  Ember.play("el", "__test_record", ["__test_double_then_clamp"], { duration: 100 });
  await tick(0);
  await tick(25); // raw progress 0.25 -> eased should be 0.5, not 0.25
  assert.strictEqual(seen[seen.length - 1], 0.5);
});

test("resolveEasing(): falls back to linear when no modifier names a registered easing", () => {
  const ease = Ember._resolveEasing(["strong", "not-an-easing"]);
  assert.strictEqual(ease(0.42), 0.42);
});

test("wait(): resolves after the injected clock's setTimeout fires, not before", async () => {
  const { clock, tick } = fakeClock();
  Ember._clock.now = clock.now;
  Ember._clock.raf = clock.raf;
  Ember._clock.setTimeout = clock.setTimeout;

  let done = false;
  Ember.wait(200).then(() => (done = true));
  await tick(100);
  assert.strictEqual(done, false);
  await tick(100);
  // Promise resolution needs a microtask tick — a real await here.
  await Promise.resolve();
  assert.strictEqual(done, true);
});

report();
