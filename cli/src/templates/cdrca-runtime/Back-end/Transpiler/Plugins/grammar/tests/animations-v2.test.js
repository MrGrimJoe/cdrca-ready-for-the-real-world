// Phase P4: `@id backdrop`, `object`, `prop`, `action`,
// `scene.background`/`scene.gradient` — the animations forms of
// docs/design/LANGUAGE-PLAN.md section 4.3. Each rewrite is checked at the
// desugar() level (exact legacy text) AND, for the ones with runtime
// behaviour, by compiling and comparing byte-for-byte with the legacy form —
// the same two-layer approach grammar.test.js/equivalence.test.js use for
// Quark.
const { test, report, assert } = require("./harness");
const path = require("path");
const G = require("../plugin.js").__internals;
const { desugar, PROP_PATH_PREFIX } = G;
const transpiler = require(path.join(__dirname, "..", "..", "..", "index"));

const norm = (s) => String(s).replace(/(?<=[A-Za-z_])\d{10,}/g, "N").replace(/[0-9]\.[0-9]{6,}/g, "R");
const scene = (body) => `!--- SCENE Main :: m ---\n${body}\n!---END---\n`;
// __internalAllowLegacySyntax: several tests below compile hand-written
// legacy text on purpose, to prove v2 output matches it byte-for-byte —
// see plugin.js's rejectLegacySyntax for why this bypass is safe here.
const compile = (src) => norm(transpiler.transpile({ "index.cdrca": src }, { __internalAllowLegacySyntax: true }));
const errOf = (fn) => { try { fn(); } catch (e) { return e; } throw new Error("expected an error, got none"); };

// ---------------------------------------------------------------- backdrop

test("backdrop: @page (whole page, this file's scene) -> bare `background`", () => {
  assert.strictEqual(desugar("@page backdrop\n"), "background\n");
});

test("backdrop: @id (one element, this file's scene) -> `background <id>`", () => {
  assert.strictEqual(desugar("@hero backdrop\n"), "background hero\n");
});

test('backdrop: @page with a file -> `background from "file"`', () => {
  assert.strictEqual(desugar('@page backdrop "hero-bg.cdrca"\n'), 'background from "hero-bg.cdrca"\n');
});

test('backdrop: @id with a file -> `background <id> from "file"`', () => {
  assert.strictEqual(desugar('@hero backdrop "hero-bg.cdrca"\n'), 'background hero from "hero-bg.cdrca"\n');
});

test("backdrop: qualified `animations.backdrop` rewrites the same way", () => {
  assert.strictEqual(desugar("@hero animations.backdrop\n"), "background hero\n");
});

test("backdrop: the four v2 forms compile identically to their legacy `background` equivalents", () => {
  const pairs = [
    ["@page backdrop", "background"],
    ["@hero backdrop", "background hero"],
    ['@page backdrop "bg.cdrca"', 'background from "bg.cdrca"'],
    ['@hero backdrop "bg.cdrca"', 'background hero from "bg.cdrca"'],
  ];
  for (const [v2, legacy] of pairs) {
    assert.strictEqual(compile(scene(v2)), compile(scene(legacy)), `mismatch for ${v2}`);
  }
});

test("backdrop: an unexpected token after the file path is a build error", () => {
  const e = errOf(() => desugar('@hero backdrop "bg.cdrca" extra\n'));
  assert.match(e.message, /unexpected 'extra'/);
});

test("backdrop: an unquoted value is a build error with a hint", () => {
  const e = errOf(() => desugar("@hero backdrop bg.cdrca\n"));
  assert.match(e.message, /quoted \.cdrca file path/);
});

test("@page is reserved for backdrop — using it with a Quark component is a build error", () => {
  const e = errOf(() => desugar("@page button primary\n"));
  assert.match(e.message, /'@page' is reserved for 'backdrop'/);
});

test("an element literally named 'page' still works for backdrop (target 'page' means whole-page there, by design)", () => {
  // Documented tradeoff: @page always means the whole page for backdrop.
  // Nothing here claims otherwise; this test just pins current behaviour.
  assert.strictEqual(desugar("@page backdrop\n"), "background\n");
});

test("ambiguous bare capability across two plugins names both and suggests qualifying", () => {
  // No two real plugins collide today (animations only has 'backdrop', which
  // no Quark component is named); this exercises the ambiguity branch
  // directly so it's covered even though nothing triggers it yet.
  const saved = G.VOCABULARY.quark.capabilities.backdrop;
  G.VOCABULARY.quark.capabilities.backdrop = { variants: [], defaultVariant: null, modifiers: [] };
  try {
    const e = errOf(() => desugar("@hero backdrop\n"));
    assert.match(e.message, /ambiguous/);
    assert.match(e.message, /quark and animations|animations and quark/);
  } finally {
    if (saved === undefined) delete G.VOCABULARY.quark.capabilities.backdrop;
    else G.VOCABULARY.quark.capabilities.backdrop = saved;
  }
});

// ---------------------------------------------------------------- scene.*

test("scene.background: #rrggbb becomes the legacy 0xRRGGBB literal", () => {
  assert.strictEqual(desugar("scene.background = #1a1a2e\n"), "BGcolor = 0x1a1a2e\n");
});

test("scene.background: #rgb (shorthand) expands", () => {
  assert.strictEqual(desugar("scene.background = #abc\n"), "BGcolor = 0xaabbcc\n");
});

