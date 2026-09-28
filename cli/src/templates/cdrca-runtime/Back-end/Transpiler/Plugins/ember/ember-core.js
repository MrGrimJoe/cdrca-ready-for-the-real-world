// ember-core.js — ember's engine. Always-load bundle (`@useLib
// ember.core`). Every `fx` statement compiles to a call into
// `window.Ember.play(...)`, defined here.
//
// This is the actual architecture, not a convenience wrapper: a preset
// registry, an easing registry, and a real requestAnimationFrame-driven
// interpolation loop that drives them. ember-easings.js, ember-presets.js,
// and ember-sequences.js are all separate bundles that register INTO
// this file's registries — none of them reach into each other directly,
// the same relationship quark-components.js/quark-templates.js/
// quark-families.js have to quark-core.js's own registries. A third
// party publishing their own preset pack (`providesFor: {"plugin":
// "ember", "library": "<theirs>"}`) registers into the exact same
// registries this file owns, indistinguishably from ember's own
// first-party bundles — there's no separate "official" registration path.
//
// A preset function's contract: (easedProgress, modifiers, params) =>
// a partial CSS style object (property name -> value string), called
// once per frame with `easedProgress` already run through whichever
// easing the modifiers selected. Pure function of its three arguments —
// no closure-captured per-call state — is what makes a preset trivially
// testable and safe to run for any element, which is why every bundled
// preset in ember-presets.js is written that way.

(function (global) {
  "use strict";

  const presets = Object.create(null);
  const easings = Object.create(null);

  // Real environments use requestAnimationFrame/performance.now; a
  // non-browser context (or a test) falls back to setTimeout/Date.now.
  // Exposed as a mutable object (`Ember._clock`) specifically so tests
  // can swap in deterministic fakes without needing real delays — the
  // same reason campfire-core.js exposes fake-timer-friendly seams.
  const realNow = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  const realRaf =
    typeof global.requestAnimationFrame === "function"
      ? (fn) => global.requestAnimationFrame(fn)
      : (fn) => global.setTimeout(() => fn(realNow()), 16);
  const realSetTimeout = (fn, ms) => global.setTimeout(fn, ms);

  const clock = { now: realNow, raf: realRaf, setTimeout: realSetTimeout };

  function registerPreset(name, fn) {
    if (typeof fn !== "function") {
      throw new Error(`ember: registerPreset("${name}", ...) needs a function`);
    }
    presets[name] = fn;
  }

  function registerEasing(name, fn) {
    if (typeof fn !== "function") {
      throw new Error(`ember: registerEasing("${name}", ...) needs a function`);
    }
    easings[name] = fn;
  }

  // The first modifier that names a registered easing wins; a preset's
  // own "intensity"/"direction"-style modifiers (e.g. "strong", "decay")
  // simply won't match anything here and are left for the preset
  // function itself to interpret from the raw modifiers array — the
  // same modifier list is passed to both.
  function resolveEasing(modifiers) {
    for (const m of modifiers) {
      if (easings[m]) return easings[m];
    }
    return easings.linear || ((t) => t);
  }

  function applyStyles(el, styles) {
    if (!styles) return;
    for (const prop in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, prop)) {
        el.style[prop] = styles[prop];
      }
    }
  }

  const DEFAULT_DURATION_MS = 500;

  // Returns a Promise that resolves once the animation completes — lets
  // ember-sequences.js build stagger()/chain() on top with nothing more
  // than plain Promise composition, no separate "done" callback API to
  // maintain.
  function play(elementId, presetName, modifiers, params) {
    modifiers = modifiers || [];
    params = params || {};

    const doc = typeof global.document !== "undefined" ? global.document : null;
    const el = doc ? doc.getElementById(elementId) : null;
    if (!el) {
      console.warn(`ember: no element with id "${elementId}" — "fx ${elementId} ${presetName}" did nothing.`);
      return Promise.resolve();
    }

    const presetFn = presets[presetName];
    if (!presetFn) {
      console.warn(
        `ember: unknown preset "${presetName}". Registered presets: ${Object.keys(presets).join(", ") || "(none — did you @useLib ember.presets?)"}`
      );
      return Promise.resolve();
    }

    const duration = typeof params.duration === "number" ? params.duration : DEFAULT_DURATION_MS;
    const ease = resolveEasing(modifiers);

    return new Promise((resolve) => {
      const start = clock.now();
      function frame() {
        const elapsed = clock.now() - start;
        const rawProgress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
        const eased = ease(rawProgress);
        applyStyles(el, presetFn(eased, modifiers, params));
        if (rawProgress < 1) {
          clock.raf(frame);
        } else {
          resolve();
        }
      }
      clock.raf(frame);
    });
  }

  function wait(ms) {
    return new Promise((resolve) => clock.setTimeout(resolve, ms));
  }

  global.Ember = {
    registerPreset,
    registerEasing,
    play,
    wait,
    _presets: presets,
    _easings: easings,
    _clock: clock,
    _resolveEasing: resolveEasing,
  };
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
