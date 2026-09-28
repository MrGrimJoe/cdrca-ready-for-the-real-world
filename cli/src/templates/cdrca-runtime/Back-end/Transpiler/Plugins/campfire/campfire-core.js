// campfire-core.js — campfire's runtime engine.
//
// This is the bundle every project using campfire needs
// (`@useLib campfire.core`) — the compiled output of `def SPEAKER`,
// `say`, and `choice` statements all call straight into `window.Campfire`,
// defined here. See plugin.js for exactly what each statement compiles
// to.
//
// Deliberately has ZERO knowledge of the DOM. It's an event bus plus a
// sequential queue — nothing here touches document/window rendering.
// That's the whole point: campfire-ui.js (this plugin's own optional,
// default visual layer — a separate bundle, `@useLib campfire.ui`) is
// just one *listener* on the events this file emits. Anyone can write
// their own alternate listener instead — a different look, a different
// framework, even a completely different medium (imagine driving a
// screen-reader-only experience, or logging a playthrough to a file) —
// without touching this file or campfire-ui.js at all. See this plugin's
// README for the full event contract and a worked example of writing
// your own listener.
//
// Follows the same pattern the wider CDRCA plugin ecosystem's own
// bundles use (Quark's quark-core.js, cdrca-reactive-state's runtime.js):
// an IIFE, one global namespace, no dependencies.

