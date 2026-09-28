// `background` end to end: real transpiler output, real three.js, the real
// Renderer.js and animations-backdrop.js, in a real (jsdom) DOM. Only WebGL is
// replaced — jsdom has none — by a recorder that notes which canvas the
// renderer was given and what size it was asked to draw at.
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch {
  console.log("SKIPPED: jsdom isn't installed — run `npm install --no-save jsdom` to enable this file.");
  process.exit(0);
}
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const RT = path.join(__dirname, "..");
const transpiler = require(path.join(RT, "Back-end", "Transpiler", "index"));
const read = (rel) => fs.readFileSync(path.join(RT, "Front-end", rel), "utf8");
const CUBE = "object cubeMain = RotatingCube(0xff0000, 1)\n";
const scene = (body) => `!--- SCENE Main :: m ---\n${CUBE}${body}\n!---END---\n`;

function boot(html) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:3000/", virtualConsole: new VirtualConsole() });
  const ctx = dom.getInternalVMContext();
  const run = (code, name) => new vm.Script(code, { filename: name }).runInContext(ctx);
  const w = dom.window;
  Object.defineProperty(w, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(w, "innerHeight", { value: 768, configurable: true });
  run(read("three.js"), "three.js");
  const calls = { canvas: null, sizes: [], renders: 0 };
  w.THREE.WebGLRenderer = class {
    constructor(o) { calls.canvas = o && o.canvas; }
    setSize(...a) { calls.sizes.push(a); }
    render() { calls.renders++; }
    setClearColor() {}
  };
  run(read("Transpiler-Plugins/animations/animations-backdrop.js"), "animations-backdrop.js");
  run(read("Renderer.js"), "Renderer.js");
  return { w, calls, run };
}
const start = (h, cdrca) => h.run(String(transpiler.transpile({ "index.cdrca": cdrca })), "compiled.js");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok -", name); }
  catch (e) { failed++; console.log("  FAIL -", name, "\n     ", String(e.message).split("\n").slice(0, 4).join("\n      ")); }
}

