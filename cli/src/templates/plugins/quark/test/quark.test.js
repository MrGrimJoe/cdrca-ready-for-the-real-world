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
  [
    "../quark-core.js",
    "../quark-components.js",
    "../quark-templates.js",
    "../quark-families.js",
  ].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  require("../quark-core.js");
  require("../quark-components.js");
  require("../quark-templates.js");
  require("../quark-families.js");

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
// Design families
// ---------------------------------------------------------------------
//
// NOTE on what this fake DOM can and can't prove: it has no real CSS
// cascade/getComputedStyle (see fakedom.js's own header — it only
// implements what Quark's code calls, not a stylesheet engine), so
// these tests check the STRUCTURAL contract (the right <style> tag
// exists, contains the right token values, unknown names warn instead
// of throwing, back-compat with a plain color value is untouched).
// The actual cascade-ordering claim families.js makes in its own
// comments (setRoot()'s override reliably winning even when called
// before any component has mounted, and a per-element family override
// coexisting with a differently-configured root) was verified
// separately against a real jsdom DOM with real getComputedStyle,
// since that's a claim about browser cascade behavior a fake DOM
// can't actually exercise.

test("families.list() reports all three built-in families", ({ Quark }) => {
  const names = Quark.families.list().map((f) => f.name);
  assert.deepStrictEqual(names.sort(), ["bold", "soft", "structured"]);
});

test("families.setRoot() injects a :root style tag with that family's tokens", ({ document, Quark }) => {
  const ok = Quark.families.setRoot("soft");
  assert.strictEqual(ok, true);
  const tag = [...document.head.children].find((t) => t.getAttribute("data-quark-style") === "quark-family-root");
  assert.ok(tag, "expected a quark-family-root style tag");
  assert.ok(tag.textContent.includes("--quark-radius-sm: 8px"), "soft family's radius-sm should be present");
  assert.ok(tag.textContent.includes("--quark-accent: #635bff"), "soft family's accent should be present");
});

test("families.setRoot() also forces the base token sheet to exist first", ({ document, Quark }) => {
  // Regression check for the real ordering bug found while building this:
  // calling setRoot() before ANY component had ever mounted used to leave
  // quark-core.js's own base :root sheet uninjected, so it would land
  // AFTER (and silently win over) the family's override on the first
  // future mount. Fixed via Quark.__ensureTokensInjected — this asserts
  // that hook actually ran as a side effect of setRoot().
  Quark.families.setRoot("bold");
  const baseTag = [...document.head.children].find((t) => t.getAttribute("data-quark-style") === "quark-tokens");
  assert.ok(baseTag, "setRoot() must force the base token sheet to exist, not just its own override");
});

test("families.applyToElement() scopes tokens under just that element's id", ({ document, makeElementWithId, Quark }) => {
  makeElementWithId("heroButton");
  const ok = Quark.families.applyToElement("heroButton", "structured");
  assert.strictEqual(ok, true);
  const tag = [...document.head.children].find((t) => t.getAttribute("data-quark-style") === "quark:heroButton:family");
  assert.ok(tag, "expected a per-element family style tag");
  assert.ok(tag.textContent.includes("#heroButton"), "override must be scoped under the element's id, not :root");
  assert.ok(tag.textContent.includes("--quark-radius-sm: 3px"), "structured family's radius-sm should be present");
});

test("families.setRoot() with an unknown name warns and returns false, does not throw", ({ Quark }) => {
  assert.doesNotThrow(() => {
    const ok = Quark.families.setRoot("doesNotExist");
    assert.strictEqual(ok, false);
  });
});

test("mount() with value='family:<name>' delegates to families.applyToElement", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("navA");
  Quark.components.mount("navA", "navbar", ["modern"], "family:soft");
  const tag = [...global.document.head.children].find((t) => t.getAttribute("data-quark-style") === "quark:navA:family");
  assert.ok(tag, "a family: value should produce a scoped family style tag, not a plain accent");
  assert.strictEqual(el.style.getPropertyValue("--quark-accent"), "", "family: values must NOT also set a raw accent color");
});

