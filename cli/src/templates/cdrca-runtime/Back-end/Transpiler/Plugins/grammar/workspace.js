// The plugin author's workflow around the grammar, as plain Node so the CLI
// (or anything else) can call it:
//
//   node workspace.js init <dir> <plugin-name>       copy the grammar to work on
//   node workspace.js add-grammar <dir> <file.json>  add another plugin's package for testing
//   node workspace.js test <dir> <file.cdrca> [--packaged]
//   node workspace.js package <dir>                  write <dir>/dist/<name>.grammar.json
//
// A workspace is:
//   grammar-workspace.js   a full copy of the base grammar; the author edits this
//   .base/plugin.js        the pristine base it was copied from (what packaging diffs against)
//   grammar.plugin.json    { name, baseSha256, deps: [ "<owner>", ... ] }
//   deps/<owner>.json      other plugins' packages, applied for combined testing only
//
// The full copy is for developing and testing. `package` keeps only what the
// author added (see packager.js); `test --packaged` runs exactly what would be
// shipped, in the same isolation as production, so the author can confirm it
// before deploying.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { packageWorkspace } = require("./packager.js");

const BASE_PATH = path.join(__dirname, "plugin.js");
const ANCHOR = "module.exports = function (pluginAPI) {";
const NAME_RE = /^[a-z][a-z0-9-]*$/;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const read = (f) => fs.readFileSync(f, "utf8");
const meta = (dir) => JSON.parse(read(path.join(dir, "grammar.plugin.json")));
const saveMeta = (dir, m) => fs.writeFileSync(path.join(dir, "grammar.plugin.json"), JSON.stringify(m, null, 2) + "\n");

const GUIDE = `// ======================================================================
// YOUR PLUGIN GOES HERE (below this line, above module.exports).
//
// You can add:
//   - new helper functions and new const/let values
//   - PLUGIN.declare("<plugin>", { capabilities: { <name>: { variants: [...], modifiers: [...] } } })
//   - PLUGIN.register("element" | "statement" | "guard", "<ruleName>", <function>)
// Available to your code: PLUGIN, GrammarError, splitWords, splitElement,
// suggest, didYouMean, distance. Anything else in this file is internal.
// Do not edit or remove existing lines: packaging only accepts additions.
// ======================================================================
`;

function initWorkspace(dir, name, opts) {
  if (!NAME_RE.test(String(name)) || name === "base" || name === "workspace") throw new Error("plugin name must be lowercase letters, digits and hyphens (and not 'base' or 'workspace')");
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`'${dir}' already exists and is not empty`);
  const basePath = (opts && opts.basePath) || BASE_PATH;
  const base = read(basePath);
  if (base.indexOf(ANCHOR) === -1) throw new Error("the base grammar has no insertion point (is this the grammar plugin?)");
  fs.mkdirSync(path.join(dir, ".base"), { recursive: true });
  fs.mkdirSync(path.join(dir, "deps"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".base", "plugin.js"), base);
  fs.writeFileSync(path.join(dir, "grammar-workspace.js"), base.replace(ANCHOR, GUIDE + "\n" + ANCHOR));
  saveMeta(dir, { name, baseSha256: sha(base), deps: [] });
  return { dir, name };
}

// Load the workspace copy as a real module (fresh each time) with the deps applied.
function loadWorkspace(dir) {
  const file = path.resolve(dir, "grammar-workspace.js");
  delete require.cache[file];
  const G = require(file).__internals;
  const reg = G.DEFAULT_REGISTRY;
  for (const owner of meta(dir).deps) G.applyPackage(reg, JSON.parse(read(path.join(dir, "deps", owner + ".json"))));
  return { G, reg };
}

function addGrammar(dir, packageFile) {
  const pkg = JSON.parse(read(packageFile));
  if (!pkg || pkg.format !== 1 || !pkg.owner) throw new Error(`'${packageFile}' is not a grammar package`);
  const m = meta(dir);
  if (pkg.owner === m.name) throw new Error("that package has the same name as this plugin");
  if (m.deps.indexOf(pkg.owner) !== -1) throw new Error(`'${pkg.owner}' is already added`);
  // It must actually combine with this workspace (as it is now) and the deps already added.
  const dry = JSON.stringify(m.deps);
  fs.writeFileSync(path.join(dir, "deps", pkg.owner + ".json"), JSON.stringify(pkg, null, 2) + "\n");
  m.deps.push(pkg.owner);
  saveMeta(dir, m);
  try {
    loadWorkspace(dir);
  } catch (e) {
    fs.unlinkSync(path.join(dir, "deps", pkg.owner + ".json"));
    m.deps = JSON.parse(dry);
    saveMeta(dir, m);
    throw new Error(`can't add '${pkg.owner}': ${e.message.replace(/^grammar registry: /, "")}`);
  }
  return { added: pkg.owner };
}

// Desugar a .cdrca source with the workspace grammar (development copy), or
// with exactly what would be shipped, in isolation, on the current base.
function testWorkspace(dir, source, opts) {
  const m = meta(dir);
  if (opts && opts.packaged) {
    const r = packageDir(dir, Object.assign({ write: false }, opts));
    if (!r.ok) throw new Error("packaging fails:\n" + r.errors.map((e) => `  ${e.line ? "line " + e.line + ": " : ""}${e.message}`).join("\n"));
    const G = require((opts && opts.currentBase) || BASE_PATH).__internals;
    const reg = G.createBaseRegistry();
    for (const owner of m.deps) G.applyPackage(reg, JSON.parse(read(path.join(dir, "deps", owner + ".json"))));
    G.applyPackage(reg, r.package);
    return G.desugar(source, undefined, false, reg);
  }
  const { G, reg } = loadWorkspace(dir);
  return G.desugar(source, undefined, false, reg);
}

function packageDir(dir, opts) {
  const m = meta(dir);
  const snapshot = read(path.join(dir, ".base", "plugin.js"));
  const work = read(path.join(dir, "grammar-workspace.js"));
  const r = packageWorkspace(snapshot, work, { owner: m.name, currentBase: opts && opts.currentBase });
  if (r.ok && !(opts && opts.write === false)) {
    const out = path.join(dir, "dist");
    fs.mkdirSync(out, { recursive: true });
    r.file = path.join(out, m.name + ".grammar.json");
    fs.writeFileSync(r.file, JSON.stringify(r.package, null, 2) + "\n");
  }
  return r;
}

module.exports = { initWorkspace, loadWorkspace, addGrammar, testWorkspace, packageDir };

if (require.main === module) {
  const [cmd, dir, arg, flag] = process.argv.slice(2);
  try {
    if (cmd === "init") console.log(`created ${initWorkspace(dir, arg).dir} — edit grammar-workspace.js`);
    else if (cmd === "add-grammar") console.log(`added ${addGrammar(dir, arg).added}`);
    else if (cmd === "test") process.stdout.write(testWorkspace(dir, read(arg), { packaged: flag === "--packaged" }));
    else if (cmd === "package") {
      const r = packageDir(dir);
      if (!r.ok) {
        for (const e of r.errors) console.error(`${e.line ? "line " + e.line + ": " : ""}${e.message}`);
        process.exit(1);
      }
      console.log(`wrote ${r.file}`);
    } else {
      console.error("usage: workspace.js init <dir> <name> | add-grammar <dir> <file.json> | test <dir> <file.cdrca> [--packaged] | package <dir>");
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
