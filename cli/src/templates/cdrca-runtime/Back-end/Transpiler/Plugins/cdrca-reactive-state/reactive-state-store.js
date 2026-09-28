// reactive-state-store.js — fast local persistence for cdrca-reactive-state
// (`@useLib cdrca-reactive-state.store`). Adds ONE new call, `R.store(...)`,
// alongside the existing `R.define(...)` — doesn't touch runtime.js.
//
// Built entirely on `subscribeAll()`, which runtime.js's own comment
// already calls out as "extension point for e.g. a future storage
// plugin" — this is that plugin. No new hook was needed.
//
// Usage:
//   R.store("cart", [], { persist: "local" });
//   R.store("session_token", null, { persist: "session", ttl: 3600000 });
//   R.store("draft", "", { persist: "memory" }); // same as plain define(), for symmetry
//
// A stored value round-trips through JSON — the same limitation
// localStorage/sessionStorage always have, not something this file adds.

(function (global) {
  "use strict";

  const CDRCA = global.CDRCA;
  if (!CDRCA || !CDRCA.reactive) {
    console.error("reactive-state-store.js: cdrca-reactive-state's runtime.js must be loaded first.");
    return;
  }
  const R = CDRCA.reactive;

  const persisted = new Map(); // name -> { persist: "local"|"session", ttl: number|null }

  function storageKey(name) {
    return `cdrca:state:${name}`;
  }

  function storageFor(persist) {
    if (persist === "local") return typeof global.localStorage !== "undefined" ? global.localStorage : null;
    if (persist === "session") return typeof global.sessionStorage !== "undefined" ? global.sessionStorage : null;
    return null;
  }

  function store(name, initialValue, opts) {
    opts = opts || {};
    const persist = opts.persist || "memory";
    const ttl = typeof opts.ttl === "number" ? opts.ttl : null;

    let startValue = initialValue;

    if (persist !== "memory") {
      const storage = storageFor(persist);
      if (storage) {
        try {
          const raw = storage.getItem(storageKey(name));
          if (raw !== null) {
            const saved = JSON.parse(raw);
            const expired = ttl !== null && (!saved.savedAt || Date.now() - saved.savedAt > ttl);
            if (expired) {
              storage.removeItem(storageKey(name));
            } else {
              startValue = saved.value;
            }
          }
        } catch (err) {
          // Corrupted entry (bad JSON, or someone else wrote to this key) —
          // fall back to initialValue rather than throwing on page load.
          console.warn(`reactive-state-store: couldn't read persisted "${name}", using the initial value instead.`, err);
        }
      }
      persisted.set(name, { persist, ttl });
    }

    R.define(name, startValue);
    return startValue;
  }

  // One listener, registered once, covers every persisted name — this is
  // the entire point of using subscribeAll() instead of a per-name watch().
  R.subscribeAll(({ name, value }) => {
    const cfg = persisted.get(name);
    if (!cfg) return;
    const storage = storageFor(cfg.persist);
    if (!storage) return;
    try {
      storage.setItem(storageKey(name), JSON.stringify({ value, savedAt: Date.now() }));
    } catch (err) {
      // Most commonly a quota error, or a value containing something
      // JSON.stringify can't serialize (a function, a DOM node) — warn
      // rather than throw, so one bad value doesn't break every other
      // state update on the page.
      console.warn(`reactive-state-store: failed to persist "${name}".`, err);
    }
  });

  R.store = store;

  R.__resetStoreForTests = () => persisted.clear();
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
