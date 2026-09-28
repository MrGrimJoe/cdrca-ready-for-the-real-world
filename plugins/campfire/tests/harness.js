// Tiny, dependency-free test harness. Run with:
//   node tests/run.js
// Copied verbatim from cdrca-reactive-state's tests/harness.js for
// ecosystem consistency — same shape, so anyone familiar with one
// plugin's tests can read this one immediately.

const assert = require("assert");

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    failures.push({ name, err });
  }
}

function report() {
  console.log(`\n${pass} passed, ${fail} failed.`);
  if (failures.length) {
    for (const { name, err } of failures) {
      console.log(`\nFAIL: ${name}`);
      console.log(err && err.stack ? err.stack : err);
    }
    process.exitCode = 1;
  }
}

module.exports = { test, report, assert };
