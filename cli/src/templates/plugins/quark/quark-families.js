// Quark design families — optional library bundle (quark.families).
//
// A "family" is NOT a fork of component logic. Every component already
// reads shared tokens (var(--quark-radius-sm), var(--quark-shadow-md),
// var(--quark-accent), ...) rather than hardcoded values (see
// quark-components.js's own header comment). A family is just an
// alternate, named SET of those same token values — so switching or
// mixing families never means switching component implementations.
//
// Every property name below was checked against quark-core.js's real
// QuarkTokens object (space/radius/font/shadow/transition/surface/border),
// so a family only ever overrides a token components already read — with
// exactly one deliberate exception, called out where it's defined below.
//
// Two ways to apply a family:
//   1. Whole-app:      Quark.families.setRoot("structured")
//      Overrides the :root token values every component reads by default.
//   2. Per-component:  @myButton button.primary = family:soft
//      Overrides tokens scoped under just #myButton — every OTHER
//      component keeps reading the root family (or plain defaults) —
//      which is what makes hybrids ("soft button in an otherwise
//      structured app") fall directly out of the existing per-element
//      CSS-scoping mechanism (scopeCss/applyCss in quark-core.js), not a
//      new mechanism. Works directly from .cdrca source — quark-core.js's
//      mount() recognizes the "family:<name>" value prefix and calls
//      applyToElement itself (see the note at the bottom of this file).
//
// FOLLOW-UP SHIPPED: a single --quark-accent value can't serve two
// contrast-opposite roles at once — (a) a solid FILL with white text on
// top (button.primary/solid), which needs a darker/more saturated
// accent, and (b) accent-colored TEXT sitting directly on a surface
// (button.outlined/soft/flat, the "active" tab label), which needs a
// LIGHTER accent when that surface is dark. No single hex clears WCAG AA
// 4.5:1 in both roles at once for a dark-first family. Fixed by adding
// --quark-accent-text: a second token, read only by the ~6 real
// text-role call sites in quark-components.js (button/badge
// outlined/soft/flat text, the active tab label) — border/background/
// focus-ring/native-input-accent uses stay on --quark-accent unchanged,
// since those only need the non-text 3:1 UI-component threshold, which
// --quark-accent already clears everywhere (see the "every family's
// accent clears at least AA-large" test).
//
// Only structured sets --quark-accent-text below: its default accent
// (#5b5bd6) is ~3.51:1 against its own dark root surface (#111113) —
// AA-large, not full AA — so structured gets a lightened, same-hue
// accent-text (#7d7dec, 5.40:1) for the text role, while keeping its
// original #5b5bd6 for fills. soft and bold are light-first and their
// accent already clears 4.5:1 as text on their own default surface
// (soft #635bff -> 4.70:1, bold #d1440e -> 4.62:1 on white), so they
// intentionally leave --quark-accent-text unset — it falls back to
// --quark-accent (var(--quark-accent-text, var(--quark-accent, ...))),
// same value, one fewer override to reason about. Set it explicitly for
// soft/bold too only if you retune either family's --quark-accent to
// something that no longer clears 4.5:1 as text on its own surface.

