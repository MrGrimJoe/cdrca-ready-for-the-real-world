const { test, report, assert } = require("./harness");
const { defaultTokenizer } = require("cdrca/Back-end/Transpiler/Tokenizer.js");
const plugin = require("../plugin.js");
const { campfireCustomRule } = plugin.__internals;

// Simulates how Parser.js drives the customRule hook: it calls the
// registered callback once per token position with {tokens, pos, token}.
// Same pattern cdrca-reactive-state's own tests use, against the same
// real tokenizer — not hand-built fake tokens.
function parseFrom(source, startPos = 0) {
  const tokens = defaultTokenizer(source);
  const pos = startPos;
  const token = tokens[pos];
  return campfireCustomRule(undefined, { tokens, pos, token });
}

function code(source, startPos = 0) {
  const result = parseFrom(source, startPos);
  assert.ok(result, `expected a JS_BLOCK for: ${source}`);
  assert.strictEqual(result.type, "JS_BLOCK");
  return result.prams.code;
}

// ---- def SPEAKER ----------------------------------------------------------

test("def SPEAKER: happy path with a 0xRRGGBB color", () => {
  assert.strictEqual(
    code('def SPEAKER hero name "Aria" color 0xffcc00\n'),
    'Campfire.defineSpeaker("hero", { name: "Aria", color: (0xffcc00) });'
  );
});

test("def SPEAKER: regression — 0x-prefixed color really does tokenize as TWO tokens ('0' and 'xffcc00'), readRawUntilNewline must still reassemble it exactly", () => {
  // Verified directly against the real tokenizer, not assumed — see
  // plugin.js's readRawUntilNewline comment for why this plugin never
  // assumes a color value is a single token, the same defensive stance
  // Quark's own plugin.js takes for its '= <value>' parsing.
  const tokens = defaultTokenizer("def SPEAKER hero name \"Aria\" color 0xffcc00\n");
  const colorTokens = tokens.filter((t) => /^(0|xffcc00)$/.test(t.value));
  assert.strictEqual(colorTokens.length, 2, "expected the real tokenizer to split 0xffcc00 into two tokens");
});

test("def SPEAKER: single-character speaker id (tokenizer .type-corruption edge case)", () => {
  // Regression for the documented CDRCA Tokenizer.js bug: a single-char
  // token's `.type` gets overwritten with the type of whatever follows
  // it. Confirmed directly: in `say x "hi"`, `x`'s `.type` comes back as
  // "string" (the type of the token after it), not "identifier" — this
  // plugin must never trust `.type`, only the shape of `.value`.
  assert.strictEqual(
    code('def SPEAKER x name "X" color 0x000000\n'),
    'Campfire.defineSpeaker("x", { name: "X", color: (0x000000) });'
  );
});

test("def SPEAKER: not SPEAKER -> declines so 'def ACTION'/'def PROP' reach the animations plugin untouched", () => {
  assert.strictEqual(parseFrom("def ACTION bounce1 ball1 modifyMesh \"\"\n"), undefined);
  assert.strictEqual(parseFrom('def PROP GlowingOrb {\n}\n'), undefined);
});

test("def SPEAKER: missing name keyword throws", () => {
  assert.throws(() => parseFrom('def SPEAKER hero "Aria" color 0xfff\n'), /expected 'name'/);
});

test("def SPEAKER: missing color keyword throws", () => {
  assert.throws(() => parseFrom('def SPEAKER hero name "Aria" 0xfff\n'), /expected 'color'/);
});

test("def SPEAKER: missing color value throws", () => {
  assert.throws(() => parseFrom('def SPEAKER hero name "Aria" color\n'), /expected a color value/);
});

// ---- say --------------------------------------------------------------

test("say: happy path, no wait", () => {
  assert.strictEqual(
    code('say hero "Is someone there?"\n'),
    'Campfire.say("hero", "Is someone there?");'
  );
});

test("say: with an explicit wait", () => {
  assert.strictEqual(
    code('say hero "Is someone there?" wait 1500\n'),
    'Campfire.say("hero", "Is someone there?", { wait: 1500 });'
  );
});

test("say: single-character speaker id (tokenizer edge case, real regression)", () => {
  assert.strictEqual(code('say x "hi"\n'), 'Campfire.say("x", "hi");');
});

test("say: missing speaker id throws", () => {
  assert.throws(() => parseFrom('say "hi"\n'), /expected a speaker id/);
});

test("say: missing quoted line throws", () => {
  assert.throws(() => parseFrom("say hero hi\n"), /expected a quoted line/);
});

test("say: 'wait' without a number throws", () => {
  assert.throws(() => parseFrom('say hero "hi" wait\n'), /expected a number of milliseconds/);
});

// ---- choice -------------------------------------------------------------

test("choice: happy path, two options", () => {
  const src =
    'choice hero "What do you say?"\n' +
    'option "Stay quiet" -> stayQuiet\n' +
    'option "Call out" -> callOut\n' +
    "end choice\n";
  assert.strictEqual(
    code(src),
    'Campfire.choice("hero", "What do you say?", [{ label: "Stay quiet", signal: "stayQuiet" }, { label: "Call out", signal: "callOut" }]);'
  );
});

test("choice: allows blank lines between options", () => {
  const src =
    'choice hero "Well?"\n' +
    "\n" +
    'option "Yes" -> yes\n' +
    "\n" +
    "end choice\n";
  assert.strictEqual(
    code(src),
    'Campfire.choice("hero", "Well?", [{ label: "Yes", signal: "yes" }]);'
  );
});

test("choice: newPosition lands right after 'end choice' (before its trailing newline, same convention Quark's own plugin.js uses) — a following statement is untouched", () => {
  const src =
    'choice hero "Well?"\n' +
    'option "Yes" -> yes\n' +
    "end choice\n" +
    'say hero "Good."\n';
  const tokens = defaultTokenizer(src);
  const result = campfireCustomRule(undefined, { tokens, pos: 0, token: tokens[0] });
  assert.ok(result);
  const rest = tokens.slice(result.newPosition).filter((t) => t.value !== "\n");
  assert.strictEqual(rest[0].value, "say");
});

test("choice: zero options throws", () => {
  assert.throws(() => parseFrom('choice hero "Well?"\nend choice\n'), /needs at least one 'option'/);
});

test("choice: missing 'end choice' throws instead of reading past the end of the file", () => {
  assert.throws(
    () => parseFrom('choice hero "Well?"\noption "Yes" -> yes\n'),
    /missing its closing 'end choice'/
  );
});

test("choice: malformed line inside the block throws with a clear message", () => {
  assert.throws(
    () => parseFrom('choice hero "Well?"\nsay hero "oops"\nend choice\n'),
    /expected 'option' or 'end choice'/
  );
});

// ---- dispatcher ---------------------------------------------------------

test("dispatcher: unrelated statement is declined, not consumed", () => {
  assert.strictEqual(parseFrom('state count = 0\n'), undefined);
});

test("dispatcher: a higher-priority plugin's node is never overridden", () => {
  const tokens = defaultTokenizer('say hero "hi"\n');
  const alreadyClaimed = { type: "JS_BLOCK", prams: { code: "/* someone else's */" }, newPosition: 3 };
  assert.strictEqual(campfireCustomRule(alreadyClaimed, { tokens, pos: 0, token: tokens[0] }), undefined);
});

report();