test("mount() with a plain color value keeps working exactly as before (back-compat)", ({ makeElementWithId, Quark }) => {
  const el = makeElementWithId("navB");
  Quark.components.mount("navB", "navbar", ["modern"], "#2563eb");
  assert.strictEqual(el.style.getPropertyValue("--quark-accent"), "#2563eb");
});

// ---------------------------------------------------------------------
// Real WCAG contrast regressions found by auditing every component
// against every family (see quark-families.js's header comment for the
// one limitation this audit found but deliberately did not fix here).
// These pin the actual fixes so they can't silently regress: overlay
// tokens flipping correctly for a dark-first family, and the bold
// family's accent clearing AA 4.5:1 as a white-text background.
// ---------------------------------------------------------------------

function relLuminance(r, g, b) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(rgb1, rgb2) {
  const l1 = relLuminance(...rgb1);
  const l2 = relLuminance(...rgb2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function hexToRgb(hex) {
  hex = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

test("structured family's overlay tokens are white-based, not the light-surface default (dark-surface contrast fix)", ({ Quark }) => {
  const structured = Quark.families._definitions.structured.vars;
  assert.ok(structured["--quark-overlay"], "structured must override --quark-overlay for its dark surface");
  const rgbaMatch = /rgba\(255,\s*255,\s*255/.exec(structured["--quark-overlay"]);
  assert.ok(rgbaMatch, `structured's --quark-overlay must be white-based, got: ${structured["--quark-overlay"]}`);
});

test("bold family's accent clears WCAG AA 4.5:1 as a white-text button background (regression: original #ff5a1f only reached 3.12:1)", ({ Quark }) => {
  const bold = Quark.families._definitions.bold.vars;
  const ratio = contrastRatio([255, 255, 255], hexToRgb(bold["--quark-accent"]));
  assert.ok(ratio >= 4.5, `bold accent ${bold["--quark-accent"]} only reaches ${ratio.toFixed(2)}:1 with white text, needs >= 4.5`);
});

test("every family's accent clears at least AA-large (3:1) as a white-text button background", ({ Quark }) => {
  for (const { name } of Quark.families.list()) {
    const vars = Quark.families._definitions[name].vars;
    const ratio = contrastRatio([255, 255, 255], hexToRgb(vars["--quark-accent"]));
    assert.ok(ratio >= 3.0, `${name}'s accent ${vars["--quark-accent"]} only reaches ${ratio.toFixed(2)}:1 with white text`);
  }
});

test("every family's effective accent-TEXT color (--quark-accent-text if set, else --quark-accent) clears WCAG AA 4.5:1 against that family's own default surface (regression: structured's plain accent as text was only 3.51:1 on its dark surface)", ({ Quark }) => {
  for (const { name } of Quark.families.list()) {
    const vars = Quark.families._definitions[name].vars;
    const accentText = vars["--quark-accent-text"] || vars["--quark-accent"];
    // structured is dark-first (its own --quark-surface-dark is the
    // default surface text-role accent sits on); soft/bold are
    // light-first (--quark-surface-light).
    const surfaceKey = name === "structured" ? "--quark-surface-dark" : "--quark-surface-light";
    const surface = hexToRgb(vars[surfaceKey]);
    const ratio = contrastRatio(surface, hexToRgb(accentText));
    assert.ok(
      ratio >= 4.5,
      `${name}'s effective accent-text ${accentText} only reaches ${ratio.toFixed(2)}:1 against its own ${surfaceKey} ${vars[surfaceKey]}`
    );
  }
});

test("quark-components.js only points text-role CSS ('color: ...') at --quark-accent-text, never at bare --quark-accent for a color declaration", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "../quark-components.js"), "utf8");
  // Negative lookbehind excludes "accent-color:" and "border-top-color:"
  // (real, intentionally-unchanged non-text uses) — only matches the
  // actual CSS "color:" text-color property.
  const bareAccentAsColor = /(?<![-\w])color:\s*var\(--quark-accent,/g;
  const matches = src.match(bareAccentAsColor) || [];
  assert.strictEqual(
    matches.length,
    0,
    `found ${matches.length} "color: var(--quark-accent, ...)" call site(s) that should read --quark-accent-text instead: ${JSON.stringify(matches)}`
  );
});

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
