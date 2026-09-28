const { test, report, assert } = require("./harness");
const fs = require("fs");
const os = require("os");
const path = require("path");
const G = require("../plugin.js").__internals;
const { packageWorkspace } = require("../packager.js");

const basePath = path.join(__dirname, "..", "plugin.js");
const BASE = fs.readFileSync(basePath, "utf8");
const ANCHOR = "module.exports = function (pluginAPI) {";
const errOf = (fn) => { try { fn(); } catch (e) { return e; } throw new Error("expected an error, got none"); };

// An author's workspace: the full base copy with their code inserted between
// top-level statements (just before the module.exports).
const workspace = (added) => BASE.replace(ANCHOR, added.trim() + "\n\n" + ANCHOR);

const GLOW = `
function haloRule(ctx, unit, text, textStart) {
  const el = splitElement(text, textStart);
  if (!el || el.cap !== "halo") return null;
  return "state " + el.id + "Halo = " + JSON.stringify(el.rest || "soft");
}
PLUGIN.declare("glow", { capabilities: { halo: { variants: ["soft", "hard"], modifiers: [] } } });
PLUGIN.register("element", "haloRule", haloRule);
`;

const msgs = (r) => r.errors.map((e) => e.message).join("\n");

test("a plugin that adds a declaration, a helper and a rule packages cleanly", () => {
  const r = packageWorkspace(BASE, workspace(GLOW), { owner: "glow" });
  assert.ok(r.ok, r.ok ? "" : msgs(r));
  assert.strictEqual(r.package.owner, "glow");
  assert.deepStrictEqual(r.package.registrations, [{ list: "element", name: "haloRule" }]);
  assert.deepStrictEqual(r.package.declarations.map((d) => d.plugin), ["glow"]);
});

test("the packaged plugin behaves exactly like the workspace it came from", () => {
  const ws = workspace(GLOW);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cdrca-ws-")), "grammar-workspace.js");
  fs.writeFileSync(file, ws);
  const W = require(file).__internals;
  const pkg = packageWorkspace(BASE, ws, { owner: "glow" }).package;
  const reg = G.createBaseRegistry();
  G.applyPackage(reg, pkg);
  for (const src of ["@box halo\n", "@box halo hard\n", "@box halo // c\n", "require quark\n"]) {
    assert.strictEqual(desugar2(reg, src), W.desugar(src), JSON.stringify(src));
  }
  assert.strictEqual(desugar2(reg, "@box halo hard\n"), 'state boxHalo = "hard"\n');
});
function desugar2(reg, src) { return G.desugar(src, undefined, false, reg); }

test("without the plugin the base grammar does not know the capability", () => {
  assert.match(errOf(() => G.desugar("@box halo soft\n")).message, /unknown component 'halo'/);
});

test("the base registry is untouched by applying a package to another registry", () => {
  const reg = G.createBaseRegistry();
  G.applyPackage(reg, packageWorkspace(BASE, workspace(GLOW), { owner: "glow" }).package);
  assert.strictEqual(G.DEFAULT_REGISTRY.describe().element.length, 1);
  assert.strictEqual(G.VOCABULARY.glow, undefined);
  assert.deepStrictEqual(reg.describe().element.map((e) => e.owner), ["base", "glow"]);
});

