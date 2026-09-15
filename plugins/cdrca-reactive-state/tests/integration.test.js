// Full-pipeline integration test: our plugin.js, staged exactly the way
// `cdrca install` stages an ecosystem plugin (Plugins/<name>/plugin.js +
// plugins.json), loaded through CDRCA's REAL plugin.js host and run
// through the REAL Transpiler/index.js — not a mock of either.
//
// This needs a local checkout of a CDRCA version that has the plugin-hook
// system (Back-end/Transpiler/plugin.js) — the published npm package does
// not yet (see docs/REACTIVE-STATE.md). Point CDRCA_RUNTIME_PATH at such a
// checkout to run this test; otherwise it prints why it's skipping and
// exits 0 (this is the one test file allowed to skip — plugin.test.js and
// runtime.test.js never need an external checkout).
//
// This test ALSO applies (in-memory, on the checkout's own files — see the
// warning below) the patches documented in
// cli/src/fulltranspiler_patch.rs, cli/src/parser_spacing_patch.rs, and
// cli/src/js_block_semicolon_patch.rs, since without them nothing reaches
// the generated output at all, or reaches it corrupted. Real projects get
// these from `cdrca create`.

const fs = require("fs");
const path = require("path");
const { test, report, assert } = require("./harness");

const RUNTIME_PATH = process.env.CDRCA_RUNTIME_PATH;

if (!RUNTIME_PATH) {
  console.log(
    "SKIPPED: set CDRCA_RUNTIME_PATH to a local checkout of a CDRCA version with the plugin-hook " +
      "system (Back-end/Transpiler/plugin.js) to run the full pipeline integration test."
  );
  report();
  process.exit(0);
}

const transpilerDir = path.join(RUNTIME_PATH, "Back-end", "Transpiler");
const fullTranspilerPath = path.join(transpilerDir, "FullTranspiler.js");
const pluginHostPath = path.join(transpilerDir, "plugin.js");
const pluginsDir = path.join(transpilerDir, "Plugins");

function ensurePatched(filePath, checks) {
  let src = fs.readFileSync(filePath, "utf8");
  for (const { find, replace, alreadyDoneMarker } of checks) {
    if (src.includes(alreadyDoneMarker)) continue;
    if (!src.includes(find)) {
      throw new Error(`integration test setup: expected snippet not found in ${filePath}: ${find}`);
    }
    src = src.replace(find, replace);
  }
  fs.writeFileSync(filePath, src);
}

// NOTE: this mutates the checkout at CDRCA_RUNTIME_PATH on disk (idempotent
// — safe to run repeatedly). Point CDRCA_RUNTIME_PATH at a disposable
// checkout, not one you care about keeping pristine.
ensurePatched(fullTranspilerPath, [
  {
    find: '      errorsLOGS: [],\n      scenes: [],\n    };',
    replace: '      errorsLOGS: [],\n      scenes: [],\n      JS_BLOCK: [],\n    };',
    alreadyDoneMarker: "JS_BLOCK: []",
  },
  {
    find:
      'placeholder: ["ACTION_DEF", "PROP_DEF", "PROP_USE", "ACTION_USE"],\n      toString: general3DastToSTRplaceholder,',
    replace:
      'placeholder: ["ACTION_DEF", "PROP_DEF", "PROP_USE", "ACTION_USE", "JS_BLOCK"],\n      toString: general3DastToSTRplaceholder,',
    alreadyDoneMarker: '"ACTION_DEF", "PROP_DEF", "PROP_USE", "ACTION_USE", "JS_BLOCK"',
  },
]);
// The plugin-host register-convention patch that used to run here has
// been REMOVED. It doesn't apply to this repo: this repo's real
// Back-end/Transpiler/plugin.js already calls
// `exported(sandboxedPlugin, exposedAPI)` where `sandboxedPlugin` is
// `{ register: fn }`, and every plugin.js here (Quark, and this plugin)
// is written to match — `module.exports = function (pluginAPI) {
// pluginAPI.register(...) }`. Applying that old patch would swap the
// object for a bare function and break `pluginAPI.register(...)` in every
// plugin, Quark included — see docs/REACTIVE-STATE.md's bug #3 note.
ensurePatched(path.join(transpilerDir, "Parser.js"), [
  {
    // Bug #5 (docs/REACTIVE-STATE.md): six `.join("")` call sites glue
    // adjacent token values together with no separator, corrupting any
    // raw JS recaptured from a JS_BLOCK or PROP_DEF body ("function
    // foo(){ return 1; }" -> "functionfoo(){return1;}"). Inserts the
    // shared `joinTokenValues()` helper and rewrites each site to call
    // it instead of `.join("")` directly. Also excludes the bare-digit +
    // x/X-led-identifier pairing (a hex literal like 0xff0000, tokenized
    // as "0" then "xff0000") from the space-insertion rule — the naive
    // word-boundary check alone corrupts that into invalid JS
    // ("0 xff0000"), found while adding an "animations" plugin that
    // relies on this same helper.
    find: 'const parserConstructor = function (defaultTokenizer, pluginAPI) {',
    replace:
      'function joinTokenValues(tokens) {\n' +
      '  const isWordChar = (c) => !!c && /[A-Za-z0-9_$]/.test(c);\n' +
      '  const endsInBareDigits = (s) => /(?:^|[^0-9A-Za-z_$])[0-9]+$/.test(s);\n' +
      '  const isHexContinuation = (s) => /^[xX][0-9a-fA-F]*$/.test(s);\n' +
      '  return tokens.reduce((acc, t) => {\n' +
      '    const value = String(t.value);\n' +
      '    const prevChar = acc[acc.length - 1];\n' +
      '    if (\n' +
      '      acc.length > 0 &&\n' +
      '      isWordChar(prevChar) &&\n' +
      '      isWordChar(value[0]) &&\n' +
      '      !(endsInBareDigits(acc) && isHexContinuation(value))\n' +
      '    ) {\n' +
      '      return acc + " " + value;\n' +
      '    }\n' +
      '    return acc + value;\n' +
      '  }, "");\n' +
      '}\n\n' +
      'const parserConstructor = function (defaultTokenizer, pluginAPI) {',
    alreadyDoneMarker: "function joinTokenValues(tokens) {",
  },
  {
    find: 'const body = bodyTokens.map((t) => t.value).join("");',
    replace: 'const body = joinTokenValues(bodyTokens);',
    alreadyDoneMarker: "const body = joinTokenValues(bodyTokens);",
  },
  {
    find: 'const prams = pramsTokens.map((t) => t.value).join("");',
    replace: 'const prams = joinTokenValues(pramsTokens);',
    alreadyDoneMarker: "const prams = joinTokenValues(pramsTokens);",
  },
  {
    find: 'const value = valueTokens.map((t) => t.value).join("");',
    replace: 'const value = joinTokenValues(valueTokens);',
    alreadyDoneMarker: "const value = joinTokenValues(valueTokens);",
  },
  {
    find: 'const value = commentTokens.map((t) => t.value).join("");',
    replace: 'const value = joinTokenValues(commentTokens);',
    alreadyDoneMarker: "const value = joinTokenValues(commentTokens);",
  },
]);
// The two `codeTokens` sites (JS_BLOCK, PROP_DEF) share identical source
// text, so they need their own counted pass — `String.replace` with a
// plain string only ever hits the first match.
(function patchCodeTokensSites() {
  let src = fs.readFileSync(path.join(transpilerDir, "Parser.js"), "utf8");
  const find = 'const code = codeTokens.map((t) => t.value).join("");';
  const replace = 'const code = joinTokenValues(codeTokens);';
  if (src.includes(find)) {
    src = src.split(find).join(replace);
    fs.writeFileSync(path.join(transpilerDir, "Parser.js"), src);
  }
})();
ensurePatched(path.join(transpilerDir, "Partial_transpiler.js"), [
  {
    // Without the trailing ';', two consecutive JS_BLOCK statements (the
    // overwhelmingly common case — any file with more than one directive)
    // get glued together by ASI into a single invalid call expression:
    // "(()=>{...})()\n\n(()=>{...})()" parses as one IIFE's result being
    // CALLED with the second IIFE as its argument. Verified directly —
    // see docs/REACTIVE-STATE.md, bug #6.
    find: "return { value: `(()=>{${statement.prams.code}})()`, type: \"JS_BLOCK\" };",
    replace: "return { value: `(()=>{${statement.prams.code}})();`, type: \"JS_BLOCK\" };",
    alreadyDoneMarker: "})();`, type: \"JS_BLOCK\" };",
  },
]);

