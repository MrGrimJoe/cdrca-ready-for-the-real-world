// ember-sequences.js — orchestration across elements/presets
// (`@useLib ember.sequences`), built entirely on ember-core.js's own
// public `play()`/`wait()` — nothing here reaches into core's internals,
// same "real example of what a third party could also build" spirit as
// campfire-ui.js was for campfire-core.js. Two combinators:
//
//   Ember.stagger(["a","b","c"], "fadeIn", [], { delay: 80 })
//     -> plays the same preset on each element, delay*index apart.
//
//   Ember.chain("hero", [
//     { preset: "slideUp" },
//     { preset: "pulse", modifiers: ["strong"] },
//   ])
//     -> plays each step on one element in order, waiting for each to
//        finish before starting the next.
//
// Both return a Promise that resolves once everything's done, so they
// compose with each other and with a plain Ember.play() call the same
// way any Promise does.

(function (global) {
  "use strict";

  const Ember = global.Ember;
  if (!Ember) {
    console.error("ember-sequences.js: ember-core.js must be loaded first (add @useLib ember.core).");
    return;
  }

  function stagger(elementIds, presetName, modifiers, opts) {
    const delay = (opts && typeof opts.delay === "number") ? opts.delay : 80;
    return Promise.all(
      elementIds.map((id, i) => Ember.wait(delay * i).then(() => Ember.play(id, presetName, modifiers || [], opts)))
    );
  }

  async function chain(elementId, steps) {
    for (const step of steps) {
      await Ember.play(elementId, step.preset, step.modifiers || [], step.params);
    }
  }

  Ember.stagger = stagger;
  Ember.chain = chain;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
