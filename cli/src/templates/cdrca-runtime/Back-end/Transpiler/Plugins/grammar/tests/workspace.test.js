const { test, report, assert } = require("./harness");
const fs = require("fs");
const os = require("os");
const path = require("path");
const W = require("../workspace.js");
const { execFileSync, spawnSync } = require("child_process");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cdrca-w-"));
const ws = (name) => { const d = path.join(tmp(), name); W.initWorkspace(d, name); return d; };
const ANCHOR = "module.exports = function (pluginAPI) {";
const edit = (dir, added) => {
  const f = path.join(dir, "grammar-workspace.js");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(ANCHOR, added.trim() + "\n\n" + ANCHOR));
};
const errOf = (fn) => { try { fn(); } catch (e) { return e; } throw new Error("expected an error, got none"); };
const plug = (name, cap) => `
function ${cap}Rule(ctx, unit, text, textStart) {
  const el = splitElement(text, textStart);
  return el && el.cap === "${cap}" ? "state " + el.id + "_${cap} = 1" : null;
}
PLUGIN.declare("${name}", { capabilities: { ${cap}: { variants: ["a"], modifiers: [] } } });
PLUGIN.register("element", "${cap}Rule", ${cap}Rule);
`;

test("init copies the grammar, snapshots the base, and refuses bad names or a non-empty folder", () => {
  const d = ws("glow");
  for (const f of ["grammar-workspace.js", ".base/plugin.js", "grammar.plugin.json", "deps"]) assert.ok(fs.existsSync(path.join(d, f)), f);
  assert.ok(errOf(() => W.initWorkspace(d, "glow")).message.includes("not empty"));
  for (const n of ["Bad", "base", "x y", ""]) assert.ok(errOf(() => W.initWorkspace(path.join(tmp(), "z"), n)).message.includes("plugin name"), n);
});

test("an untouched workspace behaves like the base grammar and has nothing to package", () => {
  const d = ws("glow");
  assert.strictEqual(W.testWorkspace(d, "require quark\n"), "@requires quark\n");
  assert.match(W.packageDir(d).errors[0].message, /nothing to package/);
});

test("develop, test in the full copy, test the packaged result, package: same output every way", () => {
  const d = ws("glow");
  edit(d, plug("glow", "halo"));
  const src = "@box halo a\n";
  const dev = W.testWorkspace(d, src);
  assert.strictEqual(dev, "state box_halo = 1\n");
  assert.strictEqual(W.testWorkspace(d, src, { packaged: true }), dev);
  const r = W.packageDir(d);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
  const pkg = JSON.parse(fs.readFileSync(r.file, "utf8"));
  assert.strictEqual(pkg.owner, "glow");
  assert.ok(!/module\.exports|createBaseRegistry/.test(pkg.source), "the package must be additions only, not the copied grammar");
  assert.ok(pkg.source.length < 800);
});

test("changing shared grammar code in the workspace fails packaging and test --packaged", () => {
  const d = ws("glow");
  edit(d, plug("glow", "halo"));
  const f = path.join(d, "grammar-workspace.js");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('const WIRING_WORDS = ["bind"];', 'const WIRING_WORDS = ["bind", "x"];'));
  assert.match(W.packageDir(d).errors[0].message, /shared grammar code was changed/);
  assert.match(errOf(() => W.testWorkspace(d, "x\n", { packaged: true })).message, /packaging fails/);
});

test("add-grammar combines another plugin's package for testing, and only the packaged/tested combination uses it", () => {
  const a = ws("glow");
  edit(a, plug("glow", "halo"));
  const pa = W.packageDir(a).file;
  const b = ws("shine");
  edit(b, plug("shine", "beam"));
  W.addGrammar(b, pa);
  assert.strictEqual(W.testWorkspace(b, "@x halo a\n@y beam a\n"), "state x_halo = 1\nstate y_beam = 1\n");
  assert.strictEqual(W.testWorkspace(b, "@x halo a\n@y beam a\n", { packaged: true }), "state x_halo = 1\nstate y_beam = 1\n");
  const pb = JSON.parse(fs.readFileSync(W.packageDir(b).file, "utf8"));
  assert.ok(!/halo/.test(pb.source), "another plugin's grammar must not leak into this plugin's package");
});

test("add-grammar refuses a clash, a duplicate, itself, and leaves the workspace unchanged", () => {
  const a = ws("glow");
  edit(a, plug("glow", "halo"));
  const pa = W.packageDir(a).file;
  const c = ws("gleam");
  edit(c, plug("gleam", "halo")); // same capability name
  assert.match(errOf(() => W.addGrammar(c, pa)).message, /can't add 'glow'/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(c, "grammar.plugin.json"), "utf8")).deps, []);
  assert.ok(!fs.existsSync(path.join(c, "deps", "glow.json")));
  const d = ws("other");
  W.addGrammar(d, pa);
  assert.match(errOf(() => W.addGrammar(d, pa)).message, /already added/);
  assert.match(errOf(() => W.addGrammar(a, pa)).message, /same name/);
  fs.writeFileSync(path.join(d, "junk.json"), "{}");
  assert.match(errOf(() => W.addGrammar(d, path.join(d, "junk.json"))).message, /not a grammar package/);
});

test("the shared grammar can move on after the workspace was copied: the package still applies to the newer base", () => {
  const base = fs.readFileSync(path.join(__dirname, "..", "plugin.js"), "utf8");
  const dir = tmp();
  const oldBase = path.join(dir, "old.js");
  fs.writeFileSync(oldBase, base);
  const d = path.join(dir, "glow");
  W.initWorkspace(d, "glow", { basePath: oldBase });
  edit(d, plug("glow", "halo"));
  // a newer base: upstream added a helper and a rule to createBaseRegistry
  const REG = '  reg.register("element", "elementRule", elementRule);';
  assert.ok(base.includes(REG));
  const newer = path.join(dir, "newer.js");
  fs.writeFileSync(newer, base.replace(REG, REG + '\n  reg.register("statement", "upstream", () => null);'));
  const r = W.packageDir(d, { currentBase: newer, write: false });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.errors));
  // and a newer base that already took this plugin's rule name is refused, not silently merged
  const clash = path.join(dir, "clash.js");
  fs.writeFileSync(clash, base.replace(REG, REG + '\n  reg.register("element", "haloRule", () => null);'));
  assert.match(W.packageDir(d, { currentBase: clash, write: false }).errors[0].message, /already registered in the element list/);
});

test("the command line works end to end", () => {
  const d = path.join(tmp(), "cli-plug");
  const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, "..", "workspace.js"), ...a], { encoding: "utf8" });
  assert.strictEqual(run("init", d, "cli-plug").status, 0);
  edit(d, plug("cli-plug", "sparkle"));
  const src = path.join(d, "t.cdrca");
  fs.writeFileSync(src, "@z sparkle a\n");
  const t = run("test", d, src, "--packaged");
  assert.strictEqual(t.stdout, "state z_sparkle = 1\n");
  const p = run("package", d);
  assert.strictEqual(p.status, 0, p.stderr);
  assert.ok(fs.existsSync(path.join(d, "dist", "cli-plug.grammar.json")));
  fs.appendFileSync(path.join(d, "grammar-workspace.js"), "\nglobalThis.x = 1;\n");
  const bad = run("package", d);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /ambiguous/);
});

report();
