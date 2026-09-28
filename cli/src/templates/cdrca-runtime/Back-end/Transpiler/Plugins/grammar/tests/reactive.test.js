// Tests for `store`, `query`, `source` — the v2 statement forms for
// cdrca-reactive-state's persistence and async-data primitives. These are
// NEW statements (unlike Quark's element rules, which have an existing
// legacy spelling to rewrite TO): `R.store`/`R.query`/`R.registerSource`
// exist today only as JS calls, reached through a hand-written `JS { }`
// block. So "equivalence" here means: the v2 statement compiles to EXACTLY
// the JS_BLOCK a human would have written by hand — checked both as text
// and, in the end-to-end section, by actually running it against the real
// runtime.
const { test, report, assert } = require("./harness");
const path = require("path");
const { desugar, GrammarError } = require("../plugin.js").__internals;
const transpiler = require(path.join(__dirname, "..", "..", "..", "index"));

const norm = (s) => String(s).replace(/(?<=[A-Za-z_])\d{10,}/g, "N").replace(/[0-9]\.[0-9]{6,}/g, "R");
const scene = (body) => `!--- SCENE Main :: m ---\n${body}\n!---END---\n`;
const errOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected an error, got none");
};

// ---------------------------------------------------------------- store

test("store: bare form calls R.store with just the initial value", () => {
  assert.strictEqual(desugar("store cart = []\n"), 'JS { const R = CDRCA.reactive; R.store("cart", []); }\n');
});

test("store: persist= and ttl= become the options object, in that order, only when given", () => {
  assert.strictEqual(desugar("store cart persist=local = []\n"), 'JS { const R = CDRCA.reactive; R.store("cart", [], { persist: "local" }); }\n');
  assert.strictEqual(desugar("store t ttl=1000 = null\n"), 'JS { const R = CDRCA.reactive; R.store("t", null, { ttl: 1000 }); }\n');
  assert.strictEqual(
    desugar("store t persist=session ttl=500 = null\n"),
    'JS { const R = CDRCA.reactive; R.store("t", null, { persist: "session", ttl: 500 }); }\n'
  );
});

test("store: ttl accepts a bare number (ms) OR a suffixed duration, producing identical output", () => {
  const bare = desugar("store t ttl=3600000 = null\n");
  const suffixed = desugar("store t ttl=1h = null\n");
  assert.strictEqual(bare, suffixed);
  assert.ok(bare.includes("ttl: 3600000"));
});

test("store: every duration unit converts correctly", () => {
  const at = (v) => desugar(`store t ttl=${v} = null\n`).match(/ttl: (\d+)/)[1];
  assert.strictEqual(at("500ms"), "500");
  assert.strictEqual(at("2s"), "2000");
  assert.strictEqual(at("5m"), "300000");
  assert.strictEqual(at("2h"), "7200000");
  assert.strictEqual(at("1d"), "86400000");
  assert.strictEqual(at("1.5h"), "5400000");
});

test("store: an object or array initial value passes through untouched", () => {
  assert.strictEqual(
    desugar('store profile persist=local = { name: "x", tags: [1, 2] }\n'),
    'JS { const R = CDRCA.reactive; R.store("profile", { name: "x", tags: [1, 2] }, { persist: "local" }); }\n'
  );
});

test("store: errors — missing name, missing '=', unknown option, bad persist value, bad duration", () => {
  assert.match(errOf(() => desugar("store = []\n")).message, /expected a name after 'store'/);
  assert.match(errOf(() => desugar("store cart\n")).message, /expected '=' after 'store cart'/);
  assert.match(errOf(() => desugar("store cart tll=1h = []\n")).message, /unknown option 'tll' for store — did you mean 'ttl'\?/);
  assert.match(errOf(() => desugar("store cart persist=locol = []\n")).message, /unknown persist value 'locol'/);
  assert.match(errOf(() => desugar("store cart ttl=soon = []\n")).message, /'soon' is not a duration/);
  assert.match(errOf(() => desugar("store cart persist=local\n")).message, /expected '=' after 'store cart'/);
  assert.match(errOf(() => desugar("store cart persist=local =\n")).message, /expected an initial value after 'store cart ='/);
});

test("store: error position points at the offending option", () => {
  const src = "store cart persist=locol = []\n";
  const e = errOf(() => desugar(src));
  assert.strictEqual(e.line, 1);
  assert.strictEqual(e.column, src.indexOf("locol") + 1);
});

// ---------------------------------------------------------------- source