test("editing a line of the base grammar fails packaging and points at the line", () => {
  const ws = workspace(GLOW).replace('const WIRING_WORDS = ["bind"];', 'const WIRING_WORDS = ["bind", "watch"];');
  const r = packageWorkspace(BASE, ws, { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /shared grammar code was changed or removed/);
  assert.match(msgs(r), /WIRING_WORDS/);
});

test("deleting a base line fails packaging", () => {
  const ws = workspace(GLOW).replace('const DOM_EVENTS = ["click", "input", "change", "submit", "keydown", "keyup", "focus", "blur"];\n', "");
  assert.ok(!packageWorkspace(BASE, ws, { owner: "glow" }).ok);
});

test("code added inside an existing base function fails packaging", () => {
  const ws = BASE.replace("function splitWords(s) {", "function splitWords(s) {\n  console.log('hi');");
  const r = packageWorkspace(BASE, ws, { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /inside an existing top-level function 'splitWords'/);
});

test("a top-level statement that isn't a function, const/let, register or declare is ambiguous and fails", () => {
  for (const bad of ["VOCABULARY.quark = {};", "DEFAULT_REGISTRY.register('statement', 'x', () => null, 'base');", "let x = 1; x = 2;", "if (true) {}", "PLUGIN.register('statement', 'ok', () => null);\nglobalThis.x = 1;"]) {
    const r = packageWorkspace(BASE, workspace(bad), { owner: "glow" });
    assert.ok(!r.ok, bad);
    assert.match(msgs(r), /ambiguous top-level|not part of the plugin API/, bad);
  }
});

test("a helper that reuses a base name fails packaging", () => {
  const r = packageWorkspace(BASE, workspace("function splitWords(s) { return []; }\nPLUGIN.register('statement','x',() => null);"), { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /'splitWords' already exists in the base grammar/);
});

test("using a base-internal helper that is not in the plugin API fails packaging", () => {
  const r = packageWorkspace(BASE, workspace("function r(ctx, u, t, at) { return colorValue(ctx, t, at); }\nPLUGIN.register('statement','r',r);"), { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /'colorValue' is internal to the base grammar/);
});

test("the plugin API helpers are usable", () => {
  const r = packageWorkspace(BASE, workspace("function r(ctx, u, t, at) { return t === 'zzz' ? splitWords(t).length + '' : null; }\nPLUGIN.register('statement','r',r);"), { owner: "glow" });
  assert.ok(r.ok, r.ok ? "" : msgs(r));
});

test("PLUGIN.declare must be static data", () => {
  const r = packageWorkspace(BASE, workspace("const v = ['a'];\nPLUGIN.declare('glow', { capabilities: { halo: { variants: v } } });"), { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /must be static data/);
});

test("declaring a capability that already exists anywhere fails packaging", () => {
  const r = packageWorkspace(BASE, workspace("PLUGIN.declare('glow', { capabilities: { navbar: {} } });"), { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /capability 'navbar' already exists in 'quark'/);
});

test("a declaration may add a capability to an existing plugin, but not change its other data", () => {
  assert.ok(packageWorkspace(BASE, workspace("PLUGIN.declare('quark', { capabilities: { gauge: { variants: ['round'] } } });"), { owner: "glow" }).ok);
  const r = packageWorkspace(BASE, workspace("PLUGIN.declare('quark', { capabilities: { gauge: {} }, families: ['x'] });"), { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /may only add capabilities/);
});

test("registering a name the base already uses in that list fails packaging", () => {
  const r = packageWorkspace(BASE, workspace("PLUGIN.register('statement', 'directive', () => null);"), { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /already registered in the statement list/);
});

test("an unknown rule list and a non-function rule fail packaging", () => {
  assert.match(msgs(packageWorkspace(BASE, workspace("PLUGIN.register('nope', 'x', () => null);"), { owner: "glow" })), /not a rule list/);
  assert.match(msgs(packageWorkspace(BASE, workspace("PLUGIN.register('statement', 'x', 5);"), { owner: "glow" })), /must be a function/);
});

test("added code that does not parse fails packaging with a line", () => {
  const r = packageWorkspace(BASE, workspace("function broken( {"), { owner: "glow" });
  assert.ok(!r.ok);
  assert.match(msgs(r), /does not parse/);
});

test("a workspace with no additions, and a bad owner name, are refused", () => {
  assert.match(msgs(packageWorkspace(BASE, BASE, { owner: "glow" })), /nothing to package/);
  for (const o of [undefined, "", "Base", "base", "workspace", "has space"]) assert.ok(!packageWorkspace(BASE, workspace(GLOW), { owner: o }).ok, String(o));
});

test("two packages combine when their names differ, and a name clash between them is reported at apply time", () => {
  const a = packageWorkspace(BASE, workspace(GLOW), { owner: "glow" }).package;
  const b = packageWorkspace(BASE, workspace(GLOW.replace(/glow/g, "shine").replace(/halo/g, "beam").replace(/haloRule/g, "beamRule")), { owner: "shine" }).package;
  const reg = G.createBaseRegistry();
  G.applyPackage(reg, a);
  G.applyPackage(reg, b);
  assert.strictEqual(desugar2(reg, "@x halo hard\n"), 'state xHalo = "hard"\n');
  assert.strictEqual(desugar2(reg, "@x beam\n"), 'state xHalo = "soft"\n');
  const clash = packageWorkspace(BASE, workspace(GLOW.replace(/glow/g, "gleam").replace(/halo\b/g, "ring")), { owner: "gleam" }).package;
  assert.match(errOf(() => G.applyPackage(reg, clash)).message, /already registered in the element list/);
});

test("a packaged plugin only sees the plugin API: base internals are out of scope at run time", () => {
  const reg = G.createBaseRegistry();
  G.applyPackage(reg, { format: 1, owner: "sneaky", source: "PLUGIN.register('statement', 's', () => colorValue);" });
  assert.match(errOf(() => desugar2(reg, "anything\n")).message, /colorValue is not defined/);
});

test("a plugin can only register under its own name", () => {
  const reg = G.createBaseRegistry();
  G.applyPackage(reg, { format: 1, owner: "mine", source: "PLUGIN.register('statement', 's', () => null);" });
  assert.deepStrictEqual(reg.describe().statement.slice(-1), [{ name: "s", owner: "mine" }]);
});

report();
