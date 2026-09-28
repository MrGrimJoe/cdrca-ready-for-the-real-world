// The vocabulary embedded in plugin.js is generated from the REAL component
// registries. This test regenerates it in memory and fails if the embedded
// copy has drifted — so adding a Quark modifier without running
// `node tools/generate-vocabulary.js` cannot go unnoticed.
let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  console.log("SKIPPED: jsdom isn't installed — run `npm install jsdom` to enable this file.");
  process.exit(0);
}
const { test, report, assert } = require("./harness");
const fs = require("fs");
const path = require("path");
const { VOCABULARY } = require("../plugin.js").__internals;

const tool = path.resolve(__dirname, ...Array(9).fill(".."), "tools", "generate-vocabulary.js");
if (!fs.existsSync(tool)) {
  console.log("SKIPPED: tools/generate-vocabulary.js isn't reachable from here (this copy isn't inside the repo).");
  process.exit(0);
}
const { extractQuark, extractAnimationsProps, ANIMATIONS_CAPABILITIES } = require(tool);

test("embedded quark vocabulary equals the live registry", () => {
  assert.deepStrictEqual(VOCABULARY.quark, extractQuark(JSDOM));
});

test("embedded animations props table equals Renderer.js's exampleProps registry", () => {
  assert.deepStrictEqual(VOCABULARY.animations.props, extractAnimationsProps());
});

test("embedded animations capabilities match the fixed backdrop shape", () => {
  assert.deepStrictEqual(VOCABULARY.animations.capabilities, ANIMATIONS_CAPABILITIES);
});

test("the registry has what the docs promise: 27 components, 3 families", () => {
  assert.strictEqual(Object.keys(VOCABULARY.quark.capabilities).length, 27);
  assert.deepStrictEqual(VOCABULARY.quark.families.sort(), ["bold", "soft", "structured"]);
});

test("a component with no variants (sidebar) treats every flag as a modifier", () => {
  assert.deepStrictEqual(VOCABULARY.quark.capabilities.sidebar.variants, []);
  assert.ok(VOCABULARY.quark.capabilities.sidebar.modifiers.length > 0);
});

report();
