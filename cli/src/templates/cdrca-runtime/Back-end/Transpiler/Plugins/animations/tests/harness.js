// Tiny, dependency-free test harness. Run with:
//   node tests/run.js
// Same shape as cdrca-reactive-state's/campfire's own harness.js, with
// one addition: test() also accepts an async fn — needed because
// ember-core.js's play()/wait() are genuinely Promise-based. Tests run
// strictly SEQUENTIALLY (each chained onto the end of the previous one),
// not fired off in parallel — several of ember's own test files
// deliberately share mutable global state between tests (global.document,
// Ember._clock), the same way a real page only has one of each; running
// them concurrently let later tests' setup silently clobber earlier
// tests' still-in-flight state, a real bug this exact design caught
// while writing sequences.test.js. Call sites stay exactly like every
// other plugin's tests (`test("name", () => { ... })`, no `await` needed
// at the call site) — report() awaits the full chain before printing.

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