(function (global) {
  "use strict";

  const Quark = global.Quark;
  if (!Quark || !Quark.css) {
    console.error("Quark families library: quark-core.js must be loaded first.");
    return;
  }

  // -----------------------------------------------------------------
  // Family definitions. Each is a flat map of `--quark-<group>-<key>`
  // custom-property names — the exact names quark-core.js's
  // injectTokens() generates from QuarkTokens (space, radius, font,
  // shadow, transition, surface, border) — plus --quark-accent (also
  // settable per-instance, see quark-core.js's mount()) and its
  // text-role counterpart --quark-accent-text (family-level only — see
  // this file's header comment for when a family actually needs it). A
  // family only lists the properties it wants to CHANGE;
  // anything it omits keeps whatever the root default (or an outer
  // family) already set.
  //
  // "--quark-font-mono" below is the one deliberate exception: it is
  // NOT one of quark-core.js's existing token names. It's included so a
  // future/updated component (e.g. a code block, a metrics label) can
  // opt into it, but no component ships today that reads it — so
  // setting the structured family alone will not visibly change any
  // font to monospace yet. Listed honestly as forward-looking, not
  // implied to already do something it doesn't.
  // -----------------------------------------------------------------

  const FAMILIES = {
    // Structured / Minimal — Linear/Vercel/Raycast-like: dark-first,
    // sharp corners, tight spacing, near-flat shadows (hairline-style
    // outlines instead of drop shadows).
    structured: {
      vars: {
        "--quark-accent": "#5b5bd6",
        // Text-role accent only (button/badge outlined/soft/flat text,
        // active tab label) — see the file header comment above. Fills
        // (button.primary/solid) keep reading --quark-accent directly.
        "--quark-accent-text": "#7d7dec",
        "--quark-radius-sharp": "0px",
        "--quark-radius-sm": "3px",
        "--quark-radius-md": "5px",
        "--quark-radius-lg": "8px",
        "--quark-radius-pill": "999px",
        "--quark-space-xs": "4px",
        "--quark-space-sm": "6px",
        "--quark-space-md": "10px",
        "--quark-space-lg": "16px",
        "--quark-space-xl": "24px",
        "--quark-font-sans":
          '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
        "--quark-font-mono": '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
        "--quark-font-sizeSm": "12.5px",
        "--quark-font-sizeMd": "14px",
        "--quark-font-sizeLg": "17px",
        "--quark-font-weightMedium": "500",
        "--quark-font-weightBold": "600",
        "--quark-shadow-sm": "0 0 0 1px rgba(255,255,255,.06)",
        "--quark-shadow-md": "0 0 0 1px rgba(255,255,255,.08)",
        "--quark-shadow-lg": "0 0 0 1px rgba(255,255,255,.1), 0 8px 24px rgba(0,0,0,.4)",
        "--quark-surface-light": "#fbfbfc",
        "--quark-surface-dark": "#111113",
        "--quark-border-hairline": "1px solid rgba(255,255,255,.08)",
        // Dark-first family -> overlay tints need their white-based
        // equivalents, or every component using var(--quark-overlay,
        // <light-literal-fallback>) would fall through to a
        // near-invisible-on-dark literal (a real contrast bug found
        // while auditing families against every component — see
        // quark-core.js's "overlay" token group comment for the full
        // story).
        "--quark-overlay-subtle": "rgba(255,255,255,.05)",
        "--quark-overlay": "rgba(255,255,255,.09)",
        "--quark-overlay-strong": "rgba(255,255,255,.16)",
        "--quark-transition-fast": "100ms ease",
        "--quark-transition-normal": "160ms ease",
      },
      docs: "Dark-first, sharp corners, tight spacing, flat hairline shadows. Linear/Vercel/Raycast-like.",
    },

    // Soft / Friendly — Stripe/Notion-like: light-first, generous
    // rounded corners, roomy spacing, soft diffuse shadows instead of
    // hairline borders.
    soft: {
      vars: {
        "--quark-accent": "#635bff",
        "--quark-radius-sharp": "4px",
        "--quark-radius-sm": "8px",
        "--quark-radius-md": "12px",
        "--quark-radius-lg": "20px",
        "--quark-radius-pill": "999px",
        "--quark-space-xs": "6px",
        "--quark-space-sm": "10px",
        "--quark-space-md": "16px",
        "--quark-space-lg": "28px",
        "--quark-space-xl": "44px",
        "--quark-font-sans": '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        "--quark-font-sizeSm": "13.5px",
        "--quark-font-sizeMd": "15.5px",
        "--quark-font-sizeLg": "19px",
        "--quark-font-weightMedium": "500",
        "--quark-font-weightBold": "650",
        "--quark-shadow-sm": "0 1px 3px rgba(20,20,43,.08)",
        "--quark-shadow-md": "0 6px 20px rgba(20,20,43,.10)",
        "--quark-shadow-lg": "0 16px 40px rgba(20,20,43,.14)",
        "--quark-surface-light": "#ffffff",
        "--quark-surface-dark": "#1a1b25",
        "--quark-border-hairline": "1px solid rgba(20,20,43,.08)",
        // Light-first family; kept close to the default overlay tints
        // but tinted toward the accent's cool tone for consistency,
        // and slightly gentler to match the "soft" aesthetic overall.
        "--quark-overlay-subtle": "rgba(20,20,43,.025)",
        "--quark-overlay": "rgba(20,20,43,.05)",
        "--quark-overlay-strong": "rgba(20,20,43,.1)",
        "--quark-transition-fast": "140ms ease-out",
        "--quark-transition-normal": "220ms ease-out",
      },
      docs: "Light-first, generous radius, soft diffuse shadows, roomy spacing. Stripe/Notion-like.",
    },

    // Bold / Editorial — Attio/Arc-like: heavier type, higher contrast,
    // larger touch targets, more assertive fills instead of tints.
    bold: {
      vars: {
        // Real WCAG contrast check found the original #ff5a1f only hit
        // 3.12:1 for white button text — passes AA for large text but
        // fails AA's 4.5:1 threshold for normal-size button labels.
        // Darkened while keeping the same hue; #d1440e clears 4.62:1.
        "--quark-accent": "#d1440e",
        "--quark-radius-sharp": "2px",
        "--quark-radius-sm": "6px",
        "--quark-radius-md": "10px",
        "--quark-radius-lg": "16px",
        "--quark-radius-pill": "999px",
        "--quark-space-xs": "6px",
        "--quark-space-sm": "12px",
        "--quark-space-md": "18px",
        "--quark-space-lg": "32px",
        "--quark-space-xl": "52px",
        "--quark-font-sans":
          '"General Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        "--quark-font-sizeSm": "14px",
        "--quark-font-sizeMd": "16px",
        "--quark-font-sizeLg": "21px",
        "--quark-font-weightMedium": "600",
        "--quark-font-weightBold": "800",
        "--quark-shadow-sm": "0 2px 6px rgba(0,0,0,.12)",
        "--quark-shadow-md": "0 8px 24px rgba(0,0,0,.16)",
        "--quark-shadow-lg": "0 20px 50px rgba(0,0,0,.22)",
        "--quark-surface-light": "#ffffff",
        "--quark-surface-dark": "#15130f",
        "--quark-border-hairline": "2px solid rgba(0,0,0,.9)",
        // Light-first family; slightly punchier/darker tints than the
        // default to match the family's higher-contrast aesthetic.
        "--quark-overlay-subtle": "rgba(0,0,0,.04)",
        "--quark-overlay": "rgba(0,0,0,.09)",
        "--quark-overlay-strong": "rgba(0,0,0,.18)",
        "--quark-transition-fast": "120ms ease",
        "--quark-transition-normal": "180ms ease",
      },
      docs: "Heavier type, higher contrast, bigger touch targets, assertive fills. Attio/Arc-like.",
    },
  };

  function familyVarsToCssLines(vars) {
    return Object.entries(vars).map(([prop, val]) => `  ${prop}: ${val};`);
  }

  // Whole-app: overrides :root, so every component's normal (unscoped)
  // token reads pick it up.
  function setRoot(familyName) {
    const family = FAMILIES[familyName];
    if (!family) {
      console.warn(
        `Quark.families.setRoot: unknown family "${familyName}" — expected one of: ${Object.keys(FAMILIES).join(", ")}`
      );
      return false;
    }
    // Force the base token sheet to exist (and be appended to <head>)
    // BEFORE this family's own :root override tag, so this family
    // reliably wins the cascade even if called before any component has
    // ever mounted. Verified with a real jsdom test: without this call,
    // a family set before the first mount() was silently discarded once
    // the base sheet landed after it on that first mount.
    if (typeof Quark.__ensureTokensInjected === "function") {
      Quark.__ensureTokensInjected();
    }
    const css = [":root {", ...familyVarsToCssLines(family.vars), "}"].join("\n");
    Quark.css.apply(css, "quark-family-root");
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute("data-quark-family", familyName);
    }
    return true;
  }

  // Per-component: scopes the SAME token overrides under just #elementId,
  // via the exact scopeCss/applyCss primitives every component itself
  // uses — so a single button can use the "soft" family while the rest
  // of the app stays on "structured", with zero special-casing.
  //
  // Ordering note: if this runs AFTER Quark.components.mount() has
  // already mounted a component on elementId, that component's own
  // variant/modifier CSS (styleKey(elementId, "variant:...") etc.) was
  // injected into a <style> tag already in <head> — this call's tag is
  // appended after, and both are scoped to the same #elementId selector,
  // so this family override wins on any property it sets (later same-
  // specificity rule wins), while leaving every property it doesn't
  // mention exactly as the component set it. Calling this BEFORE mount()
  // also works as long as mount() hasn't fired yet for that id — the
  // family tag simply predates the component's own tags in that case,
  // and still wins because it's scoped at a lower specificity than
  // nothing (there's nothing to conflict with yet) and the component's
  // own rules never target these specific --quark-* custom properties
  // for that element directly, only read them.
  function applyToElement(elementId, familyName) {
    const family = FAMILIES[familyName];
    if (!family) {
      console.warn(
        `Quark.families.applyToElement: unknown family "${familyName}" — expected one of: ${Object.keys(FAMILIES).join(", ")}`
      );
      return false;
    }
    const css = Quark.css.scope(elementId, `& {\n${familyVarsToCssLines(family.vars).join("\n")}\n}`);
    Quark.css.apply(css, `quark:${elementId}:family`);
    return true;
  }

  function list() {
    return Object.keys(FAMILIES).map((name) => ({ name, docs: FAMILIES[name].docs }));
  }

  Quark.families = { setRoot, applyToElement, list, _definitions: FAMILIES };

  global.Quark = Quark;
  if (typeof module !== "undefined") module.exports = Quark;
})(typeof window !== "undefined" ? window : globalThis);

// NOTE: `@id button.primary = family:soft` now works directly — no
// manual JS block needed. quark-core.js's mount() detects the
// "family:<name>" prefix in the directive's `= value` and calls
// Quark.families.applyToElement itself (see the "value" handling
// there). Quark.families.setRoot/applyToElement remain directly
// callable too, for whole-app application or from outside a .cdrca
// directive.
