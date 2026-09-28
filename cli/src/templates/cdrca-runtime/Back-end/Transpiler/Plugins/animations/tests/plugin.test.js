const { test, report, assert } = require("./harness");
// The bundled tokenizer — the one that actually runs — not the published npm
// package's copy, which can differ.
const { defaultTokenizer } = require("../../../Tokenizer.js");
const plugin = require("../plugin.js");
const { animationsCustomRule } = plugin.__internals;

function parseFrom(source) {
  const tokens = defaultTokenizer(source);
  return animationsCustomRule(undefined, { tokens, pos: 0, token: tokens[0] });
}

function code(source) {
  const result = parseFrom(source);
  assert.ok(result, `expected a node for: ${source}`);
  assert.strictEqual(result.type, "JS_BLOCK");
  return result.prams.code;
}

// ---- existing statements still work (none of these had a dedicated
// test file before this change — added here as a smoke-check that
// adding the "background" case to the same switch didn't disturb any
// existing one, not as a full spec of animations' own pre-existing
// grammar) ------------------------------------------------------------

test("existing: BGcolor still parses to a BGCOLOR node, unaffected by the new case", () => {
  const result = parseFrom("BGcolor = 0x1a1a2e\n");
  assert.ok(result);
  assert.strictEqual(result.type, "BGCOLOR");
  assert.strictEqual(result.prams.value, "0x1a1a2e");
});

test("existing: gredientMap still parses to a GREDIENT_MAP node", () => {
  const result = parseFrom("gredientMap = someGradient\n");
  assert.strictEqual(result.type, "GREDIENT_MAP");
});

test("existing: 'def ACTION' and 'def PROP' still dispatch correctly, untouched by the new 'background' case", () => {
  const actionResult = parseFrom('def ACTION bounce1 ball1 modifyMesh ""\n');
  assert.ok(actionResult);
  assert.notStrictEqual(actionResult.type, "JS_BLOCK", "def ACTION has its own native node type, not JS_BLOCK");

  const propResult = parseFrom("def PROP GlowingOrb {\n}\n");
  assert.ok(propResult);
});

test("existing: 'use ... as' still dispatches to parsePropUse, not swallowed by anything new", () => {
  const result = parseFrom("use SomeProp() as thing\n");
  assert.ok(result);
  assert.strictEqual(result.type, "PROP_USE");
});

// ---- background [<id>] [from "<file>.cdrca"] -------------------------

const RM = (target) => `OAS_OBJ.renderMode = {"mode":"background","target":${JSON.stringify(target)}};`;
const ATTACH = (target, path) =>
  `Backdrop.attach(${JSON.stringify(target)}, Backdrop.programUrl(${JSON.stringify(path)}));`;

test("background: bare — this file's own scene behind the whole page", () => {
  assert.strictEqual(code("background\n"), RM(null));
});

test("background <id>: this file's own scene behind one element", () => {
  assert.strictEqual(code("background heroSection\n"), RM("heroSection"));
});

test("background from \"file\": another file's scene behind the whole page", () => {
  assert.strictEqual(code('background from "bg.cdrca"\n'), ATTACH(null, "bg.cdrca"));
});

test("background <id> from \"file\": another file's scene behind one element", () => {
  assert.strictEqual(code('background heroSection from "bg.cdrca"\n'), ATTACH("heroSection", "bg.cdrca"));
});

test("background: a leading '#' on the id is accepted, like a CSS selector", () => {
  assert.strictEqual(code("background #heroSection\n"), RM("heroSection"));
  assert.strictEqual(code('background #hero from "a.cdrca"\n'), ATTACH("hero", "a.cdrca"));
});

test("background: hyphenated and underscored ids", () => {
  assert.strictEqual(code("background hero-banner\n"), RM("hero-banner"));
  assert.strictEqual(code("background _hero_2\n"), RM("_hero_2"));
});

