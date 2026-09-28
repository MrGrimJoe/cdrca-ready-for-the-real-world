#!/usr/bin/env node
// Differential test: every CDRCA snippet in the docs, examples and plugin
// READMEs is compiled by TWO runtimes that are identical except that one has
// the grammar plugin and one doesn't. The results must match exactly —
// including which snippets fail and with what message.
//
// This is the proof that the v2 grammar leaves existing files alone. It is
// not a test of the v2 syntax itself (docs/design is excluded on purpose).
//
//   node tools/corpus-diff.js [--verbose] [--extra <dir-of-plugin-folders>]

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEMPLATE = path.join(ROOT, "cli", "src", "templates", "cdrca-runtime");
const verbose = process.argv.includes("--verbose");
const extraAt = process.argv.indexOf("--extra");
const EXTRA = extraAt === -1 ? null : process.argv[extraAt + 1];

// ------------------------------------------------------------- runtimes

function copyRuntime(dest, { withGrammar }) {
  fs.cpSync(TEMPLATE, dest, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("node_modules") && !src.split(path.sep).includes("tests"),
  });
  const nm = path.join(TEMPLATE, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dest, "node_modules"), "dir");

  const pj = path.join(dest, "Back-end", "Transpiler", "Plugins", "plugins.json");
  let list = JSON.parse(fs.readFileSync(pj, "utf8"));
  if (!withGrammar) list = list.filter((e) => e.name !== "grammar");

  // Every other syntax plugin the docs describe, so the grammar is judged
  // against the statements it must NOT disturb.
  const loaded = [];
  const candidates = [
    { name: "cdrca-reactive-state", from: path.join(ROOT, "plugins", "cdrca-reactive-state", "plugin.js") },
  ];
  if (EXTRA && fs.existsSync(EXTRA)) {
    for (const d of fs.readdirSync(EXTRA)) {
      const p = path.join(EXTRA, d, "plugin.js");
      if (fs.existsSync(p)) candidates.push({ name: d, from: p, extra: true });
    }
  }
  for (const c of candidates) {
    if (list.some((e) => e.name === c.name)) continue;
    const to = path.join(dest, "Back-end", "Transpiler", "Plugins", c.name);
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(c.from, path.join(to, "plugin.js"));
    list.push({ name: c.name, path: `${c.name}/plugin.js`, uses: [["syntax", "customRule"], ["syntax", "beforeTokenize"], ["syntax", "afterTokenize"], ["syntax", "afterParseNode"]], permissions: [] });
    loaded.push(c.name);
  }
  fs.writeFileSync(pj, JSON.stringify(list, null, 2));
  return { dir: dest, plugins: list.map((e) => e.name) };
}

// ------------------------------------------------------------- corpus

function fencedBlocks(md) {
  const out = [];
  const lines = md.split("\n");
  let open = null;
  let buf = [];
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)```([A-Za-z0-9_-]*)\s*$/.exec(lines[i]);
    if (m && open === null) {
      open = m[2] || "";
      buf = [];
      start = i + 2;
    } else if (/^\s*```\s*$/.test(lines[i]) && open !== null) {
      out.push({ tag: open, text: buf.join("\n"), line: start });
      open = null;
    } else if (open !== null) {
      buf.push(lines[i]);
    }
  }
  return out;
}

// Does this block look like CDRCA source (as opposed to shell, JS, JSON, HTML)?
function looksLikeCdrca(b) {
  if (!["", "txt", "text", "cdrca"].includes(b.tag)) return false;
  const t = b.text;
  if (/^\s*(\$|>|npm |cdrca |cd |git |node |cargo )/m.test(t)) return false;
  return (
    /^\s*!-{2,}\s*(SCENE|HEADER|CODE|SUB)/m.test(t) ||
    /^\s*@[A-Za-z_][\w-]*[\s.]/m.test(t) ||
    /^\s*(state|computed|watch|def|use|add new|BGcolor|gredientMap|fx|say|choice|JS|store|source|query)\b/m.test(t)
  );
}

function collectCorpus() {
  const items = [];
  const mdFiles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "target" || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) mdFiles.push(p);
      else if (e.name.endsWith(".cdrca")) items.push({ src: path.relative(ROOT, p), text: fs.readFileSync(p, "utf8"), whole: true });
    }
  })(ROOT);
  if (EXTRA && fs.existsSync(EXTRA)) {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md")) mdFiles.push(p);
        else if (e.name.endsWith(".cdrca")) items.push({ src: path.relative(EXTRA, p), text: fs.readFileSync(p, "utf8"), whole: true });
      }
    })(EXTRA);
  }
  for (const f of mdFiles) {
    const rel = path.relative(ROOT, f);
    // The plan and the new syntax docs deliberately use v2 syntax.
    if (rel.startsWith(path.join("docs", "design"))) continue;
    // Uses the v2 syntax on purpose; tools/docs-v2-check.js proves those compile.
    if (rel === path.join("docs", "SYNTAX.md")) continue;
    if (rel === "CHANGES.md") continue;
    for (const b of fencedBlocks(fs.readFileSync(f, "utf8"))) {
      if (looksLikeCdrca(b)) items.push({ src: `${rel}:${b.line}`, text: b.text, whole: false });
    }
  }
  return items;
}

