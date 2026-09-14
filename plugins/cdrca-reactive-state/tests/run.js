// Runs every test file in this directory as its own process.
// Usage: node tests/run.js
const { execFileSync } = require("child_process");
const path = require("path");

const files = ["plugin.test.js", "runtime.test.js", "integration.test.js"];
let anyFailed = false;

for (const file of files) {
  console.log(`\n--- ${file} ---`);
  try {
    const output = execFileSync(process.execPath, [path.join(__dirname, file)], {
      encoding: "utf8",
    });
    process.stdout.write(output);
  } catch (err) {
    anyFailed = true;
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
  }
}

if (anyFailed) {
  console.log("\nSome test files reported failures — see above.");
  process.exitCode = 1;
} else {
  console.log("\nAll test files passed.");
}
