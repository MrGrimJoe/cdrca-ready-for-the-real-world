const { test, report, assert } = require("./harness");
const path = require("path");
const G = require("../plugin.js").__internals;
const { desugar } = G;
const transpiler = require(path.join(__dirname, "..", "..", "..", "index"));

const norm = (s) => String(s).replace(/(?<=[A-Za-z_])\d{10,}/g, "N").replace(/[0-9]\.[0-9]{6,}/g, "R");
const scene = (body) => `!--- SCENE Main :: m ---\n${body}\n!---END---\n`;
// Passes the internal legacy-comparison bypass (see plugin.js's
// rejectLegacySyntax) since this helper's whole job in this file is
// comparing v2 output against hand-written legacy text — never reachable
// from a real .cdrca file, and a no-op for genuine v2 input either way.
const compile = (src) => norm(transpiler.transpile({ "index.cdrca": src }, { __internalAllowLegacySyntax: true }));
const mountOf = (out) => (out.match(/Quark\.UI\.mount\([^;]*\);/) || ["NONE"])[0];
const errOf = (fn) => { try { fn(); } catch (e) { return e; } throw new Error("expected an error, got none"); };
const first = (s) => s.split("\n")[0];

// ---------------------------------------------------------------- rewrites

test("element rule: variant + modifiers become the dotted chain", () => {
  assert.strictEqual(desugar("@nav navbar glass sticky\n"), "@nav navbar.glass.sticky\n");
});

test("element rule: accent= becomes the legacy '= value' slot", () => {
  assert.strictEqual(desugar("@b button primary accent=#10b981\n"), "@b button.primary = #10b981\n");
});

test("element rule: family= becomes 'family:<name>'", () => {
  assert.strictEqual(desugar("@b button family=soft\n"), "@b button = family:soft\n");
});

test("element rule: legacy 0xRRGGBB colours are accepted and normalised", () => {
  assert.strictEqual(desugar("@b button accent=0x10b981\n"), "@b button = #10b981\n");
});

test("element rule: function-style and named colours pass through", () => {
  assert.strictEqual(desugar("@b button accent=rgb(10, 20, 30)\n"), "@b button = rgb(10, 20, 30)\n");
  assert.strictEqual(desugar("@b button accent=tomato\n"), "@b button = tomato\n");
});

test("element rule: flag order does not matter — the variant always goes first", () => {
  // In the legacy dotted form `button.pill.soft` silently ignores `soft`,
  // because only the FIRST word can be the variant.
  assert.strictEqual(desugar("@b button pill soft\n"), "@b button.soft.pill\n");
  assert.strictEqual(desugar("@b button soft pill\n"), "@b button.soft.pill\n");
});

test("element rule: plugin-qualified component name", () => {
  assert.strictEqual(desugar("@b quark.button primary pill\n"), "@b button.primary.pill\n");
});

test("element rule: a hyphenated id (which legacy Quark cannot carry) becomes an embedded mount call", () => {
  assert.strictEqual(desugar("@hero-banner navbar glass\n"), 'JS { Quark.UI.mount("hero-banner", "navbar", ["glass"]); }\n');
  const out = compile(scene("@hero-banner navbar glass sticky"));
  // Whitespace between arguments is normalised by the JS-block token join, so
  // compare the call, not its spacing.
  assert.strictEqual(mountOf(out).replace(/\s+/g, ""), 'Quark.UI.mount("hero-banner","navbar",["glass","sticky"]);');
});

test("element rule: a hyphenated flag (full-width) is emitted as the direct mount call", () => {
  assert.strictEqual(desugar("@b button primary full-width\n"), 'JS { Quark.UI.mount("b", "button", ["primary","full-width"]); }\n');
  assert.strictEqual(mountOf(compile(scene("@b button primary full-width"))).replace(/\s+/g, ""), 'Quark.UI.mount("b","button",["primary","full-width"]);');
});

