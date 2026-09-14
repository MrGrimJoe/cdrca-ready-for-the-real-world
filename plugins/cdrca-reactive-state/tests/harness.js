// Tiny, dependency-free test harness. Run with:
//   node tests/run.js
// (runtime.test.js additionally needs jsdom — see the note it prints if
// jsdom isn't installed).

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