(function (global) {
  "use strict";

  function toHexColor(value) {
    // Accepts a 0xRRGGBB-style number (campfire's own convention,
    // matching the `animations` plugin's own BGcolor/RotatingCubeProp
    // color literals) or a value that's already a CSS color string
    // (so `color "goldenrod"` or `color "#ff0"` still works if someone
    // writes it that way — the plugin only guarantees `0xRRGGBB`, but the
    // runtime doesn't need to be stricter than that).
    if (typeof value === "number") {
      return "#" + (value & 0xffffff).toString(16).padStart(6, "0");
    }
    return String(value);
  }

  // ---------------------------------------------------------------
  // Tiny pub/sub — the entire "API surface" a custom UI needs to know
  // ---------------------------------------------------------------

  const listeners = Object.create(null);

  function on(eventName, callback) {
    (listeners[eventName] || (listeners[eventName] = [])).push(callback);
    return () => off(eventName, callback); // returns an unsubscribe fn
  }

  function off(eventName, callback) {
    const list = listeners[eventName];
    if (!list) return;
    const i = list.indexOf(callback);
    if (i !== -1) list.splice(i, 1);
  }

  function emit(eventName, payload) {
    const list = listeners[eventName];
    if (!list) return;
    // Copy before iterating — a listener unsubscribing itself (or
    // another) mid-emit shouldn't skip or re-run anything.
    list.slice().forEach((cb) => cb(payload));
  }

  // ---------------------------------------------------------------
  // Speakers
  // ---------------------------------------------------------------

  const speakers = Object.create(null);

  function defineSpeaker(id, { name, color }) {
    const speaker = { id, name, color: toHexColor(color) };
    speakers[id] = speaker;
    emit("speaker", speaker);
    return speaker;
  }

  function getSpeaker(id) {
    return (
      speakers[id] || {
        id,
        name: id,
        // A gentle, neutral fallback rather than throwing — a missing
        // `def SPEAKER` shouldn't take down an otherwise-working scene,
        // it should just look a little plain until it's fixed.
        color: "#888888",
      }
    );
  }

  // ---------------------------------------------------------------
  // The queue — the actual sequencing engine
  // ---------------------------------------------------------------
  //
  // Every `say`/`choice` call appends one item and calls pump(). pump()
  // only ever has ONE item "in flight" (`current`) at a time — a line
  // with an explicit `wait` auto-clears itself via setTimeout; a line
  // with no `wait`, or a choice, blocks until the UI calls advance() /
  // resolveChoice() respectively. This is intentionally simple (a plain
  // array, not a state machine library) — dialogue is inherently linear,
  // and keeping it simple is what makes writing an alternate UI for it
  // easy.

  const queue = [];
  let current = null;
  let waitTimer = null;

  function pump() {
    if (current || queue.length === 0) return;
    current = queue.shift();

    if (current.kind === "line") {
      emit("line", {
        speaker: getSpeaker(current.speakerId),
        text: current.text,
        wait: current.wait,
      });
      if (current.wait !== null) {
        waitTimer = global.setTimeout(() => {
          waitTimer = null;
          current = null;
          pump();
        }, current.wait);
      }
      // else: waits for an explicit advance() call.
    } else {
      // kind === "choice"
      emit("choice", {
        speaker: getSpeaker(current.speakerId),
        prompt: current.prompt,
        options: current.options.map((o) => ({ label: o.label, signal: o.signal })),
      });
      // waits for an explicit resolveChoice(signal) call.
    }
  }

  function say(speakerId, text, opts) {
    queue.push({
      kind: "line",
      speakerId,
      text,
      wait: opts && typeof opts.wait === "number" ? opts.wait : null,
    });
    pump();
  }

  function choice(speakerId, prompt, options) {
    queue.push({ kind: "choice", speakerId, prompt, options });
    pump();
  }

  // Called by a UI (a click, a keypress, a "tap to continue") to move
  // past a line that has no explicit `wait`. A no-op if the current item
  // isn't an advance-able line — so a UI can wire this to "any click
  // anywhere" without checking state first.
  function advance() {
    if (!current || current.kind !== "line" || current.wait !== null) return;
    current = null;
    pump();
  }

  // Called by a UI when the reader picks an option. Fires "choice-resolved"
  // (and any onSignal(signal, ...) callback registered for that exact
  // signal) before moving on, so app code can react to *which* choice was
  // made without needing to know campfire's queue internals at all.
  function resolveChoice(signal) {
    if (!current || current.kind !== "choice") return;
    const matched = current.options.some((o) => o.signal === signal);
    if (!matched) {
      console.warn(`campfire: resolveChoice("${signal}") doesn't match any option's signal for the current choice — ignored.`);
      return;
    }
    emit("choice-resolved", { signal });
    const signalListeners = signalOnceListeners[signal];
    if (signalListeners) signalListeners.slice().forEach((cb) => cb());
    current = null;
    pump();
  }

  // Sugar over "choice-resolved" for the common case of "I only care
  // about ONE specific signal" — avoids every consumer writing their own
  // `if (signal === "...")` inside a shared "choice-resolved" handler.
  const signalOnceListeners = Object.create(null);
  function onSignal(signal, callback) {
    (signalOnceListeners[signal] || (signalOnceListeners[signal] = [])).push(callback);
    return () => {
      const list = signalOnceListeners[signal];
      if (!list) return;
      const i = list.indexOf(callback);
      if (i !== -1) list.splice(i, 1);
    };
  }

  // Clears all queued/in-flight dialogue and cancels any pending
  // auto-advance timer — does NOT clear defined speakers, since those
  // are usually declared once up top and reused across every scene.
  // Mainly here so a UI can offer a real "skip"/"restart" control, and so
  // tests don't leak state between cases.
  function reset() {
    queue.length = 0;
    current = null;
    if (waitTimer !== null) {
      global.clearTimeout(waitTimer);
      waitTimer = null;
    }
  }

  global.Campfire = {
    defineSpeaker,
    getSpeaker,
    say,
    choice,
    advance,
    resolveChoice,
    on,
    off,
    onSignal,
    reset,
    // Exposed read-only-in-spirit for a custom UI that wants to render
    // "is anything happening right now" without its own bookkeeping —
    // e.g. to decide whether a click anywhere should call advance().
    get isWaitingForAdvance() {
      return !!current && current.kind === "line" && current.wait === null;
    },
    get isWaitingForChoice() {
      return !!current && current.kind === "choice";
    },
  };
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
