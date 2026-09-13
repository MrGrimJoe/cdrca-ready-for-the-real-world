// Plain-Node test runner for Quark's runtime (no test framework dependency,
// matching the "no unnecessary runtime dependencies" constraint). Run with:
//   node test/quark.test.js
"use strict";

const assert = require("assert");
const path = require("path");
const { installFakeGlobals } = require("./fakedom");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  const { document, makeElementWithId } = installFakeGlobals();
  // Fresh module registry per test: clear require cache for the three
  // Quark files so each test gets an isolated Quark.components registry.
  delete global.Quark;
  ["../quark-core.js", "../quark-components.js", "../quark-templates.js"].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  require("../quark-core.js");
  require("../quark-components.js");
  require("../quark-templates.js");

  try {
    fn({ document, makeElementWithId, Quark: global.Quark });
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.message}`);
  }
}

console.log("Quark test suite\n");

// ---------------------------------------------------------------------
// Backward compatibility: original sidebar directive must work unchanged.
// ---------------------------------------------------------------------

test("sidebar.closable.edgy — exact original directive shape still works", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("sidebar");
  const instance = Quark.components.mount("sidebar", "sidebar", ["closable", "edgy"], "#2563eb");
  assert.ok(instance, "mount should return an instance");
  assert.strictEqual(instance.variantName, null, "sidebar declares no variants — nothing should be consumed as a variant");
  assert.deepStrictEqual(instance.modifiers, ["closable", "edgy"], "both tokens must remain modifiers, in order");
  assert.strictEqual(el.style.getPropertyValue("--quark-accent"), "#2563eb");
  // closable behavior actually attached a real close button
  const closeBtn = el.children.find((c) => c.textContent === "\u2715");
  assert.ok(closeBtn, "closable modifier should append a real close button");
});

test("sidebar with no modifiers still mounts (non-closable by default)", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("sidebar2");
  const instance = Quark.components.mount("sidebar2", "sidebar", [], null);
  assert.ok(instance);
  assert.strictEqual(instance.modifiers.length, 0);
  const closeBtn = el.children.find((c) => c.textContent === "\u2715");
  assert.strictEqual(closeBtn, undefined, "sidebar must not be closable unless explicitly requested");
});

// ---------------------------------------------------------------------
// New variant system
// ---------------------------------------------------------------------

test("navbar.modern resolves 'modern' as a variant, not a modifier", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("mainNav");
  const instance = Quark.components.mount("mainNav", "navbar", ["modern"], null);
  assert.strictEqual(instance.variantName, "modern");
  assert.deepStrictEqual(instance.modifiers, []);
  assert.strictEqual(el.getAttribute("data-quark-variant"), "modern");
});

test("navbar.glass.sticky — variant + modifier both resolve correctly", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("mainNav2");
  const instance = Quark.components.mount("mainNav2", "navbar", ["glass", "sticky"], null);
  assert.strictEqual(instance.variantName, "glass");
  assert.deepStrictEqual(instance.modifiers, ["sticky"]);
});

test("changing only the variant word changes the applied style key (modern -> glass)", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("mainNav3");
  const i1 = Quark.components.mount("mainNav3", "navbar", ["modern"], null);
  const i2 = Quark.components.mount("mainNav3", "navbar", ["glass"], null);
  assert.notStrictEqual(i1.variantName, i2.variantName);
  assert.strictEqual(i2.variantName, "glass");
});

test("navbar with no variant token falls back to defaultVariant", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("mainNav4");
  const instance = Quark.components.mount("mainNav4", "navbar", [], null);
  assert.strictEqual(instance.variantName, "modern", "navbar's declared defaultVariant");
});

test("unknown variant name falls through to a plain modifier lookup safely", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("mainNav5");
  // "nonexistentVariant" isn't a declared navbar variant, so it is NOT
  // consumed as the variant — the default variant applies instead, and
  // the unknown token is treated as an (also unknown) modifier and warned.
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  const instance = Quark.components.mount("mainNav5", "navbar", ["nonexistentVariant"], null);
  console.warn = originalWarn;
  assert.strictEqual(instance.variantName, "modern");
  assert.ok(warned, "should warn about the unknown modifier");
});

// ---------------------------------------------------------------------
// Target / component resolution
// ---------------------------------------------------------------------

test("unknown component name fails gracefully (no throw, no instance)", ({ makeElementWithId, Quark }) => {
  makeElementWithId("someEl");
  const originalError = console.error;
  let errored = false;
  console.error = () => { errored = true; };
  const instance = Quark.components.mount("someEl", "totallyMadeUpComponent", [], null);
  console.error = originalError;
  assert.strictEqual(instance, null);
  assert.ok(errored);
});

test("missing target element fails gracefully (no throw, no instance)", ({ Quark }) => {
  const originalError = console.error;
  let errored = false;
  console.error = () => { errored = true; };
  const instance = Quark.components.mount("doesNotExist", "navbar", ["modern"], null);
  console.error = originalError;
  assert.strictEqual(instance, null);
  assert.ok(errored);
});

// ---------------------------------------------------------------------
// Multiple / nested components, child content preservation
// ---------------------------------------------------------------------

test("multiple different components can be mounted independently", ({ makeElementWithId, Quark }) => {
  makeElementWithId("navA");
  makeElementWithId("cardA");
  const nav = Quark.components.mount("navA", "navbar", ["glass"], null);
  const card = Quark.components.mount("cardA", "card", ["elevated"], null);
  assert.strictEqual(nav.variantName, "glass");
  assert.strictEqual(card.variantName, "elevated");
  assert.notStrictEqual(Quark.components.getInstance("navA"), Quark.components.getInstance("cardA"));
});

test("nested components (card inside a mounted sidebar) both resolve independently", ({ makeElementWithId, Quark }) => {
  const sidebar = makeElementWithId("sidebarWithCard");
  const innerCard = new (require("./fakedom").FakeElement)("div");
  innerCard.setAttribute("id", "innerProfileCard");
  global.document.register(innerCard);
  sidebar.appendChild(innerCard);

  const sInstance = Quark.components.mount("sidebarWithCard", "sidebar", ["edgy"], null);
  const cInstance = Quark.components.mount("innerProfileCard", "card", ["outlined"], null);
  assert.deepStrictEqual(sInstance.modifiers, ["edgy"]);
  assert.strictEqual(cInstance.variantName, "outlined");
  assert.strictEqual(sidebar.children.includes(innerCard), true, "nested child must remain in the DOM, untouched");
});

test("card preserves existing child content (heading/paragraph/button untouched)", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("profileCard");
  const h2 = new (require("./fakedom").FakeElement)("h2");
  h2.textContent = "Profile";
  const p = new (require("./fakedom").FakeElement)("p");
  p.textContent = "Some information";
  el.appendChild(h2);
  el.appendChild(p);
  Quark.components.mount("profileCard", "card", ["elevated"], null);
  assert.strictEqual(el.children.length, 2, "card must not add/remove/replace the user's children");
  assert.strictEqual(el.children[0].textContent, "Profile");
  assert.strictEqual(el.children[1].textContent, "Some information");
});

// ---------------------------------------------------------------------
// Variant switching / safe repeated mounting / unmounting
// ---------------------------------------------------------------------

test("re-mounting the same element with a new variant is safe (no duplicate listeners/state)", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("switchNav");
  Quark.components.mount("switchNav", "navbar", ["modern"], null);
  const second = Quark.components.mount("switchNav", "navbar", ["glass"], null);
  assert.strictEqual(second.variantName, "glass");
  assert.strictEqual(Quark.components.getInstance("switchNav").variantName, "glass");
});

test("duplicate mounting of sidebar.closable does not attach two close buttons", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("dupSidebar");
  Quark.components.mount("dupSidebar", "sidebar", ["closable"], null);
  Quark.components.mount("dupSidebar", "sidebar", ["closable"], null);
  const closeButtons = el.children.filter((c) => c.textContent === "\u2715");
  assert.strictEqual(closeButtons.length, 1, "remounting must not duplicate the close button");
});

test("unmount removes the tracked instance and runs component unmount logic", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("modalToUnmount");
  el.hidden = true; // avoid auto-open behavior touching document.body in this test
  Quark.components.mount("modalToUnmount", "modal", ["modern"], null);
  const removed = Quark.components.unmount("modalToUnmount");
  assert.strictEqual(removed, true);
  assert.strictEqual(Quark.components.getInstance("modalToUnmount"), null);
});

test("unmounting a never-mounted element returns false, does not throw", ({ Quark }) => {
  assert.strictEqual(Quark.components.unmount("neverMounted"), false);
});

test("unmounting sidebar.closable removes the close button it added", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("closableToUnmount");
  Quark.components.mount("closableToUnmount", "sidebar", ["closable"], null);
  assert.strictEqual(el.children.filter((c) => c.textContent === "\u2715").length, 1);
  Quark.components.unmount("closableToUnmount");
  assert.strictEqual(el.children.filter((c) => c.textContent === "\u2715").length, 0, "cleanup must remove the appended close button");
});

test("repeated progress mounts never leave more than one fill bar", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("uploadBar");
  el.setAttribute("data-progress", "40");
  Quark.components.mount("uploadBar", "progress", ["modern"], null);
  Quark.components.mount("uploadBar", "progress", ["modern"], null);
  const fills = el.children.filter((c) => c.className === "quark-progress-fill");
  assert.strictEqual(fills.length, 1, "remounting progress must not duplicate the fill element");
});

// ---------------------------------------------------------------------
// Registry extensibility — third-party component registration
// ---------------------------------------------------------------------

test("a brand-new component can be registered and mounted without touching quark-core.js", ({ makeElementWithId, Quark }) => {
  Quark.components.register({
    name: "timeline",
    defaultVariant: "modern",
    variants: { modern: { css: `display:flex;` } },
    base() {},
  });
  const el = makeElementWithId("myTimeline");
  const instance = Quark.components.mount("myTimeline", "timeline", ["modern"], null);
  assert.ok(instance, "a component registered at runtime must mount successfully");
  assert.ok(Quark.components.list().includes("timeline"));
});

// ---------------------------------------------------------------------
// Compatibility shim — Quark.UI.mount must keep working (what plugin.js's
// generated JS_BLOCK actually calls)
// ---------------------------------------------------------------------

test("Quark.UI.mount (compat shim) forwards correctly to the registry", ({ makeElementWithId, Quark }) => {
  require("../quark-ui.js");
  const el = makeElementWithId("shimSidebar");
  const instance = global.Quark.UI.mount("shimSidebar", "sidebar", ["closable", "edgy"], "#111111");
  assert.ok(instance);
  assert.deepStrictEqual(instance.modifiers, ["closable", "edgy"]);
  assert.strictEqual(el.style.getPropertyValue("--quark-accent"), "#111111");
});

// ---------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------

test("template scaffold() creates missing parts without overwriting existing ones", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("navToScaffold");
  const existingBrand = new (require("./fakedom").FakeElement)("div");
  existingBrand.setAttribute("data-quark-part", "brand");
  existingBrand.textContent = "My App";
  el.appendChild(existingBrand);

  Quark.templates.scaffold("navbar", "logo-links-actions", el);
  const brand = Quark.components.findPart(el, "brand");
  const nav = Quark.components.findPart(el, "navigation");
  const actions = Quark.components.findPart(el, "actions");
  assert.strictEqual(brand.textContent, "My App", "existing brand content must be preserved, not overwritten");
  assert.ok(nav, "missing navigation part should be scaffolded");
  assert.ok(actions, "missing actions part should be scaffolded");
});

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
