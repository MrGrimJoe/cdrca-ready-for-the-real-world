const { test, report, assert } = require("./harness");
const { defaultTokenizer } = require("cdrca/Back-end/Transpiler/Tokenizer.js");
const plugin = require("../plugin.js");
const { emberCustomRule } = plugin.__internals;

function parseFrom(source) {
  const tokens = defaultTokenizer(source);
  return emberCustomRule(undefined, { tokens, pos: 0, token: tokens[0] });
}

function code(source) {
  const result = parseFrom(source);
  assert.ok(result, `expected a JS_BLOCK for: ${source}`);
  assert.strictEqual(result.type, "JS_BLOCK");
  return result.prams.code;
}

test("fx: preset only, no modifiers, no params", () => {
  assert.strictEqual(code("fx heroCard bounce\n"), 'Ember.play("heroCard", "bounce", [], undefined);');
});

test("fx: one modifier", () => {
  assert.strictEqual(
    code("fx heroCard bounce.elastic\n"),
    'Ember.play("heroCard", "bounce", ["elastic"], undefined);'
  );
});

test("fx: multiple modifiers", () => {
  assert.strictEqual(
    code("fx title shake.strong.decay\n"),
    'Ember.play("title", "shake", ["strong","decay"], undefined);'
  );
});

test("fx: 'with' a plain number", () => {
  assert.strictEqual(
    code("fx title shake.strong with 400\n"),
    'Ember.play("title", "shake", ["strong"], (400));'
  );
});

test("fx: 'with' an object literal — real tokenizer splits every punctuation char into its own token, readRawUntilNewline must still reassemble valid JS", () => {
  assert.strictEqual(
    code("fx box slideUp with { distance: 40 }\n"),
    'Ember.play("box", "slideUp", [], ({distance:40}));'
  );
});

test("fx: single-character element id (tokenizer .type-corruption edge case, same class of bug found building campfire)", () => {
  assert.strictEqual(code("fx x bounce\n"), 'Ember.play("x", "bounce", [], undefined);');
});

test("fx: missing element id throws", () => {
  assert.throws(() => parseFrom("fx bounce\n"), /expected an element id after 'fx'\b|expected a preset name/);
});

test("fx: missing preset name throws", () => {
  assert.throws(() => parseFrom("fx heroCard\n"), /expected a preset name/);
});

test("fx: '.' with nothing after it throws", () => {
  assert.throws(() => parseFrom("fx heroCard bounce.\n"), /expected a modifier name/);
});

test("fx: 'with' with nothing after it throws", () => {
  assert.throws(() => parseFrom("fx heroCard bounce with\n"), /expected parameters/);
});

test("dispatcher: unrelated statement is declined, not consumed", () => {
  assert.strictEqual(parseFrom("state count = 0\n"), undefined);
  assert.strictEqual(parseFrom('def PROP GlowingOrb {\n}\n'), undefined);
});

test("dispatcher: a higher-priority plugin's node is never overridden", () => {
  const tokens = defaultTokenizer("fx heroCard bounce\n");
  const alreadyClaimed = { type: "JS_BLOCK", prams: { code: "/* someone else's */" }, newPosition: 3 };
  assert.strictEqual(emberCustomRule(alreadyClaimed, { tokens, pos: 0, token: tokens[0] }), undefined);
});

test("newPosition lands right at the trailing newline (same convention every other plugin in this ecosystem uses)", () => {
  const src = "fx heroCard bounce.elastic\nfx title shake\n";
  const tokens = defaultTokenizer(src);
  const result = emberCustomRule(undefined, { tokens, pos: 0, token: tokens[0] });
  const rest = tokens.slice(result.newPosition).filter((t) => t.value !== "\n");
  assert.strictEqual(rest[0].value, "fx");
});

report();
