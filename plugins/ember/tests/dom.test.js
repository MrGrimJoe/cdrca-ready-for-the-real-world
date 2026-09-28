// A real DOM-level smoke test — jsdom, not a fake {style:{}} object —
// covering the full pipeline: tokenize a real `fx` statement, compile it
// through plugin.js, eval the generated code against ember-core.js +
// ember-presets.js + ember-easings.js running on a real document, and
// confirm actual computed style changes. Requires `npm install jsdom` (a
// devDependency, not shipped) — prints SKIPPED and exits cleanly if it
// isn't installed, same convention campfire's ui.test.js uses.
let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  console.log("SKIPPED: jsdom isn't installed — run `npm install jsdom` to enable this file.");
  process.exit(0);
}

const { test, report, assert } = require("./harness");
const { defaultTokenizer } = require("cdrca/Back-end/Transpiler/Tokenizer.js");
const { emberCustomRule } = require("../plugin.js").__internals;

const dom = new JSDOM('<!doctype html><html><body><div id="heroCard"></div></body></html>', {
  pretendToBeVisual: true,
  // runScripts is what makes dom.window.eval() share the SAME realm as
  // properties this test assigns onto dom.window from the host side
  // (window.Ember, set by requiring ember-core.js below) — without it,
  // jsdom's eval() runs in an isolated context where a bare `Ember`
  // reference is a ReferenceError even though `dom.window.Ember` exists
  // as a plain property. Confirmed directly: this test's first attempt,
  // without this option, failed exactly that way.
  runScripts: "dangerously",
});
global.window = dom.window;
global.document = dom.window.document;
// Deliberately not touching global.setTimeout/setInterval here — jsdom's
// own window provides real ones, and pointing Node's global timers at
// jsdom's bound versions makes jsdom recurse into itself (the exact bug
// campfire's ui.test.js hit and documents).

require("../ember-core.js");
const Ember = dom.window.Ember;
require("../ember-easings.js");
require("../ember-presets.js");

function compileAndRun(source) {
  const tokens = defaultTokenizer(source);
  const result = emberCustomRule(undefined, { tokens, pos: 0, token: tokens[0] });
  assert.ok(result, `expected plugin.js to compile: ${source}`);
  // Runs against jsdom's own window (not Node's global) — the generated
  // code references the bare identifier `Ember`, which only resolves
  // correctly as `window.Ember` the way it would in a real browser page.
  // Indirect eval (`(0, eval)(...)`) runs against Node's global instead
  // and can't see it — confirmed directly, that was this test's first,
  // wrong attempt.
  return dom.window.eval(result.prams.code);
}

test("a real 'fx' statement, compiled and run against a real DOM element, actually mutates its style", async () => {
  const el = dom.window.document.getElementById("heroCard");
  assert.strictEqual(el.style.opacity, "");

  const donePromise = compileAndRun('fx heroCard fadeIn with { duration: 0 }\n');
  await donePromise;

  assert.strictEqual(el.style.opacity, "1");
});

test("an unknown element id logs a warning and resolves without throwing, through the real compiled pipeline", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    await compileAndRun('fx doesNotExist bounce\n');
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((w) => w.includes("doesNotExist")));
});

test("a full preset + easing combination runs end to end and settles at the expected final style", async () => {
  const el = dom.window.document.getElementById("heroCard");
  const donePromise = compileAndRun('fx heroCard spin.double with { duration: 0 }\n');
  await donePromise;
  assert.strictEqual(el.style.transform, "rotate(720.00deg)");
});

report();