test("legacy: the documented dotted form with a hyphenated modifier now compiles (it used to be a parse error)", () => {
  assert.strictEqual(mountOf(compile(scene("@emailInput input.bordered.full-width"))).replace(/\s+/g, ""), 'Quark.UI.mount("emailInput","input",["bordered","full-width"]);');
});

test("element rule: indentation, tabs and a trailing comment survive", () => {
  assert.strictEqual(desugar("  @nav navbar glass // sticky header\n"), "  @nav navbar.glass // sticky header\n");
  assert.strictEqual(desugar("\t@nav navbar glass\n"), "\t@nav navbar.glass\n");
});

test("element rule: works on the last line with no trailing newline, and with CRLF", () => {
  assert.strictEqual(desugar("@nav navbar glass"), "@nav navbar.glass");
  const crlf = desugar("@nav navbar glass\r\nBGcolor = 0x000000\r\n");
  assert.ok(crlf.startsWith("@nav navbar.glass"), crlf);
  assert.ok(crlf.includes("BGcolor = 0x000000"));
});

test("element rule: one-letter ids and names are ordinary names", () => {
  assert.strictEqual(desugar("@x navbar glass\n"), "@x navbar.glass\n");
});

test("directives: require / load / import / js", () => {
  assert.strictEqual(desugar("require quark\n"), "@requires quark\n");
  assert.strictEqual(desugar("require quark, ember\n"), "@requires quark, ember\n");
  assert.strictEqual(desugar("load quark.components\n"), "@useLib quark.components\n");
  assert.strictEqual(desugar('import "story.cdrca"\n'), '@AddImport "story.cdrca"\n');
  assert.strictEqual(desugar("js { console.log(1); }\n"), "JS { console.log(1); }\n");
});

test("line numbers downstream never shift, whatever was rewritten", () => {
  const src = "require quark\njs {\n  a();\n}\n@nav navbar glass\nload quark.components\n@x card elevatedd\n";
  const e = errOf(() => desugar(src));
  assert.strictEqual(e.line, 7, "the error is on line 7 of the ORIGINAL file");
  const ok = desugar(src.replace("elevatedd", "elevated"));
  assert.strictEqual(ok.split("\n").length, src.split("\n").length);
});

test("directives: a multi-line js block keeps its line count", () => {
  const src = "js {\n  const a = 1;\n  const b = 2;\n}\nBGcolor = 0x000000\n";
  const out = desugar(src);
  assert.strictEqual(out.split("\n").length, src.split("\n").length);
  assert.strictEqual(out, "JS {\n  const a = 1;\n  const b = 2;\n}\nBGcolor = 0x000000\n");
});

// ---------------------------------------------------------------- import paths

test("import: with no file context the path passes through exactly as before", () => {
  assert.strictEqual(desugar('import "story.cdrca"\n'), '@AddImport "story.cdrca"\n');
  assert.strictEqual(desugar('import "../x.cdrca"\n'), '@AddImport "../x.cdrca"\n');
});

test("import: web-style paths resolve against the importing file", () => {
  const at = (spec, file) => desugar(`import "${spec}"\n`, file);
  assert.strictEqual(at("bg.cdrca", "src/main.cdrca"), '@AddImport "src/bg.cdrca"\n', "sibling");
  assert.strictEqual(at("./bg.cdrca", "src/main.cdrca"), '@AddImport "src/bg.cdrca"\n', "./ sibling");
  assert.strictEqual(at("../shared/x.cdrca", "src/pages/main.cdrca"), '@AddImport "src/shared/x.cdrca"\n', "parent");
  assert.strictEqual(at("../../top.cdrca", "src/pages/main.cdrca"), '@AddImport "top.cdrca"\n', "up to the root");
  assert.strictEqual(at("/src/bg.cdrca", "src/pages/main.cdrca"), '@AddImport "src/bg.cdrca"\n', "leading / is the project root");
  assert.strictEqual(at("bg.cdrca", "main.cdrca"), '@AddImport "bg.cdrca"\n', "file at the root");
  assert.strictEqual(at("a/./b//c.cdrca", "src/main.cdrca"), '@AddImport "src/a/b/c.cdrca"\n', "dots and doubled slashes");
});

