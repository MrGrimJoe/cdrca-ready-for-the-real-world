const { test, report, assert } = require("./harness");

require("../ember-core.js");
const Ember = global.Ember;
require("../ember-presets.js");

function preset(name) {
  const fn = Ember._presets[name];
  assert.ok(fn, `expected a registered preset named "${name}"`);
  return fn;
}

// parseFloat() only works when the number is at the START of the string
// — "translateY(-20.00px)" isn't, so pull the numeric part out first.
function num(str) {
  const m = String(str).match(/-?\d+\.?\d*/);
  assert.ok(m, `expected a number inside "${str}"`);
  return parseFloat(m[0]);
}

test("every bundled preset returns a plain object at t=0, t=0.5, and t=1 without throwing", () => {
  for (const name of Object.keys(Ember._presets)) {
    for (const t of [0, 0.5, 1]) {
      const styles = Ember._presets[name](t, [], {});
      assert.strictEqual(typeof styles, "object");
      assert.ok(styles !== null);
    }
  }
});

test("bounce: starts and ends at the resting position (y=0), peaks in the middle", () => {
  const bounce = preset("bounce");
  assert.strictEqual(bounce(0, [], {}).transform, "translateY(0.00px)");
  assert.strictEqual(bounce(1, [], {}).transform, "translateY(-0.00px)");
  const mid = bounce(0.5, [], {}).transform;
  const midHeight = num(mid);
  assert.ok(midHeight < -15, `expected a real peak height at t=0.5, got ${mid}`);
});

test("bounce: 'strong' modifier is a real taller arc, not just a label", () => {
  const bounce = preset("bounce");
  const normalHeight = Math.abs(num(bounce(0.5, [], {}).transform));
  const strongHeight = Math.abs(num(bounce(0.5, ["strong"], {}).transform));
  assert.ok(strongHeight > normalHeight, `expected strong (${strongHeight}) > normal (${normalHeight})`);
});

test("shake: decays toward zero amplitude as t approaches 1", () => {
  const shake = preset("shake");
  // Sample the envelope at points where sin(t*pi*8) hits its own peak
  // (t = 0.0625 + n/8), so the comparison isolates the decay factor
  // rather than sine-phase noise.
  const early = Math.abs(num(shake(0.0625, [], {}).transform));
  const late = Math.abs(num(shake(0.0625 + 6 / 8, [], {}).transform));
  assert.ok(late < early, `expected late amplitude (${late}) < early amplitude (${early})`);
});

test("fadeIn / fadeOut: exact complements of each other at every t", () => {
  const fadeIn = preset("fadeIn");
  const fadeOut = preset("fadeOut");
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const sum = parseFloat(fadeIn(t, [], {}).opacity) + parseFloat(fadeOut(t, [], {}).opacity);
    assert.ok(Math.abs(sum - 1) < 1e-6, `fadeIn(${t}) + fadeOut(${t}) should be 1, got ${sum}`);
  }
});

test("slideUp: respects a custom 'distance' param instead of only the default", () => {
  const slideUp = preset("slideUp");
  const defaultStart = num(slideUp(0, [], {}).transform);
  const customStart = num(slideUp(0, [], { distance: 100 }).transform);
  assert.strictEqual(defaultStart, 24);
  assert.strictEqual(customStart, 100);
});

test("spin: 'double' modifier really does spin twice as far by t=1", () => {
  const spin = preset("spin");
  const once = num(spin(1, [], {}).transform);
  const twice = num(spin(1, ["double"], {}).transform);
  assert.strictEqual(once, 360);
  assert.strictEqual(twice, 720);
});

test("pulse: returns to scale 1 at both t=0 and t=1, peaks above 1 in the middle", () => {
  const pulse = preset("pulse");
  assert.strictEqual(num(pulse(0, [], {}).transform), 1);
  assert.strictEqual(num(pulse(1, [], {}).transform), 1);
  assert.ok(num(pulse(0.5, [], {}).transform) > 1);
});

report();