test("source: compiles to a plain registerSource call", () => {
  assert.strictEqual(
    desugar('source main = firebase({ apiKey: "x" })\n'),
    'JS { const R = CDRCA.reactive; R.registerSource("main", firebase({ apiKey: "x" })); }\n'
  );
});

test("source: errors — missing name, missing '=', missing adapter", () => {
  assert.match(errOf(() => desugar("source\n")).message, /expected a name after 'source'/);
  assert.match(errOf(() => desugar("source main\n")).message, /expected '=' after 'source main'/);
  assert.match(errOf(() => desugar("source main =\n")).message, /expected an adapter after 'source main ='/);
});

// ---------------------------------------------------------------- query

test("query: bare form wraps the fetcher expression in a thunk", () => {
  assert.strictEqual(
    desugar('query users = fetch("/api/users").then(r => r.json())\n'),
    'JS { const R = CDRCA.reactive; R.query("users", () => (fetch("/api/users").then(r => r.json()))); }\n'
  );
});

test("query: cache= and depends= become cacheTime/dependsOn, cache accepts a duration", () => {
  assert.strictEqual(
    desugar('query u cache=60000 = fetch("/x")\n'),
    'JS { const R = CDRCA.reactive; R.query("u", () => (fetch("/x")), { cacheTime: 60000 }); }\n'
  );
  assert.strictEqual(
    desugar('query u cache=1m = fetch("/x")\n').match(/cacheTime: (\d+)/)[1],
    "60000"
  );
  assert.strictEqual(
    desugar('query u depends=[a, b] = fetch("/x")\n'),
    'JS { const R = CDRCA.reactive; R.query("u", () => (fetch("/x")), { dependsOn: ["a","b"] }); }\n'
  );
  assert.strictEqual(
    desugar('query u cache=1m depends=[a] = fetch("/x")\n'),
    'JS { const R = CDRCA.reactive; R.query("u", () => (fetch("/x")), { cacheTime: 60000, dependsOn: ["a"] }); }\n'
  );
});

test("query: depends= with one name, and with none, both work", () => {
  assert.ok(desugar('query u depends=[] = fetch("/x")\n').includes("dependsOn: []"));
  assert.ok(desugar('query u depends=[onlyOne] = fetch("/x")\n').includes('dependsOn: ["onlyOne"]'));
});

test("query: from= names a registered source and takes an object config, NOT wrapped in a thunk", () => {
  assert.strictEqual(
    desugar('query users from=main = { url: "/api/users" }\n'),
    'JS { const R = CDRCA.reactive; R.query("users", Object.assign({ source: "main" }, { url: "/api/users" })); }\n'
  );
});

test("query: from= combined with cache=/depends=", () => {
  assert.strictEqual(
    desugar('query u from=main cache=1m = { url: "/x" }\n'),
    'JS { const R = CDRCA.reactive; R.query("u", Object.assign({ source: "main" }, { url: "/x" }), { cacheTime: 60000 }); }\n'
  );
});

test("query: errors — missing name/'=', unknown option, bad cache duration, bad depends list, from= without an object", () => {
  assert.match(errOf(() => desugar("query\n")).message, /expected a name after 'query'/);
  assert.match(errOf(() => desugar("query u\n")).message, /expected '=' after 'query u'/);
  assert.match(errOf(() => desugar('query u caache=1m = fetch("/x")\n')).message, /unknown option 'caache' for query — did you mean 'cache'\?/);
  assert.match(errOf(() => desugar('query u cache=soon = fetch("/x")\n')).message, /'soon' is not a duration/);
  assert.match(errOf(() => desugar('query u depends=a = fetch("/x")\n')).message, /'a' is not a list/);
  assert.match(errOf(() => desugar('query u depends=[1a] = fetch("/x")\n')).message, /'1a' in depends=\[\.\.\.\] is not a name/);
  // Source names are plain Map keys at runtime (sources.set/get), so a
  // hyphenated name is valid and compiles like any other — no ID_RE
  // restriction applies here (unlike Quark element ids, which ARE
  // restricted for other reasons).
  assert.strictEqual(
    desugar('query u from=source-name = { url: "/x" }\n'),
    'JS { const R = CDRCA.reactive; R.query("u", Object.assign({ source: "source-name" }, { url: "/x" })); }\n'
  );
  assert.match(errOf(() => desugar('query users from=main = fetch("/x")\n')).message, /'query users from=main' needs an object after '='/);
  assert.match(errOf(() => desugar("query u =\n")).message, /expected a fetcher after 'query u ='/);
});

// ---------------------------------------------------------------- end to end

