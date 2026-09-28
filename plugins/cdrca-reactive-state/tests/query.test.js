const { test, report, assert } = require("./harness");
const { JSDOM } = require("jsdom");

function freshRuntime() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost/" });
  global.window = dom.window;
  global.document = dom.window.document;
  delete require.cache[require.resolve("../runtime.js")];
  delete require.cache[require.resolve("../reactive-state-query.js")];
  require("../runtime.js");
  require("../reactive-state-query.js");
  return { dom, R: dom.window.CDRCA.reactive };
}

test("query(): starts loading immediately, resolves data through the reactive cell", async () => {
  const { R } = freshRuntime();
  const run = R.query("users", () => Promise.resolve(["alice", "bob"]));
  assert.strictEqual(R.val("users").loading, true, "should be loading synchronously right after query() is called");
  await run;
  assert.deepStrictEqual(R.val("users").data, ["alice", "bob"]);
  assert.strictEqual(R.val("users").loading, false);
  assert.strictEqual(R.val("users").error, null);
});

test("query(): a rejected fetcher lands in .error, not a thrown exception, and loading clears", async () => {
  const { R } = freshRuntime();
  const run = R.query("users", () => Promise.reject(new Error("network down")));
  await run;
  assert.strictEqual(R.val("users").loading, false);
  assert.strictEqual(R.val("users").error.message, "network down");
  assert.strictEqual(R.val("users").data, undefined);
});

test("query(): userQuery.data / .loading read naturally as plain property access from an expression, not a second cell lookup", async () => {
  // This is the actual design constraint the file's own header comment
  // explains — confirming it holds, not just asserting the shape.
  const { R } = freshRuntime();
  await R.query("users", () => Promise.resolve({ count: 2 }));
  const value = R.val("users"); // exactly what a compiled `users` reference would call
  assert.strictEqual(value.data.count, 2); // plain JS property access from here on, no R.val("users.data")
  assert.throws(() => R.val("users.data")); // that literal name was never registered as its own cell
});

test("query(): dependsOn triggers a real refetch when the dependency changes", async () => {
  const { R } = freshRuntime();
  R.define("filterText", "a");
  let calls = 0;
  const run = R.query(
    "filtered",
    () => {
      calls++;
      return Promise.resolve(R.val("filterText") + calls);
    },
    { dependsOn: ["filterText"] }
  );
  await run;
  assert.strictEqual(calls, 1);
  assert.strictEqual(R.val("filtered").data, "a1");

  R.set("filterText", "b");
  // The dependency-triggered run() is fire-and-forget from watch()'s own
  // perspective — give its promise chain a turn to actually finish.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(calls, 2);
  assert.strictEqual(R.val("filtered").data, "b2");
});

test("refetch(): with no cacheTime, always refetches", async () => {
  const { R } = freshRuntime();
  let calls = 0;
  const run = R.query("users", () => {
    calls++;
    return Promise.resolve(calls);
  });
  await run;
  await R.refetch("users");
  assert.strictEqual(calls, 2);
});

test("refetch(): within cacheTime, skips the network unless forced", async () => {
  const { R } = freshRuntime();
  let calls = 0;
  const run = R.query(
    "users",
    () => {
      calls++;
      return Promise.resolve(calls);
    },
    { cacheTime: 60000 }
  );
  await run;
  await R.refetch("users"); // within cache window -> should be a no-op
  assert.strictEqual(calls, 1);

  await R.refetch("users", { force: true }); // explicit override
  assert.strictEqual(calls, 2);
});

test("refetch(): an unregistered name warns and resolves, doesn't throw", async () => {
  const { R } = freshRuntime();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    await R.refetch("never-queried");
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((w) => w.includes("never-queried")));
});

test("registerSource() + the 'fetch' shorthand: query() can take a config object instead of a function", async () => {
  const { dom, R } = freshRuntime();
  let calledWith = null;
  dom.window.fetch = (url) => {
    calledWith = url;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(["x", "y"]) });
  };
  const run = R.query("users", { source: "fetch", url: "/api/users" });
  await run;
  // Checked AFTER, not with an assert() called from inside the fake
  // fetch itself — an assertion thrown from in there runs under
  // query()'s own try/catch and gets silently absorbed into `.error`
  // instead of failing the test loudly. Caught exactly that way while
  // writing this test.
  assert.strictEqual(calledWith, "/api/users");
  assert.deepStrictEqual(R.val("users").data, ["x", "y"]);
});

test("registerSource(): a custom source (standing in for a Firebase-style adapter) plugs in with no changes to query() itself", async () => {
  const { R } = freshRuntime();
  const fakeDb = { users: ["alice"] };
  R.registerSource("fakeFirebase", {
    get(config) {
      return Promise.resolve(fakeDb[config.path]);
    },
  });
  const run = R.query("users", { source: "fakeFirebase", path: "users" });
  await run;
  assert.deepStrictEqual(R.val("users").data, ["alice"]);
});

test("registerSource(): rejects an adapter with no get() function", () => {
  const { R } = freshRuntime();
  assert.throws(() => R.registerSource("bad", {}), /needs an object with a get/);
});

test("query(): an unknown source name throws a clear error rather than silently doing nothing", () => {
  const { R } = freshRuntime();
  assert.throws(() => R.query("x", { source: "not-registered" }), /unknown source "not-registered"/);
});

report();