test("background: single-character id (the .type-corruption tokenizer bug, same class found across every plugin in this series)", () => {
  assert.strictEqual(code("background x\n"), RM("x"));
  assert.strictEqual(code('background x from "a.cdrca"\n'), ATTACH("x", "a.cdrca"));
});

test("background: works as the last line of a file with no trailing newline", () => {
  assert.strictEqual(code("background heroSection"), RM("heroSection"));
  assert.strictEqual(code('background from "bg.cdrca"'), ATTACH(null, "bg.cdrca"));
});

test("background from: './' prefix is dropped, nested project paths are kept", () => {
  assert.strictEqual(code('background from "./bg.cdrca"\n'), ATTACH(null, "bg.cdrca"));
  assert.strictEqual(code('background hero from "src/backgrounds/stars.cdrca"\n'), ATTACH("hero", "src/backgrounds/stars.cdrca"));
});

test("background: the parser consumes exactly its own line — the next statement is untouched", () => {
  const src = 'background hero from "a.cdrca"\nBGcolor = 0x000000\n';
  const tokens = defaultTokenizer(src);
  const node = animationsCustomRule(undefined, { tokens, pos: 0, token: tokens[0] });
  const rest = tokens[node.newPosition];
  assert.ok(rest && rest.value === "\n", "newPosition must stop AT the newline, like every other statement");
});

test("background: an id with spaces is rejected with a message that says what an id is", () => {
  assert.throws(() => parseFrom("background hero banner\n"), /not a valid element id/);
});

test("background: an id that starts with a digit is rejected", () => {
  assert.throws(() => parseFrom("background 2hero\n"), /not a valid element id/);
});

test("background from: missing file path throws", () => {
  assert.throws(() => parseFrom("background from\n"), /expected a quoted \.cdrca file path/);
  assert.throws(() => parseFrom("background hero from\n"), /expected a quoted \.cdrca file path/);
});

test("background from: an unquoted path throws", () => {
  assert.throws(() => parseFrom("background from bg.cdrca\n"), /expected a quoted \.cdrca file path/);
});

test("background from: trailing garbage throws instead of being silently ignored", () => {
  assert.throws(() => parseFrom('background hero from "a.cdrca" oops\n'), /unexpected token/);
});

test("background from: only .cdrca files — a JS module (the old v5 form) gets a clear error", () => {
  assert.throws(() => parseFrom('background hero from "./particles.js"\n'), /doesn't end in \.cdrca/);
});

test("background from: paths must stay inside the project", () => {
  assert.throws(() => parseFrom('background from "../outside.cdrca"\n'), /inside this project/);
  assert.throws(() => parseFrom('background from "a/../../b.cdrca"\n'), /inside this project/);
  assert.throws(() => parseFrom('background from "/etc/x.cdrca"\n'), /not a URL or absolute path/);
  assert.throws(() => parseFrom('background from "https://x.test/a.cdrca"\n'), /not a URL or absolute path/);
  assert.throws(() => parseFrom('background from "a\\\\b.cdrca"\n'), /forward slashes/);
});

test("background: everything old still reaches its own case, and unrelated statements are declined", () => {
  assert.notStrictEqual(parseFrom("def PROP TestOrb {\n}\n").type, "JS_BLOCK");
  assert.strictEqual(parseFrom("use TestProp() as thing\n").type, "PROP_USE");
  assert.strictEqual(parseFrom("state count = 0\n"), undefined);
  assert.strictEqual(parseFrom("fx hero bounce\n"), undefined, "ember's verb is not ours");
  assert.strictEqual(parseFrom("say aria \"hi\"\n"), undefined, "campfire's verb is not ours");
});

test("dispatcher: a higher-priority plugin's node is never overridden", () => {
  const tokens = defaultTokenizer('background x from "a.cdrca"\n');
  const alreadyClaimed = { type: "JS_BLOCK", prams: { code: "/* someone else's */" }, newPosition: 3 };
  assert.strictEqual(animationsCustomRule(alreadyClaimed, { tokens, pos: 0, token: tokens[0] }), undefined);
});

report();
