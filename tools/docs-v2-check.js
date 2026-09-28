#!/usr/bin/env node
// Every CDRCA example in the v2 syntax guide must actually compile with the
// grammar plugin. Docs that can't rot: change the syntax and this fails until
// the guide is updated.
const fs = require("fs");
const path = require("path");
const { fencedBlocks, looksLikeCdrca } = require("./corpus-diff.js");

const ROOT = path.join(__dirname, "..");
const transpiler = require(path.join(ROOT, "cli", "src", "templates", "cdrca-runtime", "Back-end", "Transpiler", "index"));
const FILES = ["docs/SYNTAX.md"];

const log = console.log, warn = console.warn, err = console.error;
const quiet = (fn) => { console.log = console.warn = console.error = () => {}; try { return fn(); } finally { console.log = log; console.warn = warn; console.error = err; } };

let checked = 0, bad = 0;
for (const rel of FILES) {
  for (const b of fencedBlocks(fs.readFileSync(path.join(ROOT, rel), "utf8"))) {
    if (!looksLikeCdrca(b)) continue;
    const forms = [b.text];
    if (!/^\s*!-{2,}/m.test(b.text)) forms.push(`!--- SCENE Main :: m ---\nuse ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0xff0000, 1) as cube\n${b.text}\n!---END---\n`);
    let ok = false, lastErr = "";
    for (const f of forms) {
      try { quiet(() => transpiler.transpile({ "index.cdrca": f })); ok = true; break; }
      catch (e) { lastErr = String(e.message).split("\n")[0]; }
    }
    checked++;
    if (!ok) { bad++; console.log(`FAIL ${rel}:${b.line}  ${lastErr}`); }
  }
}
console.log(`${checked} example(s) checked in ${FILES.length} guide(s): ${checked - bad} compile, ${bad} do not.`);
if (checked === 0) { console.log("no examples found — the extractor is broken"); process.exit(1); }
process.exit(bad ? 1 : 0);
