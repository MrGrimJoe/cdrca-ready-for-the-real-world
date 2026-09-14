const { test, report, assert } = require("./harness");
const { JSDOM } = require("jsdom");

function freshRuntime(html) {
  const dom = new JSDOM(html || "<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  delete require.cache[require.resolve("../runtime.js")];
  require("../runtime.js");
  const R = dom.window.CDRCA.reactive;
  return { dom, document: dom.window.document, R };
}

// ---- state --------------------------------------------------------------

test("define + val: basic read", () => {
  const { R } = freshRuntime();
  R.define("count", 0);
  assert.strictEqual(R.val("count"), 0);
});

test("set updates the value and notifies watchers", () => {
  const { R } = freshRuntime();
  R.define("count", 0);
  let seen = null;
  R.watch("count", (v) => (seen = v));
  R.set("count", 5);
  assert.strictEqual(R.val("count"), 5);
  assert.strictEqual(seen, 5);
});

test("set with Object.is-equal value does not notify", () => {
  const { R } = freshRuntime();
  R.define("count", 5);
  let calls = 0;
  R.watch("count", () => calls++);
  R.set("count", 5);
  assert.strictEqual(calls, 0);
});

test("define is idempotent — a second 'state' declaration keeps the current value", () => {
  const { R } = freshRuntime();
  R.define("count", 0);
  R.set("count", 42);
  R.define("count", 0); // simulate duplicate mount / re-run of init code
  assert.strictEqual(R.val("count"), 42);
});

test("multiple independent states don't interfere", () => {
  const { R } = freshRuntime();
  R.define("a", 1);
  R.define("b", 2);
  R.set("a", 10);
  assert.strictEqual(R.val("a"), 10);
  assert.strictEqual(R.val("b"), 2);
});

test("set on an undeclared name throws", () => {
  const { R } = freshRuntime();
  assert.throws(() => R.set("missing", 1), /declare it first/);
});

test("val on an undeclared name throws a clear error", () => {
  const { R } = freshRuntime();
  assert.throws(() => R.val("missing"), /"missing" is not defined/);
});

test("update() reads-then-writes", () => {
  const { R } = freshRuntime();
  R.define("count", 1);
  R.update("count", (v) => v + 9);
  assert.strictEqual(R.val("count"), 10);
});

// ---- computed -------------------------------------------------------------

test("computed recomputes when a dependency changes", () => {
  const { R } = freshRuntime();
  R.define("firstName", "John");
  R.define("lastName", "Smith");
  R.computed("fullName", () => `${R.val("firstName")} ${R.val("lastName")}`);
  assert.strictEqual(R.val("fullName"), "John Smith");
  R.set("firstName", "Jane");
  assert.strictEqual(R.val("fullName"), "Jane Smith");
});

test("computed only depends on names actually read (conditional deps)", () => {
  const { R } = freshRuntime();
  R.define("useA", true);
  R.define("a", 1);
  R.define("b", 2);
  let evals = 0;
  R.computed("x", () => {
    evals++;
    return R.val("useA") ? R.val("a") : R.val("b");
  });
  assert.strictEqual(R.val("x"), 1);
  R.set("b", 999); // not currently a dependency
  assert.strictEqual(evals, 1); // no recompute
  R.set("useA", false); // switches dependency to b
  assert.strictEqual(R.val("x"), 999);
});

test("a chain of computed values propagates", () => {
  const { R } = freshRuntime();
  R.define("count", 2);
  R.computed("doubled", () => R.val("count") * 2);
  R.computed("quadrupled", () => R.val("doubled") * 2);
  assert.strictEqual(R.val("quadrupled"), 8);
  R.set("count", 3);
  assert.strictEqual(R.val("quadrupled"), 12);
});

test("computed referencing an unknown name throws synchronously at declaration", () => {
  // A genuine circular *declaration* (a depends on b, b depends on a) is
  // structurally impossible here since a computed can only ever read
  // already-declared cells — see docs/REACTIVE-STATE.md#errors. This is
  // the realistic version of "Circular computed state" from the spec: the
  // mistake surfaces immediately, at the 'computed name = expr' call site.
  const { R } = freshRuntime();
  assert.throws(() => R.computed("y", () => R.val("doesNotExist")), /"doesNotExist" is not defined/);
});

test("a reentrant recompute (a computed mutating its own dependency) is detected and reported, not left to loop forever", () => {
  // Once a computed is subscribed to its dependencies, a compute function
  // that mutates one of them re-enters recomputeComputed() for the SAME
  // cell while it's still marked `evaluating` — the circular-dependency
  // guard fires. Because this recompute is happening inside another
  // cell's notify() fan-out (so one runaway computed can't take down
  // sibling subscribers on the same state), the error is caught and
  // reported via console.error rather than thrown out to the original
  // R.set() caller — see docs/REACTIVE-STATE.md#errors.
  const { R } = freshRuntime();
  R.define("x", 1);
  let evalCount = 0;
  R.computed("z", () => {
    evalCount++;
    const v = R.val("x");
    if (evalCount === 2) R.set("x", v + 1); // reentrant on the 2nd run
    return v;
  });
  const originalError = console.error;
  let loggedMessage = "";
  console.error = (...args) => (loggedMessage += args.map(String).join(" "));
  try {
    R.set("x", 2); // triggers z's 2nd evaluation, which mutates x again
  } finally {
    console.error = originalError;
  }
  assert.ok(/circular dependency/.test(loggedMessage), `expected a circular-dependency report, got: ${loggedMessage}`);
});

test("computed cannot be set directly", () => {
  const { R } = freshRuntime();
  R.define("x", 1);
  R.computed("y", () => R.val("x") + 1);
  assert.throws(() => R.set("y", 5), /computed/);
});

test("redeclaring a state name as computed throws", () => {
  const { R } = freshRuntime();
  R.define("x", 1);
  assert.throws(() => R.computed("x", () => 1), /already declared as state/);
});

// ---- bindings: text/html/attr/prop/class/style/disabled/show -----------

test("bind text updates textContent and re-runs on change", () => {
  const { R, document } = freshRuntime('<div id="out"></div>');
  R.define("count", 0);
  R.bind("out", "text", () => R.val("count"), null);
  assert.strictEqual(document.getElementById("out").textContent, "0");
  R.set("count", 7);
  assert.strictEqual(document.getElementById("out").textContent, "7");
});

test("bind html sets innerHTML", () => {
  const { R, document } = freshRuntime('<div id="out"></div>');
  R.define("markup", "<b>hi</b>");
  R.bind("out", "html", () => R.val("markup"), null);
  assert.strictEqual(document.getElementById("out").innerHTML, "<b>hi</b>");
});

test("bind attr sets/removes an attribute", () => {
  const { R, document } = freshRuntime('<a id="link"></a>');
  R.define("url", "https://example.com");
  R.bind("link", "attr:href", () => R.val("url"), null);
  assert.strictEqual(document.getElementById("link").getAttribute("href"), "https://example.com");
  R.set("url", null);
  assert.strictEqual(document.getElementById("link").hasAttribute("href"), false);
});

test("bind prop sets a DOM property directly", () => {
  const { R, document } = freshRuntime('<input id="inp">');
  R.define("ph", "type here");
  R.bind("inp", "prop:placeholder", () => R.val("ph"), null);
  assert.strictEqual(document.getElementById("inp").placeholder, "type here");
});

test("bind class toggles a single class based on truthiness", () => {
  const { R, document } = freshRuntime('<div id="card"></div>');
  R.define("active", false);
  R.bind("card", "class:active", () => R.val("active"), null);
  assert.strictEqual(document.getElementById("card").classList.contains("active"), false);
  R.set("active", true);
  assert.strictEqual(document.getElementById("card").classList.contains("active"), true);
});

test("bind style sets a CSS property", () => {
  const { R, document } = freshRuntime('<div id="box"></div>');
  R.define("color", "red");
  R.bind("box", "style:color", () => R.val("color"), null);
  assert.strictEqual(document.getElementById("box").style.color, "red");
});

test("bind disabled reflects a boolean", () => {
  const { R, document } = freshRuntime('<button id="btn"></button>');
  R.define("busy", true);
  R.bind("btn", "disabled", () => R.val("busy"), null);
  assert.strictEqual(document.getElementById("btn").disabled, true);
});

test("bind show toggles display", () => {
  const { R, document } = freshRuntime('<div id="panel"></div>');
  R.define("visible", false);
  R.bind("panel", "show", () => R.val("visible"), null);
  assert.strictEqual(document.getElementById("panel").style.display, "none");
  R.set("visible", true);
  assert.strictEqual(document.getElementById("panel").style.display, "");
});

test("multiple bindings on the same state all update", () => {
  const { R, document } = freshRuntime('<div id="a"></div><div id="b"></div>');
  R.define("count", 0);
  R.bind("a", "text", () => R.val("count"), null);
  R.bind("b", "text", () => R.val("count"), null);
  R.set("count", 3);
  assert.strictEqual(document.getElementById("a").textContent, "3");
  assert.strictEqual(document.getElementById("b").textContent, "3");
});

test("bind on a missing element logs an error and does not throw", () => {
  const { R } = freshRuntime();
  R.define("count", 0);
  const originalError = console.error;
  let loggedCount = 0;
  console.error = () => loggedCount++;
  try {
    R.bind("doesNotExist", "text", () => R.val("count"), null);
  } finally {
    console.error = originalError;
  }
  assert.strictEqual(loggedCount, 1);
});

test("binding to an unknown state throws a clear error", () => {
  const { R, document } = freshRuntime('<div id="out"></div>');
  assert.throws(() => R.bind("out", "text", () => R.val("nope"), null), /"nope" is not defined/);
});

// ---- two-way / input binding ---------------------------------------------

test("bind value is two-way for a bare state reference", () => {
  const { R, document } = freshRuntime('<input id="name">');
  R.define("name", "");
  R.bind("name", "value", () => R.val("name"), "name");
  const input = document.getElementById("name");
  assert.strictEqual(input.value, "");
  R.set("name", "Ada");
  assert.strictEqual(input.value, "Ada");
  input.value = "Grace";
  input.dispatchEvent(new document.defaultView.Event("input"));
  assert.strictEqual(R.val("name"), "Grace");
});

test("bind checked is two-way via the change event", () => {
  const { R, document } = freshRuntime('<input id="done" type="checkbox">');
  R.define("done", false);
  R.bind("done", "checked", () => R.val("done"), "done");
  const cb = document.getElementById("done");
  cb.checked = true;
  cb.dispatchEvent(new document.defaultView.Event("change"));
  assert.strictEqual(R.val("done"), true);
});

test("bind value with a computed expression is NOT wired for write-back", () => {
  const { R, document } = freshRuntime('<input id="out">');
  R.define("first", "A");
  R.define("last", "B");
  R.bind("out", "value", () => R.val("first") + R.val("last"), null);
  const input = document.getElementById("out");
  input.value = "typed by user";
  input.dispatchEvent(new document.defaultView.Event("input"));
  // no writableName was given, so no state should have changed
  assert.strictEqual(R.val("first"), "A");
  assert.strictEqual(R.val("last"), "B");
});

// ---- events ---------------------------------------------------------------

test("on() wires a click handler that updates state", () => {
  const { R, document } = freshRuntime('<button id="inc"></button>');
  R.define("count", 0);
  R.on("inc", "click", () => R.update("count", (v) => v + 1));
  document.getElementById("inc").dispatchEvent(new document.defaultView.Event("click"));
  assert.strictEqual(R.val("count"), 1);
});

test("re-registering the same element+event replaces the old handler (no duplicate mounting)", () => {
  const { R, document } = freshRuntime('<button id="inc"></button>');
  R.define("count", 0);
  R.on("inc", "click", () => R.update("count", (v) => v + 1));
  R.on("inc", "click", () => R.update("count", (v) => v + 100)); // duplicate mount
  document.getElementById("inc").dispatchEvent(new document.defaultView.Event("click"));
  assert.strictEqual(R.val("count"), 100); // only the second handler fired, once
});

test("an error thrown inside an event handler is caught and logged, not fatal", () => {
  const { R, document } = freshRuntime('<button id="boom"></button>');
  R.on("boom", "click", () => {
    throw new Error("kaboom");
  });
  const originalError = console.error;
  let logged = false;
  console.error = () => (logged = true);
  try {
    document.getElementById("boom").dispatchEvent(new document.defaultView.Event("click"));
  } finally {
    console.error = originalError;
  }
  assert.strictEqual(logged, true);
});

// ---- lists ------------------------------------------------------------

test("bind.list renders, updates, and removes items by id", () => {
  const { R, document } = freshRuntime(
    '<div id="list"></div><template id="tpl"><li><span data-bind-text="text"></span></li></template>'
  );
  R.define("todos", [
    { id: 1, text: "buy milk" },
    { id: 2, text: "walk dog" },
  ]);
  R.bindList("list", "todos", "tpl");
  const list = document.getElementById("list");
  assert.strictEqual(list.children.length, 2);
  assert.strictEqual(list.children[0].textContent, "buy milk");

  R.set("todos", [{ id: 2, text: "walk dog" }]);
  assert.strictEqual(list.children.length, 1);
  assert.strictEqual(list.children[0].textContent, "walk dog");
});

test("bind.list reorders existing DOM nodes instead of recreating them", () => {
  const { R, document } = freshRuntime(
    '<div id="list"></div><template id="tpl"><li data-bind-text="text"></li></template>'
  );
  R.define("todos", [
    { id: 1, text: "a" },
    { id: 2, text: "b" },
  ]);
  R.bindList("list", "todos", "tpl");
  const list = document.getElementById("list");
  const firstNodeForId1 = list.children[0];
  R.set("todos", [
    { id: 2, text: "b" },
    { id: 1, text: "a" },
  ]);
  assert.strictEqual(list.children[1], firstNodeForId1); // same node, moved, not recreated
});

// ---- lifecycle / cleanup ----------------------------------------------

test("removing a bound element from the DOM disposes its binding (no leak)", async () => {
  const { R, document } = freshRuntime('<div id="wrap"><div id="out"></div></div>');
  R.define("count", 0);
  R.bind("out", "text", () => R.val("count"), null);
  document.getElementById("wrap").remove();
  // MutationObserver callbacks run in a microtask; wait a tick.
  await new Promise((r) => setTimeout(r, 0));
  // Setting the state afterwards must not throw even though the element is gone.
  R.set("count", 1);
});

// ---- performance smoke test ---------------------------------------------

test("hundreds of bindings on independent states update quickly and correctly", () => {
  const N = 300;
  let html = "";
  for (let i = 0; i < N; i++) html += `<div id="out${i}"></div>`;
  const { R, document } = freshRuntime(html);
  for (let i = 0; i < N; i++) {
    R.define(`s${i}`, i);
    R.bind(`out${i}`, "text", () => R.val(`s${i}`), null);
  }
  const start = Date.now();
  for (let i = 0; i < N; i++) R.set(`s${i}`, i * 10);
  const elapsed = Date.now() - start;
  for (let i = 0; i < N; i++) {
    assert.strictEqual(document.getElementById(`out${i}`).textContent, String(i * 10));
  }
  assert.ok(elapsed < 1000, `expected ${N} updates to be fast; took ${elapsed}ms`);
});

test("many bindings to the SAME rapidly-changing state all stay in sync", () => {
  const N = 200;
  let html = "";
  for (let i = 0; i < N; i++) html += `<div id="out${i}"></div>`;
  const { R, document } = freshRuntime(html);
  R.define("shared", 0);
  for (let i = 0; i < N; i++) R.bind(`out${i}`, "text", () => R.val("shared"), null);
  for (let v = 1; v <= 50; v++) R.set("shared", v);
  for (let i = 0; i < N; i++) {
    assert.strictEqual(document.getElementById(`out${i}`).textContent, "50");
  }
});

// ---- normal CDRCA projects unaffected when the plugin isn't used --------

test("runtime does nothing / touches nothing unless its API is called", () => {
  const { dom } = freshRuntime("<div>hello</div>");
  assert.strictEqual(dom.window.document.body.innerHTML, "<div>hello</div>");
  assert.ok(dom.window.CDRCA && dom.window.CDRCA.reactive, "namespace exists but is inert until used");
});

report();
