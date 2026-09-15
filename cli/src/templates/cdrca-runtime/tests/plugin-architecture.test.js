// Real integration tests, no mocks — runs the actual transpiler.transpile()
// pipeline bundled in this template (cli/src/templates/cdrca-runtime).
//
// Covers:
//  1. animations grammar now works as a real ("syntax","customRule") plugin
//  2. Parser.js's hardcoded switch still works as a graceful fallback when
//     the animations plugin is absent from plugins.json
//  3. animations + quark plugins coexist in one file, and Quark's JS_BLOCK
//     output actually survives to the final transpiled code
//  4. joinTokenValues() no longer breaks hex literals (0xff0000) into
//     invalid JS ("0 xff0000") — bug found and fixed while adding the
//     animations plugin, unrelated to the plugin-unification work itself

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TRANSPILER_INDEX = path.resolve(__dirname, "../Back-end/Transpiler/index.js");
const PLUGINS_JSON = path.resolve(__dirname, "../Back-end/Transpiler/Plugins/plugins.json");

function withPluginsConfig(list, fn) {
  const original = fs.readFileSync(PLUGINS_JSON, "utf-8");
  fs.writeFileSync(PLUGINS_JSON, JSON.stringify(list, null, 4));
  try {
    return fn();
  } finally {
    fs.writeFileSync(PLUGINS_JSON, original);
  }
}

function runTranspileInSubprocess(cdrcaCode) {
  const script = `
    const transpiler = require(${JSON.stringify(TRANSPILER_INDEX)});
    const code = ${JSON.stringify(cdrcaCode)};
    try {
      const result = transpiler.transpile({ "index.cdrca": code }, {});
      let validJS = true, jsError = null;
      try { new Function(result); } catch (e) { validJS = false; jsError = e.message; }
      process.stdout.write(JSON.stringify({ ok: true, result, validJS, jsError }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
    }
  `;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }));
}

const DEMO_CODE = `!--- SCENE Main :: Bouncing balls demo ---

use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1
use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0xff0000, 1) as cube

add new action bounce1 2000 500
add new action spin 1500 300

def ACTION bounce1 ball1 modifyMesh ""
def ACTION spin cube modifyMesh ""

!---END---
`;

const COMBINED_CODE = `!--- SCENE Main :: Mixed animations + Quark test ---

use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1

add new action bounce1 2000 500

def ACTION bounce1 ball1 modifyMesh ""

@mySidebar sidebar.closable.edgy = open

!---END---
`;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

console.log("plugin-architecture.test.js");

test("animations plugin produces valid JS for the demo file (incl. hex literal)", () => {
  withPluginsConfig(
    [
      { name: "animations", path: "animations/plugin.js", uses: [["syntax", "customRule"]], permissions: [] },
      { name: "quark", path: "quark/plugin.js", uses: [["syntax", "customRule"]], permissions: [] },
    ],
    () => {
      const { ok, result, validJS, jsError, error } = runTranspileInSubprocess(DEMO_CODE);
      assert.ok(ok, `transpile failed: ${error}`);
      assert.ok(result.includes("ObjectAnimationSystem_INS.main(OAS_OBJ).init"));
      assert.ok(result.includes("RotatingCubeProp(0xff0000,1)"), "hex literal join bug regressed");
      assert.ok(validJS, `output is not valid JS: ${jsError}`);
    }
  );
});

test("with the animations plugin absent, Parser.js's fallback switch still handles animation grammar", () => {
  withPluginsConfig(
    [{ name: "quark", path: "quark/plugin.js", uses: [["syntax", "customRule"]], permissions: [] }],
    () => {
      const { ok, result, validJS, jsError, error } = runTranspileInSubprocess(DEMO_CODE);
      assert.ok(ok, `transpile failed: ${error}`);
      assert.ok(result.includes("ObjectAnimationSystem_INS.main(OAS_OBJ).init"));
      assert.ok(validJS, `fallback output is not valid JS: ${jsError}`);
    }
  );
});

test("animations + quark coexist: both directive types appear in one file's output", () => {
  withPluginsConfig(
    [
      { name: "animations", path: "animations/plugin.js", uses: [["syntax", "customRule"]], permissions: [] },
      { name: "quark", path: "quark/plugin.js", uses: [["syntax", "customRule"]], permissions: [] },
    ],
    () => {
      const { ok, result, validJS, jsError, error } = runTranspileInSubprocess(COMBINED_CODE);
      assert.ok(ok, `transpile failed: ${error}`);
      assert.ok(result.includes("ObjectAnimationSystem_INS.main(OAS_OBJ).init"), "animation output missing");
      assert.ok(
        result.includes('Quark.UI.mount("mySidebar", "sidebar", ["closable","edgy"], "open")'),
        "Quark JS_BLOCK output missing — JS_BLOCK dropping regression"
      );
      assert.ok(validJS, `combined output is not valid JS: ${jsError}`);
    }
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
