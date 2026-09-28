// reactive-state-query.js — reactive async data for cdrca-reactive-state
// (`@useLib cdrca-reactive-state.query`). Adds `R.query(...)`,
// `R.refetch(...)`, and `R.registerSource(...)` — doesn't touch
// runtime.js.
//
// A query is ONE cell holding a plain object: { data, loading, error }.
// Deliberately not three separate cells (userQuery.data as its own
// registered name, etc.) — cells are looked up by exact string name, but
// a `.cdrca` expression like `userQuery.loading` compiles to ordinary JS
// property access on whatever `userQuery` resolves to, not a second
// lookup by the literal name "userQuery.loading". One object-valued cell
// is what actually makes `@spinner bind:hidden = !userQuery.loading`
// work the way it reads.
//
// Usage:
//   R.query("users", () => fetch("/api/users").then(r => r.json()));
//   R.query("users", { source: "fetch", url: "/api/users" });   // shorthand, see below
//   R.query("filtered", () => fetchFiltered(R.get("filterText")), { dependsOn: ["filterText"] });
//   R.refetch("users");
//
// query() itself returns the initial fetch's Promise (so `await
// R.query(...)` means "wait for the first load") — for refetching later,
// use R.refetch(name), not query()'s own return value.
//
// The button example from the plan — no new directive syntax needed,
// `@id on:event = expr` already exists in this plugin's own plugin.js:
//   @saveButton on:click = R.refetch("users")

(function (global) {
  "use strict";

  const CDRCA = global.CDRCA;
  if (!CDRCA || !CDRCA.reactive) {
    console.error("reactive-state-query.js: cdrca-reactive-state's runtime.js must be loaded first.");
    return;
  }
  const R = CDRCA.reactive;

  const meta = new Map(); // name -> { cacheTime, lastFetchedAt, run }

  // ---- backend adapters ---------------------------------------------------
  //
  // A source is just { get(config) }, returning a value or a Promise of
  // one. This is the whole adaptability story: nothing about `query()`
  // itself is Firebase- or REST-specific — a Firebase (or Supabase, or a
  // hand-rolled live-server) adapter is a plain object registered here,
  // the same shape as this file's own built-in "fetch" adapter, published
  // as an ordinary third-party library the same way any CDRCA library is
  // (see PLUGIN-DEVELOPMENT.md's providesFor pattern) — not something
  // that needs to live in this file or depend on any particular SDK.

  const sources = new Map();

  function registerSource(name, adapter) {
    if (!adapter || typeof adapter.get !== "function") {
      throw new Error(`reactive-state-query: registerSource("${name}", ...) needs an object with a get(config) function`);
    }
    sources.set(name, adapter);
  }

  registerSource("fetch", {
    get(config) {
      const url = typeof config === "string" ? config : config.url;
      const fetchOpts = typeof config === "string" ? undefined : config.fetchOptions;
      return global.fetch(url, fetchOpts).then((res) => {
        if (!res.ok) throw new Error(`reactive-state-query: fetch "${url}" responded ${res.status}`);
        return res.json();
      });
    },
  });

  function resolveFetcher(fetcherOrConfig) {
    if (typeof fetcherOrConfig === "function") return fetcherOrConfig;
    const config = fetcherOrConfig || {};
    const sourceName = config.source || "fetch";
    const source = sources.get(sourceName);
    if (!source) {
      throw new Error(`reactive-state-query: unknown source "${sourceName}" — registerSource() it first.`);
    }
    return () => source.get(config);
  }

  // ---- query ---------------------------------------------------------------

  function query(name, fetcherOrConfig, opts) {
    opts = opts || {};
    const cacheTime = typeof opts.cacheTime === "number" ? opts.cacheTime : 0;
    const dependsOn = opts.dependsOn || [];
    const fetcher = resolveFetcher(fetcherOrConfig);

    R.define(name, { data: undefined, loading: false, error: null });

    async function run() {
      R.update(name, (s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fetcher();
        R.update(name, (s) => ({ ...s, data, loading: false }));
        entry.lastFetchedAt = Date.now();
      } catch (err) {
        R.update(name, (s) => ({ ...s, error: err, loading: false }));
      }
    }

    const entry = { cacheTime, lastFetchedAt: 0, run };
    meta.set(name, entry);

    dependsOn.forEach((dep) => R.watch(dep, () => run()));

    // Returns the INITIAL fetch's actual Promise — not the `run`
    // function itself. A manual re-fetch by name already exists
    // (`R.refetch(name)`), so there's no need for query()'s return value
    // to double as a callable handle too; making it a real Promise is
    // what lets `await R.query(...)` mean "wait for the first load,"
    // which is what every caller actually wants from the return value.
    return run();
  }

  function isStale(name) {
    const entry = meta.get(name);
    if (!entry) return true;
    if (!entry.cacheTime) return true;
    return Date.now() - entry.lastFetchedAt > entry.cacheTime;
  }

  // Skips the network entirely when the last fetch is still within
  // cacheTime — this is the "cache" half of "store, cache, route, and
  // use data... fast". A plain query() with no cacheTime always refetches,
  // matching how `R.refetch()` presumably should behave if you never
  // asked for caching in the first place.
  function refetch(name, opts) {
    const entry = meta.get(name);
    if (!entry) {
      console.warn(`reactive-state-query: "${name}" is not a registered query.`);
      return Promise.resolve();
    }
    if (!(opts && opts.force) && !isStale(name)) {
      return Promise.resolve();
    }
    return entry.run();
  }

  R.query = query;
  R.refetch = refetch;
  R.registerSource = registerSource;
  R.__isQueryStaleForTests = isStale;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