test("import: a path that climbs out of the project is an error with a position", () => {
  const e = errOf(() => desugar('js { a(); }\nimport "../../outside.cdrca"\n', "src/main.cdrca"));
  assert.match(e.message, /goes above the project folder/);
  assert.strictEqual(e.line, 2);
  assert.match(e.message, /"\.\.\/\.\.\/outside\.cdrca"/);
  // ...but at the project root a single ../ is also outside
  assert.match(errOf(() => desugar('import "../x.cdrca"\n', "main.cdrca")).message, /goes above the project folder/);
});

test("import: a sibling inside a subfolder now works end to end (it was 'Path not found' before)", () => {
  const P = "use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0x00ff00, 1) as ";
  const vfs = {
    src: {
      "main.cdrca": `import "bg.cdrca"\n!--- SCENE Main :: m ---\n${P}cubeMain\n!---END---\n`,
      "bg.cdrca": `!--- SCENE Bg :: b ---\n${P}cubeBack\n!---END---\n`,
    },
  };
  const out = String(transpiler.transpile(vfs, { __internalAllowLegacySyntax: true }, ["src/main.cdrca"]));
  assert.ok(/cubeMain/.test(out) && /cubeBack/.test(out), "both scenes present");
});

test("import: a THREE-hop chain resolves each hop against its own file and loses nothing (legacy header @IMPORT drops hops 3+)", () => {
  const P = "use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0x00ff00, 1) as ";
  const sc = (n, pre = "") => `${pre}!--- SCENE Scene${n} :: s${n} ---\n${P}${n}\n!---END---\n`;
  const vfs = {
    "main.cdrca": sc("cubeA", 'import "a/one.cdrca"\n'),
    a: { "one.cdrca": sc("cubeB", 'import "deeper/two.cdrca"\n'), deeper: { "two.cdrca": sc("cubeC", 'import "../three.cdrca"\n') }, "three.cdrca": sc("cubeD") },
  };
  const out = String(transpiler.transpile(vfs, { __internalAllowLegacySyntax: true }, ["main.cdrca"]));
  for (const n of ["cubeA", "cubeB", "cubeC", "cubeD"]) assert.ok(out.includes(n), `${n} missing`);
});

test("legacy: a header @IMPORT chain still loses everything past the first hop (pre-existing; documented, not changed)", () => {
  const P = "use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0x00ff00, 1) as ";
  const sc = (n, imp = "") => `${imp}!--- SCENE Scene${n} :: s${n} ---\n${P}${n}\n!---END---\n`;
  const vfs = { "main.cdrca": sc("cubeA", '@IMPORT "one.cdrca"\n'), "one.cdrca": sc("cubeB", '@IMPORT "two.cdrca"\n'), "two.cdrca": sc("cubeC") };
  const out = String(transpiler.transpile(vfs, { __internalAllowLegacySyntax: true }, ["main.cdrca"]));
  assert.ok(out.includes("cubeA") && out.includes("cubeB"));
  assert.ok(!out.includes("cubeC"), "if this now passes, the legacy limitation is fixed — update docs/guides/V2-SYNTAX.md and this test");
});

test("import: legacy @IMPORT keeps resolving from the project root (unchanged)", () => {
  const P = "use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0x00ff00, 1) as ";
  const vfs = { src: { "main.cdrca": `@IMPORT "src/bg.cdrca"\n!--- SCENE M :: m ---\n${P}cubeMain\n!---END---\n`, "bg.cdrca": `!--- SCENE B :: b ---\n${P}cubeBack\n!---END---\n` } };
  assert.ok(/cubeBack/.test(String(transpiler.transpile(vfs, { __internalAllowLegacySyntax: true }, ["src/main.cdrca"]))));
});

// ---------------------------------------------------------------- untouched