(async () => {
  await test("no background: draws into the page's own canvas at half the window, as always", () => {
    const h = boot('<body><canvas id="THRREjsRender"></canvas></body>');
    start(h, scene(""));
    assert.strictEqual(h.calls.canvas, h.w.document.getElementById("THRREjsRender"));
    assert.deepStrictEqual(h.calls.sizes[0], [512, 384]);
  });

  await test("`background`: a canvas behind the WHOLE PAGE, fixed, drawn at the window's size", () => {
    const h = boot("<body><p>content</p></body>");
    start(h, scene("background"));
    const c = h.w.document.body.firstChild;
    assert.strictEqual(c.tagName, "CANVAS");
    assert.strictEqual(h.calls.canvas, c, "the renderer must draw into the placed canvas");
    assert.strictEqual(c.style.position, "fixed");
    assert.strictEqual(c.style.zIndex, "-1");
    assert.strictEqual(c.getAttribute("data-backdrop-for"), "page");
    assert.deepStrictEqual(h.calls.sizes[0], [1024, 768, false], "full window; updateStyle=false because CSS already sizes it");
    assert.strictEqual(h.w.document.querySelectorAll("canvas").length, 1);
  });

  await test("`background heroSection`: a canvas behind ONE ELEMENT, sized to that element", () => {
    const h = boot('<body><p id="intro">hi</p><div id="heroSection" style="background:#123"></div></body>');
    const hero = h.w.document.getElementById("heroSection");
    Object.defineProperty(hero, "clientWidth", { value: 320, configurable: true });
    Object.defineProperty(hero, "clientHeight", { value: 180, configurable: true });
    start(h, scene("background heroSection"));
    const c = hero.firstChild;
    assert.strictEqual(c.tagName, "CANVAS");
    assert.strictEqual(h.calls.canvas, c);
    assert.strictEqual(c.style.position, "absolute");
    assert.strictEqual(hero.style.position, "relative");
    assert.strictEqual(hero.style.isolation, "isolate", "an element with its own background must not hide the canvas");
    assert.deepStrictEqual(h.calls.sizes[0], [320, 180, false]);
    assert.strictEqual(h.w.document.body.querySelectorAll("canvas").length, 1, "nothing is placed behind the rest of the page");
  });

  await test("page background follows window resizes", () => {
    const h = boot("<body></body>");
    start(h, scene("background"));
    Object.defineProperty(h.w, "innerWidth", { value: 640, configurable: true });
    Object.defineProperty(h.w, "innerHeight", { value: 480, configurable: true });
    h.w.dispatchEvent(new h.w.Event("resize"));
    assert.deepStrictEqual(h.calls.sizes[h.calls.sizes.length - 1], [640, 480, false]);
  });

  await test("element background follows the ELEMENT's size (ResizeObserver), not the window's", () => {
    const h = boot('<body><div id="hero"></div></body>');
    let cb = null;
    h.w.ResizeObserver = class { constructor(f) { cb = f; } observe() {} disconnect() {} };
    const hero = h.w.document.getElementById("hero");
    Object.defineProperty(hero, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(hero, "clientHeight", { value: 100, configurable: true });
    start(h, scene("background hero"));
    Object.defineProperty(hero, "clientWidth", { value: 500, configurable: true });
    cb();
    assert.deepStrictEqual(h.calls.sizes[h.calls.sizes.length - 1], [500, 100, false]);
    const before = h.calls.sizes.length;
    h.w.dispatchEvent(new h.w.Event("resize"));
    assert.strictEqual(h.calls.sizes.length, before, "a window resize must not resize an element-sized canvas");
  });

  await test("`background missingId`: warns with the load-order hint and does not crash the scene", () => {
    const h = boot("<body></body>");
    const warned = [];
    h.w.console.warn = (m) => warned.push(String(m));
    start(h, scene("background missingId"));
    assert.ok(warned.some((m) => m.includes('"missingId"') && m.includes("end of <body>")), warned.join("|"));
    assert.strictEqual(h.w.document.querySelectorAll("canvas").length, 0, "no stray canvas is left behind when the target is missing");
  });

  await test("`background from \"bg.cdrca\"`: the page-level canvas is placed and the module factory gets (canvas, host)", async () => {
    const h = boot("<body></body>");
    let got = null;
    h.w.Backdrop._importModule = async (p) => { got = { url: p }; return { default: (canvas, host) => { got.canvas = canvas; got.host = host; return () => {}; } }; };
    start(h, scene('background from "bg.cdrca"'));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(got.url, "http://localhost:3000/__cdrca/bg/bg.cdrca.js", "the compiled program is requested relative to the PAGE");
    assert.strictEqual(got.host, h.w.document.body);
    assert.strictEqual(got.canvas.style.position, "fixed");
  });

  await test("`background hero from \"src/bg.cdrca\"`: element target + nested project path", async () => {
    const h = boot('<body><div id="hero"></div></body>');
    let got = null;
    h.w.Backdrop._importModule = async (p) => { got = { url: p }; return { default: (canvas, host) => { got.host = host; } }; };
    start(h, scene('background hero from "src/bg.cdrca"'));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(got.url, "http://localhost:3000/__cdrca/bg/src/bg.cdrca.js");
    assert.strictEqual(got.host, h.w.document.getElementById("hero"));
  });

  // ---- the same four forms again, but written the way a real v2 project
  // spells them (`@id backdrop`) rather than the internal `background` verb
  // above. The grammar plugin rewrites these to exactly the statements
  // already proven end to end above; these four confirm that holds for a
  // full served page, not just at the desugar() text level.

  await test("v2 `@page backdrop`: same whole-page canvas as `background`", () => {
    const h = boot("<body><p>content</p></body>");
    start(h, scene("@page backdrop"));
    const c = h.w.document.body.firstChild;
    assert.strictEqual(c.tagName, "CANVAS");
    assert.strictEqual(h.calls.canvas, c);
    assert.strictEqual(c.getAttribute("data-backdrop-for"), "page");
    assert.deepStrictEqual(h.calls.sizes[0], [1024, 768, false]);
  });

  await test("v2 `@hero backdrop`: same one-element canvas as `background heroSection`", () => {
    const h = boot('<body><div id="hero" style="background:#123"></div></body>');
    const hero = h.w.document.getElementById("hero");
    Object.defineProperty(hero, "clientWidth", { value: 320, configurable: true });
    Object.defineProperty(hero, "clientHeight", { value: 180, configurable: true });
    start(h, scene("@hero backdrop"));
    const c = hero.firstChild;
    assert.strictEqual(c.tagName, "CANVAS");
    assert.strictEqual(h.calls.canvas, c);
    assert.strictEqual(hero.style.isolation, "isolate");
    assert.deepStrictEqual(h.calls.sizes[0], [320, 180, false]);
  });

  await test('v2 `@page backdrop "bg.cdrca"`: same page-level module load as `background from "bg.cdrca"`', async () => {
    const h = boot("<body></body>");
    let got = null;
    h.w.Backdrop._importModule = async (p) => { got = { url: p }; return { default: (canvas, host) => { got.canvas = canvas; got.host = host; return () => {}; } }; };
    start(h, scene('@page backdrop "bg.cdrca"'));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(got.url, "http://localhost:3000/__cdrca/bg/bg.cdrca.js");
    assert.strictEqual(got.host, h.w.document.body);
    assert.strictEqual(got.canvas.style.position, "fixed");
  });

  await test('v2 `@hero backdrop "src/bg.cdrca"`: same element-target module load as `background hero from "..."`', async () => {
    const h = boot('<body><div id="hero"></div></body>');
    let got = null;
    h.w.Backdrop._importModule = async (p) => { got = { url: p }; return { default: (canvas, host) => { got.host = host; } }; };
    start(h, scene('@hero backdrop "src/bg.cdrca"'));
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(got.url, "http://localhost:3000/__cdrca/bg/src/bg.cdrca.js");
    assert.strictEqual(got.host, h.w.document.getElementById("hero"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