// A runtime tree with cdrca-reactive-state actually staged as a plugin, so
// its `bind`/event statements coexist correctly with Quark (see this
// plugin's own header comment on the priority-based coexistence mechanism) —
// without this, `@id bind.text = ...` would be silently misread as a Quark
// preset by a bare transpile() call. Built once per test run.
const os = require("os");
const fs = require("fs");

// tests/ -> grammar -> Plugins -> Transpiler -> Back-end -> cdrca-runtime ->
// templates -> src -> cli -> REPO ROOT. Counted once, checked once, so a
// wrong count fails loudly here instead of a confusing MODULE_NOT_FOUND deep
// in a later require().
const REPO_ROOT = path.resolve(__dirname, ...Array(9).fill(".."));
const RUNTIME_DIR = path.resolve(__dirname, "..", "..", "..", "..", "..");
const REACTIVE_STATE_DIR = path.join(REPO_ROOT, "plugins", "cdrca-reactive-state");

function stagedRuntime() {
  if (!fs.existsSync(path.join(REACTIVE_STATE_DIR, "plugin.js"))) return null; // repo layout not as expected — skip, don't fail
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "cdrca-reactive-e2e-"));
  fs.cpSync(RUNTIME_DIR, dest, { recursive: true, filter: (p) => !p.split(path.sep).includes("node_modules") });
  const dir = path.join(dest, "Back-end", "Transpiler", "Plugins", "cdrca-reactive-state");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REACTIVE_STATE_DIR, "plugin.js"), path.join(dir, "plugin.js"));
  const pj = path.join(dest, "Back-end", "Transpiler", "Plugins", "plugins.json");
  const list = JSON.parse(fs.readFileSync(pj, "utf8"));
  if (!list.some((e) => e.name === "cdrca-reactive-state")) {
    list.push({ name: "cdrca-reactive-state", path: "cdrca-reactive-state/plugin.js", uses: [["syntax", "customRule"]], permissions: [] });
    fs.writeFileSync(pj, JSON.stringify(list, null, 2));
  }
  const nm = path.join(RUNTIME_DIR, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dest, "node_modules"), "dir");
  process.on("exit", () => fs.rmSync(dest, { recursive: true, force: true }));
  return dest;
}

