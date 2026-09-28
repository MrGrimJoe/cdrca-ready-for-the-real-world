// Tests for the page/element placement added on top of the original
// attach()/detach() — real jsdom DOM, real style attributes, no fake elements.
let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  console.log("SKIPPED: jsdom isn't installed — run `npm install jsdom` to enable this file.");
  process.exit(0);
}
const { test, report, assert } = require("./harness");

const dom = new JSDOM(
  '<!doctype html><html><body><p id="intro">hi</p><div id="hero" style="background:#123"></div>' +
    '<div id="sticky" style="position:sticky"></div></body></html>',
  { pretendToBeVisual: true, runScripts: "dangerously", url: "http://localhost:3000/page/" }
);
global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = dom.window.getComputedStyle;
// The module under test reads everything from `window` (the jsdom window here).
Object.defineProperty(dom.window, "innerWidth", { value: 1024, configurable: true });
Object.defineProperty(dom.window, "innerHeight", { value: 768, configurable: true });

require("../animations-backdrop.js");
const Backdrop = dom.window.Backdrop;

function quiet(fn) {
  const w = console.warn;
  const seen = [];
  console.warn = (m) => seen.push(String(m));
  try {
    return { result: fn(), seen };
  } finally {
    console.warn = w;
  }
}

test("place(null): whole page — fixed, full-size, behind everything, first child of <body>", () => {
  const h = Backdrop.place(null);
  const body = dom.window.document.body;
  assert.strictEqual(body.firstChild, h.canvas);
  assert.strictEqual(h.canvas.style.position, "fixed");
  assert.strictEqual(h.canvas.style.zIndex, "-1");
  assert.strictEqual(h.canvas.style.pointerEvents, "none");
  assert.strictEqual(h.canvas.style.width, "100%");
  assert.strictEqual(h.canvas.getAttribute("data-backdrop-for"), "page");
  assert.strictEqual(body.style.isolation, "isolate", "body must be its own stacking context or a body background can hide the canvas");
  h.canvas.remove();
});

test("place(id): the element becomes the positioning context and stacking context", () => {
  const hero = dom.window.document.getElementById("hero");
  const h = Backdrop.place("hero");
  assert.strictEqual(hero.firstChild, h.canvas);
  assert.strictEqual(h.canvas.style.position, "absolute");
  assert.strictEqual(hero.style.position, "relative");
  assert.strictEqual(hero.style.isolation, "isolate", "an element with its own background would otherwise cover the canvas");
  assert.strictEqual(h.canvas.getAttribute("data-backdrop-for"), "hero");
  h.canvas.remove();
});

test("place(id): an existing non-static position is left alone", () => {
  const el = dom.window.document.getElementById("sticky");
  const h = Backdrop.place("sticky");
  assert.strictEqual(el.style.position, "sticky");
  h.canvas.remove();
});

test("place(id): a missing element warns (with the load-order hint) and returns null", () => {
  const { result, seen } = quiet(() => Backdrop.place("nope"));
  assert.strictEqual(result, null);
  assert.ok(seen.some((m) => m.includes('"nope"') && m.includes("end of <body>")));
});

test("size(): the page uses the window, an element uses its own box, never 0", () => {
  const page = Backdrop.place(null);
  assert.deepStrictEqual(page.size(), { width: 1024, height: 768 });
  page.canvas.remove();

  const hero = dom.window.document.getElementById("hero");
  Object.defineProperty(hero, "clientWidth", { value: 320, configurable: true });
  Object.defineProperty(hero, "clientHeight", { value: 180, configurable: true });
  const div = Backdrop.place("hero");
  assert.deepStrictEqual(div.size(), { width: 320, height: 180 });
  Object.defineProperty(hero, "clientWidth", { value: 0, configurable: true });
  assert.strictEqual(div.size().width, 1, "an unlaid-out element must not produce a zero-size drawing buffer");
  div.canvas.remove();
});

test("watch(): the page listens to window resize and stops when told to", () => {
  const page = Backdrop.place(null);
  let calls = 0;
  const stop = page.watch(() => calls++);
  dom.window.dispatchEvent(new dom.window.Event("resize"));
  assert.strictEqual(calls, 1);
  stop();
  dom.window.dispatchEvent(new dom.window.Event("resize"));
  assert.strictEqual(calls, 1, "must not fire after stop()");
  page.canvas.remove();
});

test("watch(): an element observes ITS OWN size (ResizeObserver), not the window", () => {
  let observed = null, cb = null, disconnected = false;
  dom.window.ResizeObserver = class {
    constructor(fn) { cb = fn; }
    observe(el) { observed = el; }
    disconnect() { disconnected = true; }
  };
  const h = Backdrop.place("hero");
  let calls = 0;
  const stop = h.watch(() => calls++);
  assert.strictEqual(observed, dom.window.document.getElementById("hero"));
  cb();
  assert.strictEqual(calls, 1);
  dom.window.dispatchEvent(new dom.window.Event("resize"));
  assert.strictEqual(calls, 1, "window resize must not drive an element-sized backdrop");
  stop();
  assert.strictEqual(disconnected, true);
  delete dom.window.ResizeObserver;
  h.canvas.remove();
});

test("adopt(): wraps a canvas that attach() already placed, remembering whether it is the page", () => {
  const h = Backdrop.place(null);
  const again = Backdrop.adopt(h.canvas, h.host);
  assert.strictEqual(again.page, true);
  assert.deepStrictEqual(again.size(), { width: 1024, height: 768 });
  h.canvas.remove();
});

test("attach(null, ...): whole-page module backdrop, keyed separately from any element", async () => {
  let args = null, disposed = 0;
  Backdrop._importModule = async () => ({ default: (canvas, host) => { args = [canvas, host]; return () => disposed++; } });
  await Backdrop.attach(null, "bg.js");
  assert.strictEqual(args[1], dom.window.document.body);
  assert.strictEqual(args[0].style.position, "fixed");
  assert.ok(Backdrop._attached["(page)"]);
  Backdrop.detach(null);
  assert.strictEqual(disposed, 1);
  assert.strictEqual(dom.window.document.body.querySelector("canvas"), null);
  assert.strictEqual(Backdrop._attached["(page)"], undefined);
});

test("attach(): page and element backdrops coexist independently", async () => {
  Backdrop._importModule = async () => ({ default: () => () => {} });
  await Backdrop.attach(null, "a.js");
  await Backdrop.attach("hero", "b.js");
  assert.strictEqual(dom.window.document.querySelectorAll("canvas").length, 2);
  Backdrop.detach("hero");
  assert.strictEqual(dom.window.document.querySelectorAll("canvas").length, 1, "detaching the element must not touch the page's");
  Backdrop.detach(null);
});

test("programUrl(): a compiled .cdrca background is addressed relative to the PAGE, not the runtime folder", () => {
  assert.strictEqual(Backdrop.programUrl("src/bg.cdrca"), "http://localhost:3000/page/__cdrca/bg/src/bg.cdrca.js");
});

test("attach(): relative module paths resolve against the page; absolute URLs pass through untouched", async () => {
  const seen = [];
  Backdrop._importModule = async (p) => { seen.push(p); return { default: () => {} }; };
  await Backdrop.attach("hero", "./x.js");
  await Backdrop.attach("hero", "sub/y.js");
  await Backdrop.attach("hero", "https://cdn.example.com/z.js");
  assert.deepStrictEqual(seen, [
    "http://localhost:3000/page/x.js",
    "http://localhost:3000/page/sub/y.js",
    "https://cdn.example.com/z.js",
  ]);
  Backdrop.detach("hero");
});

report();