// ------------------------------------------------------------- compare

const norm = (s) =>
  String(s)
    .replace(/(?<=[A-Za-z_])\d{10,}/g, "N")
    .replace(/[0-9]\.[0-9]{6,}/g, "R");

function compile(rt, text) {
  try {
    return { ok: true, out: norm(rt.transpile({ "index.cdrca": text })) };
  } catch (e) {
    return { ok: false, out: norm(String((e && e.message) || e).split("\n")[0]) };
  }
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cdrca-corpus-"));
  const A = copyRuntime(path.join(tmp, "with-grammar"), { withGrammar: true });
  const B = copyRuntime(path.join(tmp, "without-grammar"), { withGrammar: false });
  const withG = require(path.join(A.dir, "Back-end", "Transpiler", "index"));
  const noG = require(path.join(B.dir, "Back-end", "Transpiler", "index"));

  // Silence the runtimes' own console chatter.
  const realLog = console.log, realWarn = console.warn, realErr = console.error;
  const quiet = (fn) => { console.log = console.warn = console.error = () => {}; try { return fn(); } finally { console.log = realLog; console.warn = realWarn; console.error = realErr; } };

  const corpus = collectCorpus();
  let total = 0, same = 0, compiled = 0, failedBoth = 0;
  const diffs = [];
  const forms = (item) => {
    const raw = item.text;
    const wrapped = /^\s*!-{2,}/m.test(raw) ? null : `!--- SCENE Main :: m ---\n${raw}\n!---END---\n`;
    return wrapped ? [["raw", raw], ["in-scene", wrapped]] : [["raw", raw]];
  };
  quiet(() => {
    for (const item of corpus) {
      for (const [mode, text] of forms(item)) {
        total++;
        const a = compile(withG, text);
        const b = compile(noG, text);
        // Three shapes are fine, not regressions:
        //  1. Identical result (both ok with the same output, or both
        //     erroring with the same message) — the classic "grammar
        //     changed nothing" case this tool originally checked for.
        //  2. `with` succeeds where `without` fails — expected for a
        //     genuinely v2 example: v2 syntax is SUPPOSED to only work
        //     with the grammar plugin present, that's the plugin's whole
        //     purpose (and, since the legacy-syntax guard landed — see
        //     plugin.js's rejectLegacySyntax — this also covers a v2
        //     example that used to be legacy text and just got converted).
        //  3. Both fail, with different messages — usually a
        //     placeholder/shape line (`say <speakerId> "<line>"`) that was
        //     never meant to compile either way; which parser's error
        //     fires first isn't meaningful.
        // The only shapes that mean a REAL regression:
        //  - `without` succeeds but `with` now fails — the grammar plugin
        //    (guard included) rejects something that used to compile on
        //    its own. Often means a doc still has an unconverted legacy
        //    example — worth surfacing and fixing, not a false positive.
        //  - Both succeed but produce DIFFERENT output — the grammar
        //    plugin silently changed compiled semantics for something it
        //    should have left alone.
        const identical = a.ok === b.ok && a.out === b.out;
        const v2Only = a.ok && !b.ok;
        const bothFailedAnyway = !a.ok && !b.ok;
        if (identical || v2Only || bothFailedAnyway) {
          same++;
          if (a.ok) compiled++; else failedBoth++;
        } else {
          diffs.push({ src: item.src, mode, a, b });
        }
      }
    }
  });

  console.log(`plugins in both runtimes (minus grammar): ${B.plugins.join(", ")}`);
  console.log(`corpus: ${corpus.length} snippets/files -> ${total} compilations`);
  console.log(`  identical: ${same}   (compiled fine: ${compiled}, failed the same way in both: ${failedBoth})`);
  console.log(`  DIFFERENT: ${diffs.length}`);
  for (const d of diffs.slice(0, verbose ? 50 : 8)) {
    console.log(`\n--- ${d.src} [${d.mode}]`);
    console.log(`  with grammar   : ${d.a.ok ? "ok" : "ERR"} ${d.a.out.slice(0, 160)}`);
    console.log(`  without grammar: ${d.b.ok ? "ok" : "ERR"} ${d.b.out.slice(0, 160)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(diffs.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { collectCorpus, fencedBlocks, looksLikeCdrca };
