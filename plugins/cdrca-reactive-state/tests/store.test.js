const { test, report, assert } = require("./harness");
const { JSDOM } = require("jsdom");

function freshRuntime() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost/" });
  global.window = dom.window;
  global.document = dom.window.document;
  delete require.cache[require.resolve("../runtime.js")];
  delete require.cache[require.resolve("../reactive-state-store.js")];
  require("../runtime.js");
  require("../reactive-state-store.js");
  return { dom, R: dom.window.CDRCA.reactive };
}

test("store(): with no persist option behaves exactly like define()", () => {
  const { R } = freshRuntime();
  R.store("draft", "hello");
  assert.strictEqual(R.val("draft"), "hello");
});

test("store(): persist 'local' writes through to localStorage on every set()", () => {
  const { dom, R } = freshRuntime();
  R.store("cart", [], { persist: "local" });
  R.set("cart", ["apple"]);

  const raw = dom.window.localStorage.getItem("cdrca:state:cart");
  assert.ok(raw);
  assert.deepStrictEqual(JSON.parse(raw).value, ["apple"]);
});

test("store(): a previously-persisted value survives across a fresh module load, same storage", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost/" });
  global.window = dom.window;
  global.document = dom.window.document;

  delete require.cache[require.resolve("../runtime.js")];
  delete require.cache[require.resolve("../reactive-state-store.js")];
  require("../runtime.js");
  require("../reactive-state-store.js");
  dom.window.CDRCA.reactive.store("theme", "light", { persist: "local" });
  dom.window.CDRCA.reactive.set("theme", "dark");

  // Simulate a page reload: same window, same localStorage — but fresh
  // module instances (a real reload re-runs every <script> from scratch,
  // re-creating runtime.js's in-memory `cells` map from nothing).
  delete require.cache[require.resolve("../runtime.js")];
  delete require.cache[require.resolve("../reactive-state-store.js")];
  require("../runtime.js");
  require("../reactive-state-store.js");
  dom.window.CDRCA.reactive.store("theme", "light", { persist: "local" });

  assert.strictEqual(dom.window.CDRCA.reactive.val("theme"), "dark", "should load the persisted value, not fall back to the initial one");
});

test("store(): an expired ttl falls back to the initial value and clears the stale entry", () => {
  const { dom, R } = freshRuntime();
  // Manually write an "old" entry, as if it were saved long ago.
  dom.window.localStorage.setItem("cdrca:state:session_token", JSON.stringify({ value: "abc123", savedAt: Date.now() - 10000 }));

  R.store("session_token", null, { persist: "local", ttl: 1000 }); // 1s ttl, entry is 10s old

  assert.strictEqual(R.val("session_token"), null, "expired entry should fall back to the initial value");
  assert.strictEqual(dom.window.localStorage.getItem("cdrca:state:session_token"), null, "expired entry should be cleared");
});

test("store(): a non-expired ttl entry is loaded normally", () => {
  const { dom, R } = freshRuntime();
  dom.window.localStorage.setItem("cdrca:state:session_token", JSON.stringify({ value: "abc123", savedAt: Date.now() }));
  R.store("session_token", null, { persist: "local", ttl: 60000 });
  assert.strictEqual(R.val("session_token"), "abc123");
});

test("store(): persist 'session' uses sessionStorage, not localStorage", () => {
  const { dom, R } = freshRuntime();
  R.store("wizardStep", 1, { persist: "session" });
  R.set("wizardStep", 2);
  assert.strictEqual(dom.window.localStorage.getItem("cdrca:state:wizardStep"), null);
  assert.ok(dom.window.sessionStorage.getItem("cdrca:state:wizardStep"));
});

test("store(): a corrupted persisted entry doesn't throw on load — falls back to the initial value", () => {
  const { dom, R } = freshRuntime();
  dom.window.localStorage.setItem("cdrca:state:broken", "{not valid json");
  const value = R.store("broken", "fallback", { persist: "local" });
  assert.strictEqual(value, "fallback");
  assert.strictEqual(R.val("broken"), "fallback");
});

test("store(): plain define()'d state (never passed through store()) is never persisted", () => {
  const { dom, R } = freshRuntime();
  R.define("untouched", 0);
  R.set("untouched", 999);
  assert.strictEqual(dom.window.localStorage.getItem("cdrca:state:untouched"), null);
});

report();