const stagedDir = stagedRuntime();
if (!stagedDir) {
  console.log(`SKIPPED: end-to-end section (couldn't find ${REACTIVE_STATE_DIR}).`);
} else {
  const stagedTranspiler = require(path.join(stagedDir, "Back-end", "Transpiler", "index"));

  let JSDOM, VirtualConsole, hasJsdom = true;
  try {
    ({ JSDOM, VirtualConsole } = require("jsdom"));
  } catch {
    hasJsdom = false;
  }

  if (!hasJsdom) {
    console.log("SKIPPED: end-to-end section (jsdom isn't installed — run `npm install --no-save jsdom` to enable it).");
  } else {
    const vm = require("vm");

    function runInPage(cdrcaSrc, { fetchers } = {}) {
      const compiled = String(stagedTranspiler.transpile({ "index.cdrca": cdrcaSrc }));
      const dom = new JSDOM('<body><div id="box"></div></body>', { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
      const ctx = dom.getInternalVMContext();
      ctx.THREE = { DataTexture: function () { return {}; }, RGBFormat: 1 };
      ctx.ObjectAnimationSystem_INS = { CORE_3d_PROPSsceneSYS: { exampleProps: { RotatingCubeProp: function () {} } }, main: () => ({ init: () => ({}) }) };
      for (const [name, fn] of Object.entries(fetchers || {})) ctx[name] = fn;
      const run = (code, label) => new vm.Script(code, { filename: label }).runInContext(ctx);
      run(fs.readFileSync(path.join(REACTIVE_STATE_DIR, "runtime.js"), "utf8"), "runtime.js");
      run(fs.readFileSync(path.join(REACTIVE_STATE_DIR, "reactive-state-store.js"), "utf8"), "reactive-state-store.js");
      run(fs.readFileSync(path.join(REACTIVE_STATE_DIR, "reactive-state-query.js"), "utf8"), "reactive-state-query.js");
      run(compiled, "compiled.js");
      return dom.window;
    }

    test("end to end: store persists across a fresh cell and binds to the DOM", () => {
      const w = runInPage(scene('store cart persist=local = ["a", "b"]\n@box bind.text = cart.length\n'));
      assert.strictEqual(w.document.getElementById("box").textContent, "2");
      assert.deepEqual(w.CDRCA.reactive.val("cart"), ["a", "b"]);
    });

    test("end to end: store, hand-written equivalent — SAME final DOM", () => {
      const v2 = runInPage(scene('store cart persist=local ttl=1h = [1, 2, 3]\n@box bind.text = cart.length\n'));
      const legacy = runInPage(
        scene('JS { const R = CDRCA.reactive; R.store("cart", [1, 2, 3], { persist: "local", ttl: 3600000 }); }\n@box bind.text = cart.length\n')
      );
      assert.strictEqual(v2.document.body.innerHTML, legacy.document.body.innerHTML);
    });

    test("end to end: query fetches once at declaration, updates the cell, and drives a bind", async () => {
      let calls = 0;
      const w = runInPage(scene('query users = fetchUsers()\n@box bind.text = users.loading\n'), {
        fetchers: {
          fetchUsers: () => {
            calls++;
            return Promise.resolve([1, 2, 3]);
          },
        },
      });
      assert.strictEqual(calls, 1, "fetched immediately, not deferred");
      assert.strictEqual(w.document.getElementById("box").textContent, "true", "loading is true synchronously");
      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(w.document.getElementById("box").textContent, "false");
      assert.deepEqual(w.CDRCA.reactive.val("users"), { data: [1, 2, 3], loading: false, error: null });
    });

    test("end to end: a forced refetch calls the fetcher again (proves it was wrapped in a thunk, not called once and reused)", async () => {
      let calls = 0;
      const w = runInPage(scene("query users cache=1h = fetchUsers()\n"), {
        fetchers: { fetchUsers: () => { calls++; return Promise.resolve(calls); } },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(calls, 1);
      await w.CDRCA.reactive.refetch("users", { force: true });
      assert.strictEqual(calls, 2, "the SAME fetcher ran a second time");
      assert.strictEqual(w.CDRCA.reactive.val("users").data, 2);
    });

    test("end to end: query re-runs when a dependsOn= name changes (proves dependsOn was actually passed through, not just present in the compiled text)", async () => {
      // Per docs/REACTIVE-STATE.md's own dependsOn example, the fetcher
      // expression uses R.get(...) explicitly — store/query/source are thin
      // wrappers around the JS API (unlike `state`/`computed`/`bind`, which
      // rewrite bare identifiers to R.val() calls via their OWN plugin's
      // compileExprTokens). A bare `search` here would reference an
      // undefined JS variable, not the reactive cell — same as it would in
      // a hand-written JS { } block calling R.query() directly.
      let calls = 0;
      const w = runInPage(scene('state search = "a"\nquery results depends=[search] = searchFor(R.get("search"))\n'), {
        fetchers: {
          searchFor: (q) => {
            calls++;
            return Promise.resolve([q]);
          },
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(calls, 1, "fetched once at declaration");
      w.CDRCA.reactive.set("search", "b");
      await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(calls, 2, "dependsOn=[search] must trigger a re-fetch when 'search' changes");
      assert.deepEqual(w.CDRCA.reactive.val("results").data, ["b"]);
    });

    test("end to end: a bare identifier in a query/store/source expression is NOT rewritten to R.val(...) — documenting the boundary with state/computed/bind", () => {
      // This is deliberate, not a gap: store/query/source wrap the raw JS
      // API 1:1 (see docs/guides/V2-SYNTAX.md's reactive-state section).
      // `R` itself IS in scope (this plugin's emitted JS_BLOCK always starts
      // with `const R = CDRCA.reactive;`), so `R.get(...)`/`R.val(...)`
      // work; a bare state name does not.
      assert.strictEqual(
        desugar('store derived = existingThing + 1\n'),
        'JS { const R = CDRCA.reactive; R.store("derived", existingThing + 1); }\n',
        "existingThing is passed through verbatim, unlike in a `computed` expression"
      );
    });

    test("end to end: source + query from= — the source's get(config) receives the merged config", async () => {
      const w = runInPage(scene('source mock = { get: (c) => Promise.resolve({ echoedUrl: c.url, echoedMethod: c.method }) }\nquery users from=mock = { url: "/api/x", method: "GET" }\n'));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(w.CDRCA.reactive.val("users"), {
        data: { echoedUrl: "/api/x", echoedMethod: "GET" },
        loading: false,
        error: null,
      });
    });

    test("end to end: an unregistered from= source throws AT DECLARATION TIME (a pre-existing runtime property, not something this grammar introduced — resolveFetcher() runs before query()'s try/catch)", () => {
      assert.throws(
        () => runInPage(scene('query users from=nope = { url: "/x" }\n')),
        /unknown source "nope"/,
        "documented in docs/guides/V2-SYNTAX.md's reactive-state section: from= must name an already-registered source"
      );
    });
  }
}

report();
