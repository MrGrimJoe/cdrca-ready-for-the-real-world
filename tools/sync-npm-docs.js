#!/usr/bin/env node
// Copies every doc, guide and example into npm/docs/ so the published npm
// package carries them (`cdrca12 docs` reads them from disk, offline).
// Run this before `npm publish`; `--check` exits 1 if npm/docs has drifted
// (used by CI / verify-all). npm/docs/README.md is the hand-written index and
// is never touched.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "npm", "docs");
const check = process.argv.includes("--check");

// [source relative to repo root, destination relative to npm/docs]
const jobs = [];
function walk(srcDir, destDir, keep) {
  for (const e of fs.readdirSync(path.join(ROOT, srcDir), { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const s = path.posix.join(srcDir, e.name), d = path.posix.join(destDir, e.name);
    if (e.isDirectory()) walk(s, d, keep);
    else if (keep(e.name)) jobs.push([s, d]);
  }
}
walk("docs", "", (n) => n.endsWith(".md"));
for (const p of fs.readdirSync(path.join(ROOT, "plugins"))) {
  const base = path.posix.join("plugins", p);
  if (!fs.statSync(path.join(ROOT, base)).isDirectory()) continue;
  if (fs.existsSync(path.join(ROOT, base, "README.md"))) jobs.push([`${base}/README.md`, `plugins/${p}/README.md`]);
  if (fs.existsSync(path.join(ROOT, base, "examples"))) walk(`${base}/examples`, `plugins/${p}/examples`, () => true);
}
jobs.push(["CHANGES.md", "CHANGES.md"]);

let drift = 0;
const wanted = new Set(jobs.map(([, d]) => d));
for (const [s, d] of jobs) {
  const src = fs.readFileSync(path.join(ROOT, s));
  const dst = path.join(OUT, d);
  const same = fs.existsSync(dst) && fs.readFileSync(dst).equals(src);
  if (same) continue;
  drift++;
  if (check) { console.error(`out of date: npm/docs/${d}`); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, src);
}
// stale files (deleted upstream) — everything under npm/docs except the index
(function prune(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name, full = path.join(dir, e.name);
    if (e.isDirectory()) prune(full, r);
    else if (r !== "README.md" && !wanted.has(r)) {
      drift++;
      if (check) console.error(`stale: npm/docs/${r}`); else fs.unlinkSync(full);
    }
  }
})(OUT, "");
console.log(check ? (drift ? `${drift} problem(s)` : "npm/docs is in sync") : `synced ${jobs.length} files (${drift} changed)`);
process.exit(check && drift ? 1 : 0);
