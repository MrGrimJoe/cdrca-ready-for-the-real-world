// Every Quark component × every variant × every modifier, written in the v2
// syntax, must compile to EXACTLY what the equivalent legacy dotted statement
// compiles to. The component list is read from the plugin's vocabulary, which
// vocabulary.test.js proves matches the live registry — so a new component or
// modifier is covered here the moment the generator runs.
const { test, report, assert } = require("./harness");
const path = require("path");
const { VOCABULARY } = require("../plugin.js").__internals;
const transpiler = require(path.join(__dirname, "..", "..", "..", "index"));

const norm = (s) => String(s).replace(/(?<=[A-Za-z_])\d{10,}/g, "N").replace(/[0-9]\.[0-9]{6,}/g, "R");
const scene = (body) => `!--- SCENE Main :: m ---\n${body}\n!---END---\n`;
// Inside a Quark.UI.mount(...) call only, ignore the space after each comma:
// a hyphenated name takes the direct-mount path, which goes through the JS
// block's token join and so prints `["a","b"]` where the dotted path prints
// `["a", "b"]`. Every other byte of the output must still match exactly.
const canon = (s) => s.replace(/Quark\.UI\.mount\(([^;]*?)\);/g, (m, a) => "Quark.UI.mount(" + a.replace(/,\s+/g, ",") + ");");
// __internalAllowLegacySyntax: this file's whole point is compiling legacy
// text directly to prove v2 produces byte-identical output — see
// plugin.js's rejectLegacySyntax for why that bypass is safe here and not
// reachable from a real .cdrca file.
const compile = (line) => canon(norm(transpiler.transpile({ "index.cdrca": scene(line) }, { __internalAllowLegacySyntax: true })));

const comps = Object.entries(VOCABULARY.quark.capabilities);

test("the vocabulary has every Quark component (27 at time of writing)", () => {
  assert.ok(comps.length >= 27, `only ${comps.length} components`);
});

let cases = 0;
for (const [name, def] of comps) {
  test(`${name}: every flag combination compiles identically to the legacy dotted form`, () => {
    const { variants, modifiers } = def;
    const combos = [];
    combos.push({ v: null, m: [] });
    for (const v of variants) combos.push({ v, m: [] });
    for (const m of modifiers) combos.push({ v: null, m: [m] });
    for (const v of variants) for (const m of modifiers) combos.push({ v, m: [m] });
    if (modifiers.length > 1) for (const v of [null, ...variants.slice(0, 1)]) combos.push({ v, m: modifiers });

    for (const { v, m } of combos) {
      const legacyChain = (v ? [v] : []).concat(m).map((x) => "." + x).join("");
      for (const [tail, legacyTail] of [
        ["", ""],
        [" accent=#10b981", " = #10b981"],
        [" family=soft", " = family:soft"],
      ]) {
        const legacy = `@target ${name}${legacyChain}${legacyTail}`;
        // Variant first, then variant LAST — order must not matter.
        for (const flags of [[...(v ? [v] : []), ...m], [...m, ...(v ? [v] : [])]]) {
          const v2 = `@target ${name}${flags.length ? " " + flags.join(" ") : ""}${tail}`;
          assert.strictEqual(compile(v2), compile(legacy), `${v2}   vs   ${legacy}`);
          cases++;
        }
      }
    }
  });
}

test("(summary) how many v2/legacy pairs were compared", () => {
  assert.ok(cases > 1000, `expected well over 1000 comparisons, ran ${cases}`);
  console.log(`      ${cases} v2/legacy pairs compared across ${comps.length} components`);
});

report();
