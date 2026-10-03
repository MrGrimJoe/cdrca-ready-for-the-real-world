// Transpiler-level tests for Quark's plugin.js — specifically `@useLib`,
// which had NO test coverage anywhere in the repo before this file. That
// gap is exactly how a real regression shipped silently: `parseUseLib`
// read a hyphenated plugin name (`cdrca-reactive-state`) as just `cdrca`
// and then choked on the `-`, because the tokenizer splits every
// punctuation character into its own token and `parseUseLib` only ever
// consumed a single identifier token for the plugin name. The existing
// test file at Plugins/quark/test/quark.test.js only covers the
// front-end runtime (quark-core.js/quark-components.js/...); this file
// covers the back-end transpiler plugin (this directory's plugin.js),
// which is a different file entirely and had nothing testing it.
//
// Run with: node tests/run.js (or via tools/verify-all.sh)

const { test, report, assert } = require("./harness");
const { defaultTokenizer } = require("../../../Tokenizer.js");
const plugin = require("../plugin.js");
const { quarkCustomRule } = plugin.__internals;

function parseFrom(source) {
  const tokens = defaultTokenizer(source);
  return quarkCustomRule(undefined, { tokens, pos: 0, token: tokens[0] });
}

function code(source) {
  const result = parseFrom(source);
  assert.ok(result, `expected a JS_BLOCK for: ${source}`);
  assert.strictEqual(result.type, "JS_BLOCK");
  return result.prams.code;
}

// ---- @useLib, plain (single-word) plugin names ---------------------------

test("useLib: quark.components (a real, valid library)", () => {
  assert.strictEqual(code("@useLib quark.components\n"), 'Quark.__declareLib("quark", "components");');
});

test("useLib: quark.templates", () => {
  assert.strictEqual(code("@useLib quark.templates\n"), 'Quark.__declareLib("quark", "templates");');
});

test("useLib: an unknown quark.* library name is a clear build error", () => {
  assert.throws(() => code("@useLib quark.nope\n"), /unknown library "quark\.nope"/);
});

test("useLib: a single-word non-quark plugin name is accepted without validation", () => {
  // quarkCustomRule only validates bundle names when pluginName === "quark"
  // — a different plugin's own plugin.js is responsible for validating
  // its own libraries.
  assert.strictEqual(code("@useLib ember.presets\n"), 'Quark.__declareLib("ember", "presets");');
});

// ---- @useLib, hyphenated plugin names (the regression) --------------------
// The tokenizer emits `cdrca-reactive-state` as five tokens: `cdrca`, `-`,
// `reactive`, `-`, `state`. Every one of these must be re-joined into a
// single plugin name before looking for the "." that starts the library.

test("useLib: a hyphenated plugin name (cdrca-reactive-state.store)", () => {
  assert.strictEqual(
    code("@useLib cdrca-reactive-state.store\n"),
    'Quark.__declareLib("cdrca-reactive-state", "store");'
  );
});

test("useLib: a hyphenated plugin name (cdrca-reactive-state.query)", () => {
  assert.strictEqual(
    code("@useLib cdrca-reactive-state.query\n"),
    'Quark.__declareLib("cdrca-reactive-state", "query");'
  );
});

test("useLib: a plugin name with a single hyphen (two words)", () => {
  assert.strictEqual(code("@useLib my-plugin.thing\n"), 'Quark.__declareLib("my-plugin", "thing");');
});

test("useLib: a plugin name with three hyphenated segments", () => {
  assert.strictEqual(
    code("@useLib a-b-c-d.lib\n"),
    'Quark.__declareLib("a-b-c-d", "lib");'
  );
});

test("useLib: the error message for a missing library name reconstructs the full hyphenated plugin name", () => {
  // Before the fix, this error would have read
  // "expected a plugin name after '@useLib'" against just "cdrca" — the
  // wrong diagnosis entirely, pointing the author at the wrong problem.
  assert.throws(
    () => code("@useLib cdrca-reactive-state\n"),
    /expected '\.<libraryName>' after '@useLib cdrca-reactive-state'/
  );
});

test("useLib: a trailing hyphen with nothing after it does not consume the hyphen", () => {
  // "foo-" followed by end-of-line (or a "." with no identifier before
  // it) must not silently swallow the dangling "-" into the plugin name;
  // isIdentifierLike(tokens[p+1]) guards exactly this.
  assert.throws(() => code("@useLib foo-\n"), /expected '\.<libraryName>' after '@useLib foo'/);
});

// ---- load <plugin>.<library> (the v2-syntax rewrite of @useLib) ----------
// docs/SYNTAX.md documents `load plugin.library` as the v2 spelling; the
// grammar plugin rewrites it to `@useLib plugin.library` before handing it
// to Quark. Covering the rewritten form here too, since that's the form
// every real .cdrca file actually uses, not the legacy `@useLib` spelling
// directly.

test("useLib: the rewritten form of `load cdrca-reactive-state.store` compiles", () => {
  // grammar/plugin.js's rewrite happens upstream of this plugin; this
  // test calls quarkCustomRule directly with the @useLib form it
  // produces, confirming Quark's own half of that pipeline is correct
  // regardless of grammar's rewrite (which has its own test coverage in
  // Plugins/grammar/tests/).
  assert.strictEqual(
    code("@useLib cdrca-reactive-state.store\n"),
    'Quark.__declareLib("cdrca-reactive-state", "store");'
  );
});

report();
