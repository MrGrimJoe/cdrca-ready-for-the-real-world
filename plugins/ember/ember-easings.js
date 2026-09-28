// ember-easings.js — a real curve library (`@useLib ember.easings`),
// registering into ember-core.js's easing registry. Standard, published
// formulas (the same ones at easings.net) — not approximations — so a
// modifier like `.elastic` produces exactly the curve shape someone
// familiar with those formulas already expects.
//
// Picking a curve in a `fx` statement is just naming it as a modifier:
//
//   fx heroCard bounce.elastic
//   fx title shake.back
//
// ember-core.js's own resolveEasing() takes the first modifier that
// matches a registered easing name — anything else in the modifier list
// (like "strong"/"decay" in the examples above) is left alone for the
// preset function itself to interpret, so an easing name and a preset's
// own intensity modifiers freely mix in one directive.

(function (global) {
  "use strict";

  const Ember = global.Ember;
  if (!Ember) {
    console.error("ember-easings.js: ember-core.js must be loaded first (add @useLib ember.core).");
    return;
  }

  Ember.registerEasing("linear", (t) => t);

  Ember.registerEasing("smooth", (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2));

  Ember.registerEasing("back", (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  });

  Ember.registerEasing("elastic", (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  });

  Ember.registerEasing("bounce", (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  });
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
