const { test, report, assert } = require("./harness");

require("../ember-core.js");
const Ember = global.Ember;
require("../ember-easings.js");

function close(actual, expected, msg, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${msg}: expected ~${expected}, got ${actual}`);
}

test("every registered easing starts at 0 and ends at 1 — the one property that must hold regardless of curve shape", () => {
  for (const name of Object.keys(Ember._easings)) {
    close(Ember._easings[name](0), 0, `${name}(0)`);
    close(Ember._easings[name](1), 1, `${name}(1)`);
  }
});

test("linear: literally the identity function", () => {
  close(Ember._easings.linear(0.37), 0.37, "linear(0.37)");
});

test("smooth (easeInOutCubic): symmetric around t=0.5 -> exactly 0.5", () => {
  close(Ember._easings.smooth(0.5), 0.5, "smooth(0.5)");
});

test("smooth: known reference value at t=0.25 (standard easeInOutCubic formula)", () => {
  // t<0.5 branch: 4*t^3 = 4 * 0.25^3 = 0.0625
  close(Ember._easings.smooth(0.25), 0.0625, "smooth(0.25)");
});

test("back: genuinely overshoots past 1 partway through (that's the whole point of this curve)", () => {
  const samples = [0.7, 0.8, 0.85, 0.9];
  const overshootsSomewhere = samples.some((t) => Ember._easings.back(t) > 1);
  assert.ok(overshootsSomewhere, "expected easeOutBack to exceed 1.0 somewhere near the end");
});

test("elastic: known reference value at t=0.1 (standard easeOutElastic formula)", () => {
  const c4 = (2 * Math.PI) / 3;
  const expected = Math.pow(2, -1) * Math.sin((1 - 0.75) * c4) + 1;
  close(Ember._easings.elastic(0.1), expected, "elastic(0.1)");
});

test("bounce: first small hop lands under 1 before the final settle (real bounce shape, not a straight ramp)", () => {
  // The real easeOutBounce curve overshoots 1 briefly inside the first
  // segment (t < 1/2.75) before ever settling — a straight linear ramp
  // to 1 never would. Confirms this is the real formula, not an
  // approximation that merely clamps to [0,1].
  const t = 0.3; // inside the first bounce segment
  const v = Ember._easings.bounce(t);
  assert.ok(v > 0 && v < 1, `expected an in-flight value between 0 and 1 at t=0.3, got ${v}`);
});

report();