fs.mkdirSync(path.join(pluginsDir, "cdrca-reactive-state"), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, "..", "plugin.js"),
  path.join(pluginsDir, "cdrca-reactive-state", "plugin.js")
);
fs.writeFileSync(
  path.join(pluginsDir, "plugins.json"),
  JSON.stringify([
    {
      name: "cdrca-reactive-state",
      path: "cdrca-reactive-state/plugin.js",
      uses: [["syntax", "customRule"]],
      permissions: [],
    },
  ])
);

delete require.cache[require.resolve(path.join(transpilerDir, "index.js"))];
delete require.cache[require.resolve(pluginHostPath)];
const T = require(path.join(transpilerDir, "index.js"));

function transpile(body) {
  const src = `!--- SCENE Main :: t ---\n\n${body}\n\n!---END---`;
  return T.transpile({ "index.cdrca": src }, {});
}

test("state/bind/event directives reach the final generated output", () => {
  const out = transpile(["state count = 0", "@countText bind.text = count", "@increment click => count += 1"].join("\n\n"));
  assert.ok(out.includes('R.define("count", 0)'), "state declaration missing from output");
  assert.ok(out.includes('R.bind("countText", "text"'), "bind directive missing from output");
  assert.ok(out.includes('R.on("increment", "click"'), "event directive missing from output");
});

test("a plain scene with no reactive directives is unaffected", () => {
  const out = transpile('JS { /* unrelated */ }\nuse ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1');
  assert.ok(!out.includes("CDRCA.reactive"), "unrelated scene should not reference the reactive runtime at all");
});

test("a full multi-directive scene actually runs: click updates a direct binding and a computed binding", () => {
  const scriptPart = transpile(
    [
      "state count = 0",
      "computed doubled = count * 2",
      "@countText bind.text = count",
      "@doubledText bind.text = doubled",
      "@increment click => count += 1",
    ].join("\n\n")
  ).split("var defaultGredientMap")[0];

  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(
    '<div id="countText"></div><div id="doubledText"></div><button id="increment"></button>',
    { runScripts: "outside-only" }
  );
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  delete require.cache[require.resolve("../runtime.js")];
  require("../runtime.js");
  dom.window.eval(scriptPart);

  assert.strictEqual(dom.window.document.getElementById("countText").textContent, "0");
  assert.strictEqual(dom.window.document.getElementById("doubledText").textContent, "0");
  dom.window.document.getElementById("increment").dispatchEvent(new dom.window.Event("click"));
  dom.window.document.getElementById("increment").dispatchEvent(new dom.window.Event("click"));
  assert.strictEqual(dom.window.document.getElementById("countText").textContent, "2");
  assert.strictEqual(dom.window.document.getElementById("doubledText").textContent, "4");
});

report();