const UNTOUCHED = [
  "@nav navbar.glass.sticky\n",
  "@b button = family:soft\n",
  "@nav navbar\n",
  "@count bind.text = clicks\n",
  "@inc click => count += 1\n",
  "@todoList bind.list = todos using todoItem\n",
  '@IMPORT "a.cdrca"\n', // deliberately still legacy — see docs/design/LANGUAGE-PLAN.md
  "state count = 0\n",
  "BGcolor = 0x1a1a2e\n",
  "JS { const s = '@nav navbar glass'; }\n",
  "// @nav navbar glass\n",
  "/* @nav navbar glass */\nBGcolor = 0x000000\n",
  "",
];
UNTOUCHED.forEach((src) =>
  test(`untouched (same string): ${JSON.stringify(src.slice(0, 44))}`, () => {
    assert.strictEqual(desugar(src), src);
  })
);

// These used to be silently passed through (same as UNTOUCHED above) and
// still compiled via the original legacy parsers underneath this plugin —
// exactly the gap docs/design/LANGUAGE-PLAN.md's "KNOWN ARCHITECTURAL DEBT"
// section describes. Hand-writing any of them is now a build error.
const NOW_A_LEGACY_ERROR = [
  ["@nav navbar.glass = #10b981\n", "@nav navbar.glass = …"],
  ["@requires quark ember\n", "@requires"],
  ["@useLib quark.components\n", "@useLib"],
  ['@AddImport "a.cdrca"\n', "@AddImport"],
  ["def PROP Orb abstracts SphereProp {\n  return 1;\n}\n", "def PROP"],
  ["!--- SCENE Main :: m ---\nuse X() as y\n!---END---\n", "use"],
];
NOW_A_LEGACY_ERROR.forEach(([src, what]) =>
  test(`legacy syntax is now a compile error: ${JSON.stringify(src.slice(0, 40))}`, () => {
    const e = errOf(() => desugar(src));
    assert.match(e.message, /is not v2 syntax/);
    assert.match(e.message, new RegExp(what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // The legacy comparison bypass still lets it through, unchanged —
    // this is what equivalence.test.js/grammar.test.js's own `compile()`
    // relies on to prove v2 output matches legacy output.
    assert.strictEqual(desugar(src, undefined, true), src);
  })
);

test("untouched: v2-looking text inside a comment, a string, or a js body is never rewritten", () => {
  const src = 'js { const s = "@nav navbar glass"; /* @x navbar glass */ }\n// @nav navbar glass\n@nav navbar glass\n';
  const out = desugar(src);
  assert.ok(out.includes('"@nav navbar glass"'), "string inside js body");
  assert.ok(out.includes("/* @x navbar glass */"), "comment inside js body");
  assert.ok(out.includes("// @nav navbar glass\n"), "line comment");
  assert.ok(out.endsWith("@nav navbar.glass\n"), "the real statement is still rewritten");
});

test("scanning: an apostrophe in a comment or an unclosed quote cannot swallow the rest of the file", () => {
  const src = "// don't do this\n@nav navbar glass\n// it's fine\n@b button pill\n";
  assert.strictEqual(desugar(src), "// don't do this\n@nav navbar.glass\n// it's fine\n@b button.pill\n");
});

test("scanning: braces and quotes inside a js body's strings do not end the block early", () => {
  const src = 'js {\n  const s = "}";\n  const t = `{`;\n}\n@nav navbar glass\n';
  assert.strictEqual(desugar(src), 'JS {\n  const s = "}";\n  const t = `{`;\n}\n@nav navbar.glass\n');
});

test("nothing to rewrite returns the very same string", () => {
  const s = "@nav navbar.glass\nstate x = 0\n";
  assert.strictEqual(desugar(s), s);
});

// ---------------------------------------------------------------- errors

test("error: unknown component suggests the near miss and hints at `require`", () => {
  const e = errOf(() => desugar("@n navbr glass\n"));
  assert.match(e.message, /unknown component 'navbr' — did you mean 'navbar'\?/);
  assert.match(e.message, /require <plugin>/);
});

test("error: unknown flag suggests the near miss and lists what exists", () => {
  const e = errOf(() => desugar("@nav navbar glas\n"));
  assert.match(first(e.message), /unknown flag 'glas' for navbar — did you mean 'glass'\?/);
  assert.match(e.message, /variants: .*glass/);
  assert.match(e.message, /modifiers: .*sticky/);
});

test("error: line and column point at the offending word, with a caret line", () => {
  const src = "// header\nrequire quark\n@nav navbar glass stickyy\n";
  const e = errOf(() => desugar(src));
  assert.strictEqual(e.line, 3);
  assert.strictEqual(e.column, src.split("\n")[2].indexOf("stickyy") + 1);
  assert.match(e.message, /^line 3, column 19:/);
  assert.match(e.message, /3 \| @nav navbar glass stickyy/);
  assert.match(e.message, /\^{7}/, "one caret per character of the word");
});

test("error: the position is right even after earlier statements were rewritten", () => {
  const src = "@a navbar glass\n@b button pill\n@c card elevatedd\n";
  const e = errOf(() => desugar(src));
  assert.strictEqual(e.line, 3);
});

test("error: unknown option, empty option, repeated option, bad colour, unknown family", () => {
  assert.match(errOf(() => desugar("@b button accnt=#fff\n")).message, /unknown option 'accnt' for button — did you mean 'accent'\?/);
  assert.match(errOf(() => desugar("@b button accent=\n")).message, /expected a value after 'accent='/);
  assert.match(errOf(() => desugar("@b button accent=#fff accent=#000\n")).message, /'accent' is given twice/);
  assert.match(errOf(() => desugar("@b button accent=#12\n")).message, /'#12' is not a colour/);
  assert.match(errOf(() => desugar("@b button family=sof\n")).message, /unknown family 'sof' — did you mean 'soft'\?/);
});

test("error: spaced option is caught with the fix spelled out", () => {
  assert.match(errOf(() => desugar("@b button accent = red\n")).message, /write options without spaces: accent=value/);
});

test("error: two variants, a repeated flag, a quoted value, punctuation", () => {
  assert.match(errOf(() => desugar("@b button primary soft\n")).message, /one variant, and you gave two: 'primary' and 'soft'/);
  assert.match(errOf(() => desugar("@b button pill pill\n")).message, /'pill' is given twice/);
  assert.match(errOf(() => desugar('@b button "Save"\n')).message, /doesn't take a text value/);
  assert.match(errOf(() => desugar("@b button pill,soft\n")).message, /unexpected 'pill,soft'/);
});

test("error: an event or wiring word used as a component gets a message that says what to write", () => {
  assert.match(errOf(() => desugar("@b click save\n")).message, /'click' is an event, not a component/);
  assert.match(errOf(() => desugar("@b bind text\n")).message, /'bind' is written with a dot and a value/);
});

test("error: accent= and family= together are refused, not silently reduced to one", () => {
  assert.match(errOf(() => desugar("@b button accent=#fff family=soft\n")).message, /can't be combined/);
});

test("error: require / load / import misuse", () => {
  assert.match(errOf(() => desugar("require\n")).message, /needs at least one plugin name/);
  assert.match(errOf(() => desugar("require quark,\n")).message, /needs at least one plugin name/);
  assert.match(errOf(() => desugar("load quark\n")).message, /is not a <plugin>\.<library> name/);
  assert.match(errOf(() => desugar("load\n")).message, /needs a library/);
  assert.match(errOf(() => desugar("import story.cdrca\n")).message, /needs a quoted file path/);
});

test("error: reaches the caller of transpile() with its message and position intact", () => {
  const e = errOf(() => transpiler.transpile({ "index.cdrca": scene("@nav navbar glas") }));
  assert.match(e.message, /line \d+, column \d+: unknown flag 'glas'/);
});

// ---------------------------------------------------------------- end to end

test("end to end: require/load/import compile exactly like their legacy spellings", () => {
  const cube = "use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0xff0000, 1) as cubeMain\n";
  const legacy = `@useLib quark.components\n${scene(cube)}`;
  const v2 = `load quark.components\n${scene(cube)}`;
  assert.strictEqual(compile(v2), compile(legacy));
});

test("end to end: load of an unknown library is reported by the owning plugin", () => {
  const e = errOf(() => compile("load quark.nope\n" + scene("")));
  assert.match(e.message, /unknown library "quark\.nope"/);
});

test("end to end: legacy and v2 can be mixed in one file", () => {
  const cube = "use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0xff0000, 1) as cubeMain\n";
  const mixed = scene(`${cube}@nav navbar.glass\n@b button primary pill`);
  const legacy = scene(`${cube}@nav navbar.glass\n@b button.primary.pill`);
  assert.strictEqual(compile(mixed), compile(legacy));
});

test("end to end: js { } compiles like JS { }", () => {
  const cube = "use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0xff0000, 1) as cubeMain\n";
  assert.strictEqual(compile(scene(`${cube}js { window.x = 1; }`)), compile(scene(`${cube}JS { window.x = 1; }`)));
});

// ---------------------------------------------------------------- registry
// The registry is the contract the plugin packager classifies against, so
// its shape and ordering are pinned here.

test("registry: the base grammar registers exactly today's rules, in today's order", () => {
  assert.deepStrictEqual(G.createBaseRegistry().describe(), {
    element: [{ name: "elementRule", owner: "base" }],
    statement: [
      { name: "directive", owner: "base" },
      { name: "animationsDeclaration", owner: "base" },
      { name: "settingStatement", owner: "base" },
      { name: "campfireStatement", owner: "base" },
    ],
    guard: [{ name: "rejectLegacySyntax", owner: "base" }],
    declarations: [],
  });
});

test("registry: an added statement rule runs after every base rule and is tagged with its owner", () => {
  const reg = G.createBaseRegistry();
  reg.register("statement", "shout", (ctx, unit, text) => (/^shout\s/.test(text) ? "state shouted = 1" : null), "my-plugin");
  assert.deepStrictEqual(reg.describe().statement.slice(-1), [{ name: "shout", owner: "my-plugin" }]);
  assert.strictEqual(desugar("shout hello\n", undefined, false, reg), "state shouted = 1\n");
});

test("registry: a base rule still wins over an added rule that claims the same text", () => {
  const reg = G.createBaseRegistry();
  reg.register("statement", "greedy", () => "// greedy", "my-plugin");
  assert.strictEqual(desugar("require quark\n", undefined, false, reg), "@requires quark\n");
});

test("registry: without an added rule, the same text is unclaimed and left alone (default registry unaffected)", () => {
  const reg = G.createBaseRegistry();
  reg.register("statement", "shout", () => "state shouted = 1", "my-plugin");
  assert.strictEqual(desugar("shout hello\n"), "shout hello\n");
});

test("registry: registering the same name twice in one list is an error", () => {
  const reg = G.createBaseRegistry();
  const e = errOf(() => reg.register("statement", "directive", () => null, "my-plugin"));
  assert.match(e.message, /already registered in the statement list/);
});

test("registry: an unknown list name and a non-function rule are errors", () => {
  const reg = G.createRegistry();
  assert.match(errOf(() => reg.register("nope", "x", () => null)).message, /unknown list 'nope'/);
  assert.match(errOf(() => reg.register("statement", "x", "not a fn")).message, /must be a function/);
});

test("registry: an added guard runs only for unclaimed statements, and is skipped under the internal bypass", () => {
  const reg = G.createBaseRegistry();
  reg.register("guard", "noPanic", (ctx, unit, text) => { if (/^panic\b/.test(text)) throw new Error("no panic"); return null; }, "my-plugin");
  assert.match(errOf(() => desugar("panic now\n", undefined, false, reg)).message, /no panic/);
  assert.strictEqual(desugar("panic now\n", undefined, true, reg), "panic now\n");
});

report();