test("scene.background: legacy 0x... passes through unchanged", () => {
  assert.strictEqual(desugar("scene.background = 0x1a1a2e\n"), "BGcolor = 0x1a1a2e\n");
});

test("scene.background: anything else is a build error", () => {
  const e = errOf(() => desugar("scene.background = red\n"));
  assert.match(e.message, /not a colour/);
});

test("scene.gradient: renamed to the legacy gredientMap, value passed through verbatim", () => {
  assert.strictEqual(
    desugar("scene.gradient = { data: [1, 2, 3], width: 3 }\n"),
    "gredientMap = { data: [1, 2, 3], width: 3 }\n"
  );
});

test("scene.background compiles identically to the legacy BGcolor form", () => {
  assert.strictEqual(compile(scene("scene.background = #1a1a2e")), compile(scene("BGcolor = 0x1a1a2e")));
});

// ---------------------------------------------------------------- object

test("object: resolves a known prop name to its full runtime path", () => {
  assert.strictEqual(
    desugar("object ball = BouncingSphere()\n"),
    'use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball\n'
  );
});

test("object: passes constructor arguments through untouched", () => {
  assert.strictEqual(
    desugar("object cube = RotatingCube(#ff0000, 1)\n"),
    "use " + PROP_PATH_PREFIX + "RotatingCubeProp(#ff0000, 1) as cube\n"
  );
});

test("object: an unknown prop name is a build error with a suggestion", () => {
  const e = errOf(() => desugar("object c = RotatingCub()\n"));
  assert.match(e.message, /unknown prop 'RotatingCub'/);
  assert.match(e.message, /RotatingCube/);
});

test("object: compiles identically to the legacy `use ... as` form", () => {
  assert.strictEqual(
    compile(scene("object ball = BouncingSphere()")),
    compile(scene("use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball"))
  );
});

// ---------------------------------------------------------------- prop

test("prop: without abstracts", () => {
  assert.strictEqual(desugar("prop GlowingOrb { this.x = 1; }\n"), "def PROP GlowingOrb { this.x = 1; }\n");
});

test("prop: with abstracts=", () => {
  assert.strictEqual(
    desugar("prop GlowingOrb abstracts=SphereProp { this.x = 1; }\n"),
    "def PROP GlowingOrb abstracts SphereProp { this.x = 1; }\n"
  );
});

test("prop: missing body is a build error", () => {
  const e = errOf(() => desugar("prop GlowingOrb abstracts=SphereProp\n"));
  assert.match(e.message, /expected a '\{ \.\.\. \}' body/);
});

// ---------------------------------------------------------------- action

test("action: stay/lerp in ms become the two legacy statements", () => {
  assert.strictEqual(
    desugar('action bounce stay=2000ms lerp=500ms { ball.modifyMesh("") }\n'),
    'add new action bounce 2000 500\ndef ACTION bounce ball modifyMesh ""\n'
  );
});

test("action: durations given in seconds are converted to ms", () => {
  assert.strictEqual(
    desugar('action bounce stay=2s lerp=0.5s { ball.modifyMesh("") }\n'),
    'add new action bounce 2000 500\ndef ACTION bounce ball modifyMesh ""\n'
  );
});

test("action: order of stay=/lerp= does not matter", () => {
  assert.strictEqual(
    desugar('action bounce lerp=500ms stay=2000ms { ball.modifyMesh("") }\n'),
    'add new action bounce 2000 500\ndef ACTION bounce ball modifyMesh ""\n'
  );
});

test("action: multiple statements in the body (semicolon-separated) become multiple legacy triples", () => {
  assert.strictEqual(
    desugar('action spin stay=1500ms lerp=300ms { cube.modifyMesh(""); ball.modifyMesh("") }\n'),
    'add new action spin 1500 300\ndef ACTION spin cube modifyMesh "" ball modifyMesh ""\n'
  );
});

test("action: missing stay= or lerp= is a build error", () => {
  const e = errOf(() => desugar('action bounce lerp=500ms { ball.modifyMesh("") }\n'));
  assert.match(e.message, /needs both stay= and lerp=/);
});

test("action: a body statement that isn't obj.method(...) is a build error", () => {
  const e = errOf(() => desugar("action bounce stay=1ms lerp=1ms { ball }\n"));
  assert.match(e.message, /isn't '<object>\.<method>\(\.\.\.\)'/);
});

test("action: compiles identically to the legacy add-new-action + def-ACTION pair", () => {
  assert.strictEqual(
    compile(scene('object ball = BouncingSphere()\naction bounce stay=2000ms lerp=500ms { ball.modifyMesh("") }')),
    compile(scene('use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball\nadd new action bounce 2000 500\ndef ACTION bounce ball modifyMesh ""'))
  );
});

// ---------------------------------------------------------------- section 7's worked example, end to end

test("the language plan's hero-bg.cdrca example compiles at all (no throw) with every v2 form combined", () => {
  const src = scene(
    [
      "object c1 = RotatingCube(#3b82f6, 1)",
      "object c2 = RotatingCube(#10b981, 1)",
      'action spin1 stay=2000ms lerp=500ms { c1.modifyMesh("") }',
      'action spin2 stay=1500ms lerp=300ms { c2.modifyMesh("") }',
      "scene.background = #0b1020",
      "@page backdrop",
    ].join("\n")
  );
  assert.doesNotThrow(() => transpiler.transpile({ "index.cdrca": src }));
});

report();
