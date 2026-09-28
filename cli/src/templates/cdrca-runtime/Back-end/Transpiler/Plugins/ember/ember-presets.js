// ember-presets.js — a real preset catalog (`@useLib ember.presets`),
// registering into ember-core.js's preset registry. Every preset here is
// a pure function of (easedProgress, modifiers, params) — see
// ember-core.js's header comment for why that's the contract, and why it
// makes every preset here directly unit-testable with plain numbers, no
// DOM required.

(function (global) {
  "use strict";

  const Ember = global.Ember;
  if (!Ember) {
    console.error("ember-presets.js: ember-core.js must be loaded first (add @useLib ember.core).");
    return;
  }

  function intensity(modifiers, { subtle, normal, strong }) {
    if (modifiers.includes("subtle")) return subtle;
    if (modifiers.includes("strong")) return strong;
    return normal;
  }

  // A single up-down arc — a real sine half-cycle, not a linear ramp, so
  // it actually looks like a bounce rather than a triangle wave.
  Ember.registerPreset("bounce", (t, modifiers) => {
    const height = intensity(modifiers, { subtle: 10, normal: 20, strong: 40 });
    const y = -height * Math.sin(Math.PI * t);
    return { transform: `translateY(${y.toFixed(2)}px)` };
  });

  // A decaying horizontal shake — amplitude falls off toward the end
  // (the `(1 - t)` factor) so it settles instead of stopping abruptly.
  Ember.registerPreset("shake", (t, modifiers) => {
    const amp = intensity(modifiers, { subtle: 4, normal: 8, strong: 16 });
    const x = Math.sin(t * Math.PI * 8) * amp * (1 - t);
    return { transform: `translateX(${x.toFixed(2)}px)` };
  });

  Ember.registerPreset("fadeIn", (t) => ({ opacity: t.toFixed(3) }));
  Ember.registerPreset("fadeOut", (t) => ({ opacity: (1 - t).toFixed(3) }));

  Ember.registerPreset("slideUp", (t, modifiers, params) => {
    const distance = (params && params.distance) || 24;
    return { transform: `translateY(${((1 - t) * distance).toFixed(2)}px)`, opacity: t.toFixed(3) };
  });

  Ember.registerPreset("slideDown", (t, modifiers, params) => {
    const distance = (params && params.distance) || 24;
    return { transform: `translateY(${(-(1 - t) * distance).toFixed(2)}px)`, opacity: t.toFixed(3) };
  });

  Ember.registerPreset("spin", (t, modifiers) => {
    const turns = modifiers.includes("double") ? 2 : 1;
    return { transform: `rotate(${(t * 360 * turns).toFixed(2)}deg)` };
  });

  Ember.registerPreset("pulse", (t, modifiers) => {
    const amount = intensity(modifiers, { subtle: 0.05, normal: 0.1, strong: 0.25 });
    const scale = 1 + Math.sin(t * Math.PI) * amount;
    return { transform: `scale(${scale.toFixed(3)})` };
  });
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
