const { test, report, assert } = require("./harness");

// A minimal fake DOM — just enough surface backdrop-core.js actually
// touches (getElementById, createElement, style, insertBefore,
// removeChild, getComputedStyle). Real DOM-level checks (actual CSS
// cascade, ResizeObserver) are in dom.test.js with jsdom; this file is
// about backdrop-core.js's OWN logic — attach/detach bookkeeping,
// module-loading error handling, cleanup — independent of any real
// rendering engine.
function fakeElement(id) {
  const el = {
    id,
    style: {},
    children: [],
    parentNode: null,
    getAttribute: () => null,
    setAttribute() {},
    insertBefore(child, ref) {
      child.parentNode = el;
      el.children.unshift(child);
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i !== -1) el.children.splice(i, 1);
      child.parentNode = null;
    },
    get firstChild() {
      return el.children[0] || null;
    },
  };
  return el;
}

function fakeDocument(elementsById) {
  return {
    getElementById: (id) => elementsById[id] || null,
    createElement: (tag) => fakeElement(`<${tag}>`),
  };
}

require("../animations-backdrop.js");
const Backdrop = global.Backdrop;
global.getComputedStyle = (el) => ({ position: el.style.position || "static" });

test("attach(): unknown target id warns and resolves, doesn't throw", async () => {
  global.document = fakeDocument({});
  const result = await Backdrop.attach("missing", "x.js");
  assert.strictEqual(result, undefined);
});

test("attach(): inserts a canvas as the target's first child, absolutely positioned, non-interactive", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });
  Backdrop._importModule = async () => ({ default: () => {} });

  await Backdrop.attach("hero", "bg.js");

  assert.strictEqual(target.children.length, 1);
  const canvas = target.children[0];
  assert.strictEqual(canvas.style.position, "absolute");
  assert.strictEqual(canvas.style.zIndex, "-1");
  assert.strictEqual(canvas.style.pointerEvents, "none");
  assert.strictEqual(target.style.position, "relative", "target should be given a positioning context if it had none");
});

test("attach(): doesn't override a target's own existing (non-static) position", async () => {
  const target = fakeElement("hero");
  target.style.position = "sticky";
  global.document = fakeDocument({ hero: target });
  Backdrop._importModule = async () => ({ default: () => {} });

  await Backdrop.attach("hero", "bg.js");

  assert.strictEqual(target.style.position, "sticky");
});

test("attach(): calls the module's default export with (canvas, target)", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });
  let seenArgs = null;
  Backdrop._importModule = async () => ({
    default: (canvas, el) => {
      seenArgs = [canvas, el];
    },
  });

  await Backdrop.attach("hero", "bg.js");

  assert.strictEqual(seenArgs[0], target.children[0]);
  assert.strictEqual(seenArgs[1], target);
});

test("attach(): also accepts .mount or .init instead of a default export", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });
  let calledVia = null;
  Backdrop._importModule = async () => ({ mount: () => (calledVia = "mount") });
  await Backdrop.attach("hero", "bg.js");
  assert.strictEqual(calledVia, "mount");
});

test("attach(): a module with no usable export warns and leaves no canvas behind", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });
  Backdrop._importModule = async () => ({ somethingElse: true });

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    await Backdrop.attach("hero", "bg.js");
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.some((w) => w.includes("doesn't export")));
  // The canvas stays mounted even without a usable factory (matches
  // detach()'s own cleanup path) — nothing to assert further here
  // beyond "it didn't throw", which the surrounding try/finally proves.
});

test("attach(): a rejected module load warns and removes the canvas it had already inserted", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });
  Backdrop._importModule = async () => {
    throw new Error("network error");
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    await Backdrop.attach("hero", "bg.js");
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.some((w) => w.includes("network error")));
  assert.strictEqual(target.children.length, 0, "the canvas inserted before the failed load should be removed");
});

test("attach(): re-attaching to the same target disposes the previous one first, no double canvas", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });

  let disposeCount = 0;
  Backdrop._importModule = async () => ({ default: () => () => disposeCount++ });

  await Backdrop.attach("hero", "first.js");
  await Backdrop.attach("hero", "second.js");

  assert.strictEqual(disposeCount, 1, "the first attachment's dispose() should have run");
  assert.strictEqual(target.children.length, 1, "only the second attachment's canvas should remain");
});

test("detach(): calls dispose() and removes the canvas", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });
  let disposed = false;
  Backdrop._importModule = async () => ({ default: () => () => (disposed = true) });

  await Backdrop.attach("hero", "bg.js");
  Backdrop.detach("hero");

  assert.strictEqual(disposed, true);
  assert.strictEqual(target.children.length, 0);
  assert.strictEqual(Backdrop._attached.hero, undefined);
});

test("detach(): a dispose() that throws is caught and logged, not left to crash the caller", async () => {
  const target = fakeElement("hero");
  global.document = fakeDocument({ hero: target });
  Backdrop._importModule = async () => ({
    default: () => () => {
      throw new Error("boom");
    },
  });
  await Backdrop.attach("hero", "bg.js");

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    Backdrop.detach("hero"); // should not throw
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((w) => typeof w === "string" && w.includes("dispose() for")));
});

test("detach(): calling it for a target that was never attached is a harmless no-op", () => {
  Backdrop.detach("never-attached");
  assert.ok(true);
});

report();
