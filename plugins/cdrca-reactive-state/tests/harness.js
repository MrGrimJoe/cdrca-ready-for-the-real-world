// Tiny, dependency-free test harness. Run with:
//   node tests/run.js
// (runtime.test.js additionally needs jsdom — see the note it prints if
// jsdom isn't installed).
//
// test() also accepts an async fn — needed for reactive-state-query.js's
// tests (genuinely async fetches). Tests run strictly SEQUENTIALLY, each
// chained onto the end of the previous one, not fired in parallel —
// several existing tests here share mutable global state (global.window,
// global.document, via freshRuntime()'s require-cache trick), and
// running them concurrently would let a later test's setup clobber an
// earlier one's still-in-flight state. Call sites are unchanged
// (`test("name", () => { ... })`, no `await` needed) — report() awaits
// the full chain before printing.

const assert = require("assert");

let pass = 0;
let fail = 0;
const failures = [];
let chain = Promise.resolve();

function test(name, fn) {
  chain = chain.then(fn).then(
    () => {
      pass++;
    },
    (err) => {
      fail++;
      failures.push({ name, err });
    }
  );
}

async function report() {
  await chain;
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
