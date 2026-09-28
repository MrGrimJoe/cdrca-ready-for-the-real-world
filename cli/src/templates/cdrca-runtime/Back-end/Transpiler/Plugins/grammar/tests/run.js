// Runs every *.test.js in this folder in its own process, so a crash in one
// can't hide the others.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
let failed = false;
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith(".test.js")).sort()) {
  console.log(`\n--- ${f} ---`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) failed = true;
}
if (failed) {
  console.log("\nSome test files reported failures — see above.");
  process.exit(1);
}
console.log("\nAll test files passed.");
