#!/usr/bin/env node
// Every `computed`/`state`/`bind`/event example fenced in
// docs/REACTIVE-STATE.md must not just COMPILE (not throw during
// transpile — tools/docs-v2-check.js's bar) but actually RUN: the emitted
// JS must be valid and must execute without throwing against the real
// runtime.js, not a stub.
//
// Why this exists, concretely: a doc edit once added
//   computed isEmpty = items.length == 0
// which transpiled without error (so docs-v2-check.js-style compile-only
// checking would have passed it) but the plugin's expression compiler had
// a latent bug that emitted `R.val("items").length = = 0` -- two separate
// `=` tokens, invalid JS, a SyntaxError the instant it ran. Compiling
// without throwing proves the TRANSPILER accepted the input; it says
// nothing about whether the JS IT PRODUCED is valid. This script closes
// that gap for REACTIVE-STATE.md specifically, where it was found (twice).
//
// Blocks are executed CUMULATIVELY within each `##` section, sharing one
// sandbox/runtime instance per section and resetting at the next `##` --
// matching how a reader actually encounters these examples (a later
// snippet in the same section routinely assumes state a `state count = 0`
// a few paragraphs earlier already declared), without pretending unrelated
// sections share any state.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const { fencedBlocks, looksLikeCdrca } = require("./corpus-diff.js");
const transpiler = require(path.join(ROOT, "cli", "src", "templates", "cdrca-runtime", "Back-end", "Transpiler", "index"));
const RUNTIME_SRC = fs.readFileSync(path.join(ROOT, "plugins", "cdrca-reactive-state", "runtime.js"), "utf8");

const FILE = "docs/REACTIVE-STATE.md";

const log = console.log, warn = console.warn, err = console.error;
const quiet = (fn) => {
  console.log = console.warn = console.error = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; console.error = err; }
};

function freshSandbox() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    window: undefined,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { addEventListener() {} },
      body: { addEventListener() {} },
      addEventListener() {},
    },
    setTimeout,
    fetch: () => Promise.reject(new Error("no network in this checker -- only sync behavior is verified")),
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(RUNTIME_SRC, { filename: "runtime.js" }).runInContext(ctx);
  return ctx;
}

function isIllustrativeFragment(blockText) {
  const lines = blockText.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => l.startsWith("'"));
}

function isPlaceholderShape(blockText) {
  return /<[A-Za-z][\w-]*>/.test(blockText);
}

function sectionsOf(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let current = { heading: "(preamble)", startLine: 1 };
  lines.forEach((line, i) => {
    if (/^##\s+/.test(line)) {
      current.endLine = i + 1;
      sections.push(current);
      current = { heading: line.replace(/^##\s+/, "").trim(), startLine: i + 2 };
    }
  });
  current.endLine = lines.length + 1;
  sections.push(current);
  return sections;
}

function sectionFor(sections, line) {
  return sections.find((s) => line >= s.startLine && line < s.endLine) || sections[0];
}

let checked = 0, bad = 0, skipped = 0;
const text = fs.readFileSync(path.join(ROOT, FILE), "utf8");
const sections = sectionsOf(text);

let currentSectionHeading = null;
let ctx = null;

for (const b of fencedBlocks(text)) {
  if (!looksLikeCdrca(b)) continue;
  if (isPlaceholderShape(b.text)) { skipped++; continue; }

  const section = sectionFor(sections, b.line);
  if (section.heading !== currentSectionHeading) {
    currentSectionHeading = section.heading;
    ctx = freshSandbox();
  }

  const isSceneBlock = /^\s*!-{2,}/m.test(b.text);
  const wrapped = isSceneBlock
    ? b.text
    : `!--- SCENE Main :: m ---\nobject cube = RotatingCube(#3b82f6, 1)\n${b.text}\n!---END---\n`;

  const bodyOnly = b.text
    .split("\n")
    .filter((l) => !/^\s*(state|computed)\s+\w+\s*=\s*\[\s*$/.test(l) && l.trim() !== "]");
  if (isIllustrativeFragment(bodyOnly.join("\n"))) {
    skipped++;
    continue;
  }

  checked++;
  let compiled;
  try {
    compiled = quiet(() => transpiler.transpile({ "index.cdrca": wrapped }));
  } catch (e) {
    bad++;
    console.log(`FAIL ${FILE}:${b.line} [${section.heading}]  (compile) ${String(e.message).split("\n")[0]}`);
    continue;
  }

  try {
    const iifes = String(compiled).match(/\(\(\)\s*=>\s*\{[\s\S]*?\}\)\(\);/g) || [];
    for (const iife of iifes) {
      // Quark's own statements (Quark.UI.mount(...)) are a different
      // plugin's concern with its own dedicated test coverage (quark.test.js,
      // Plugins/quark/tests/useLib.test.js) — this checker's job is
      // reactive-state's expression compiler, so a Quark call appearing
      // alongside a reactive-state statement in the same doc example
      // (e.g. "@saveButton button.primary" next to a click => handler) is
      // skipped here rather than requiring a full Quark front-end stub.
      if (/^\(\(\)\s*=>\s*\{Quark\./.test(iife)) continue;
      new vm.Script(iife, { filename: `${FILE}:${b.line}` }).runInContext(ctx);
    }
  } catch (e) {
    bad++;
    console.log(`FAIL ${FILE}:${b.line} [${section.heading}]  (execute) ${String(e.message).split("\n")[0]}`);
    console.log(`       source: ${b.text.trim().split("\n")[0]}`);
  }
}
if (skipped) console.log(`(${skipped} illustrative/placeholder fragment(s) skipped -- not runnable examples)`);

console.log(`${checked} reactive-state example(s) checked in ${FILE}: ${checked - bad} run, ${bad} do not.`);
if (checked === 0) {
  console.log("no examples found -- the extractor or looksLikeCdrca() may need updating");
  process.exit(1);
}
process.exit(bad ? 1 : 0);
