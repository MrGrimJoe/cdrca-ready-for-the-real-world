// Quark core — component registry, design tokens, and resolution engine.
//
// This file knows nothing about any specific component (navbar, card, ...).
// It only knows how to:
//   1. hold a registry of component definitions
//   2. resolve  target -> component -> variant/modifiers -> configuration
//   3. mount/unmount a component instance on a real DOM element
//   4. hand components a small set of shared design tokens + CSS helpers
//
// New components are added by calling Quark.components.register(...) from
// quark-components.js (or a third-party file loaded after this one) — this
// file never needs to change when a component is added.
//
// Directive-compatibility note: the `@id preset.mod.mod = value` grammar
// (see plugin.js) has no separate "variant" token — everything after the
// first `.` is a flat modifier chain. This file treats a component's FIRST
// modifier as its *variant* when (and only when) that component declares a
// non-empty `variants` map; every modifier after that is a real modifier.
// Components with no declared variants (matching the original `sidebar`)
// behave exactly as before: every `.thing` is a modifier, nothing is
// special-cased. This is what makes `navbar.modern` and
// `sidebar.closable.edgy` both valid without any parser or grammar change.

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Design tokens — shared primitives components build on. Deliberately
  // small: spacing/radius/type/shadow/transition/surface scales only.
  // Namespaced as CSS custom properties under --quark-* so a project's own
  // CSS is never overwritten or fought with.
  // ---------------------------------------------------------------------

  const QuarkTokens = {
    space: { xs: "4px", sm: "8px", md: "12px", lg: "20px", xl: "32px" },
    radius: { sharp: "0px", sm: "4px", md: "8px", lg: "14px", pill: "999px" },
    font: {
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      sizeSm: "13px",
      sizeMd: "15px",
      sizeLg: "18px",
      weightNormal: "400",
      weightMedium: "500",
      weightBold: "600",
    },
    shadow: {
      none: "none",
      sm: "0 1px 2px rgba(0,0,0,.08)",
      md: "0 4px 16px rgba(0,0,0,.12)",
      lg: "0 12px 32px rgba(0,0,0,.18)",
    },
    transition: {
      fast: "120ms ease",
      normal: "200ms ease",
      slow: "320ms ease",
    },
    surface: {
      light: "#ffffff",
      dark: "#1b1e22",
      glass: "rgba(255,255,255,.6)",
      glassDark: "rgba(20,22,26,.55)",
    },
    border: {
      hairline: "1px solid rgba(0,0,0,.1)",
      hairlineDark: "1px solid rgba(255,255,255,.12)",
    },
    // Neutral overlay tints — a translucent wash used for subtle fills
    // (secondary buttons, soft card/input backgrounds, tab-strip
    // backgrounds, toggle tracks, spinner rings, skeleton shimmer...).
    // Distinct from `surface` (an opaque background color) and from a
    // literal black scrim (e.g. a modal backdrop, which should stay
    // dark regardless of theme — that's intentionally NOT one of these).
    //
    // Found via a real contrast check: every existing rgba(0,0,0,...)
    // neutral tint in quark-components.js assumed a light surface and
    // became nearly invisible once mixed with a dark family/surface
    // (e.g. rgba(0,0,0,.06) on #111113 composites to within 1-2 RGB
    // units of the surface itself, i.e. an all-but-invisible button).
    //
    // Components reference these via var(--quark-overlay, <fallback>)
    // with a light-appropriate literal as their fallback, so an app
    // with no family applied keeps the exact original light-surface
    // look. A dark-first family (see quark-families.js's "structured")
    // overrides these same three generated property names
    // (--quark-overlay, --quark-overlay-subtle, --quark-overlay-strong)
    // to their white-based equivalents — the same existing per-family
    // token-override path used for --quark-surface-*, just extended to
    // a token group components didn't previously need to override.
    // "base" is the key name for the bare (no-suffix) property — see
    // the OVERLAY_BASE_KEY special case in injectTokens() below, since
    // the generic --quark-${group}-${key} naming used for every other
    // group would otherwise produce --quark-overlay-base instead of
    // the bare --quark-overlay every component actually references.
    overlay: {
      subtle: "rgba(0,0,0,.03)",
      base: "rgba(0,0,0,.07)",
      strong: "rgba(0,0,0,.15)",
    },
  };

  // Root-level custom properties so component CSS can reference
  // var(--quark-space-md) etc. without every component re-declaring them.
  let tokensInjected = false;
  function injectTokens() {
    if (tokensInjected || typeof document === "undefined") return;
    tokensInjected = true;
    const lines = [":root {"];
    for (const [group, values] of Object.entries(QuarkTokens)) {
      for (const [key, value] of Object.entries(values)) {
        // Every group generates --quark-<group>-<key>, e.g.
        // --quark-radius-sm, except overlay's "base" key, which
        // generates the bare --quark-overlay (no suffix) — the name
        // every overlay-tint call site in quark-components.js actually
        // references. See the "overlay" token group's own comment
        // above for why this one group needs a bare name.
        const propName =
          group === "overlay" && key === "base" ? `--quark-overlay` : `--quark-${group}-${key}`;
        lines.push(`  ${propName}: ${value};`);
      }
    }
    lines.push("}");
    applyCss(lines.join("\n"), "quark-tokens");
  }

  // ---------------------------------------------------------------------
  // CSS injection helpers. One <style> tag per (elementId, styleKey) so
  // repeated mounts / variant switches replace rather than pile up rules.
  // Selectors are always scoped under #<elementId> or a
  // [data-quark-id="..."] fallback so Quark never leaks global styles.
  // ---------------------------------------------------------------------

  const injectedStyleTags = new Map(); // key -> <style> element

  function applyCss(css, key) {
    if (typeof document === "undefined") return;
    let tag = injectedStyleTags.get(key);
    if (!tag) {
      tag = document.createElement("style");
      tag.setAttribute("data-quark-style", key);
      document.head.appendChild(tag);
      injectedStyleTags.set(key, tag);
    }
    tag.textContent = css;
  }

  function removeCss(key) {
    const tag = injectedStyleTags.get(key);
    if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
    injectedStyleTags.delete(key);
  }

  // Scopes a block of CSS (which may use `&` for the root element, same
  // convention the original sidebar preset used) under #elementId.
  function scopeCss(elementId, css) {
    if (css.indexOf("&") !== -1) {
      return css.replace(/&/g, `#${elementId}`);
    }
    return `#${elementId} { ${css} }`;
  }

  function styleKey(elementId, suffix) {
    return suffix ? `quark:${elementId}:${suffix}` : `quark:${elementId}`;
  }

  // ---------------------------------------------------------------------
  // Component registry
  // ---------------------------------------------------------------------

  const registry = new Map(); // name -> component definition
  const instances = new Map(); // elementId -> mounted instance record

  /**
   * Register a component definition.
   *
   * definition = {
   *   name: "navbar",
   *   defaultVariant: "modern",       // used when no variant token given
   *   variants: { modern: {...}, glass: {...}, ... },  // optional
   *   modifiers: { sticky: {...}, compact: {...}, ... }, // optional
   *   base(ctx) -> string|void        // base CSS / DOM setup, runs always
   *   applyVariant(ctx, variantDef, variantName) -> string|void  // optional
   *   applyModifier(ctx, modifierDef, modifierName) -> string|void // optional
   *   mount(ctx) -> void              // optional extra mount-time logic
   *   unmount(ctx) -> void            // optional cleanup
   *   parts: ["brand","navigation","actions"]  // optional sub-part convention
   *   docs: { description, expectedHtml, example }  // optional metadata
   * }
   *
   * ctx passed to every hook: { el, elementId, tokens, css, value, variant,
   * modifiers, root } — root() finds a named sub-part (see findPart below).
   */
  function register(definition) {
    if (!definition || typeof definition.name !== "string" || !definition.name) {
      throw new Error("Quark.components.register: definition.name is required");
    }
    registry.set(definition.name, definition);
  }

  function get(name) {
    return registry.get(name);
  }

  function list() {
    return Array.from(registry.keys());
  }

  // ---------------------------------------------------------------------
  // Sub-part convention: components with children look for
  // [data-quark-part="brand"] first, then fall back to a matching class
  // name (.brand), then to nothing (component treats it as absent/optional).
  // Deliberately simple — no fragile "the 3rd child" assumptions per the
  // architecture brief.
  // ---------------------------------------------------------------------

  function findPart(el, partName) {
    if (!el) return null;
    return (
      el.querySelector(`[data-quark-part="${partName}"]`) ||
      el.querySelector(`.${partName}`) ||
      null
    );
  }

  // ---------------------------------------------------------------------
  // mount() — the single entry point plugin.js's generated JS_BLOCK calls
  // (via the quark-ui.js compatibility shim). Resolves
  // target -> component -> variant/modifiers -> configuration, then
  // delegates to the component's own base/variant/modifier hooks.
  // ---------------------------------------------------------------------

  function mount(elementId, componentName, modifierTokens, value) {
    injectTokens();

    if (typeof document === "undefined") {
      console.error("Quark: no document available to mount into");
      return null;
    }
    const el = document.getElementById(elementId);
    if (!el) {
      console.error(`Quark: no element with id "${elementId}" found`);
      return null;
    }
    const def = registry.get(componentName);
    if (!def) {
      console.error(`Quark: unknown component "${componentName}"`);
      return null;
    }

    // Unmount any previous instance on this element first so re-mounting
    // (e.g. switching a variant by re-running generated code) is safe and
    // never duplicates behavior/listeners.
    if (instances.has(elementId)) {
      unmount(elementId);
    }

    modifierTokens = Array.isArray(modifierTokens) ? modifierTokens.slice() : [];

    // First token is the variant IFF this component declares variants at
    // all. Components with no variants (e.g. the original sidebar) keep
    // every token as a plain modifier — exact prior behavior preserved.
    let variantName = null;
    if (def.variants && Object.keys(def.variants).length > 0) {
      if (modifierTokens.length > 0 && def.variants[modifierTokens[0]]) {
        variantName = modifierTokens.shift();
      } else {
        variantName = def.defaultVariant || Object.keys(def.variants)[0];
      }
    }

    const cleanupFns = [];
    const ctx = {
      el,
      elementId,
      tokens: QuarkTokens,
      css: (cssText, suffix) => applyCss(scopeCss(elementId, cssText), styleKey(elementId, suffix)),
      value: value || null,
      variant: variantName,
      modifiers: modifierTokens,
      part: (name) => findPart(el, name),
      // Components/modifiers that mutate the DOM or attach listeners
      // register their own teardown here so unmount()/re-mount() never
      // leaves stray nodes or duplicate listeners behind.
      addCleanup: (fn) => {
        if (typeof fn === "function") cleanupFns.push(fn);
      },
    };

    // `value` (the optional `= ...` part of an @id directive) has always
    // meant "accent color" — a raw color string set directly as
    // --quark-accent. Extended here, backward-compatibly, to also accept
    // "family:<name>" (e.g. "family:soft"), which instead applies that
    // whole design family's token set scoped to this element via
    // Quark.families — see quark-families.js. Every existing .cdrca file
    // that passes a plain color (hex, named color, rgb(...), ...) keeps
    // working exactly as before, since those never start with "family:".
    if (value) {
      const familyMatch = /^family:(.+)$/.exec(value);
      if (familyMatch && Quark.families) {
        Quark.families.applyToElement(elementId, familyMatch[1].trim());
      } else if (familyMatch) {
        console.warn(
          `Quark: "${elementId}" requested "${value}" but quark-families.js isn't loaded (add @useLib quark.families).`
        );
      } else {
        el.style.setProperty("--quark-accent", value);
      }
    }
    el.setAttribute("data-quark-component", componentName);
    if (variantName) el.setAttribute("data-quark-variant", variantName);

    try {
      if (typeof def.base === "function") def.base(ctx);

      if (variantName) {
        const variantDef = def.variants[variantName];
        if (!variantDef) {
          console.warn(`Quark: unknown variant "${variantName}" on component "${componentName}"`);
        } else if (typeof def.applyVariant === "function") {
          def.applyVariant(ctx, variantDef, variantName);
        } else if (typeof variantDef === "function") {
          variantDef(ctx);
        } else if (variantDef && typeof variantDef.css === "string") {
          ctx.css(variantDef.css, `variant:${variantName}`);
        }
      }

      modifierTokens.forEach((modName) => {
        const modDef = def.modifiers && def.modifiers[modName];
        if (!modDef) {
          console.warn(`Quark: unknown modifier ".${modName}" on component "${componentName}"`);
          return;
        }
        if (typeof def.applyModifier === "function") {
          def.applyModifier(ctx, modDef, modName);
        } else {
          if (typeof modDef.css === "string") ctx.css(modDef.css, `modifier:${modName}`);
          if (typeof modDef.behavior === "function") modDef.behavior(ctx);
        }
      });

      if (typeof def.mount === "function") def.mount(ctx);
    } catch (err) {
      console.error(`Quark: error mounting component "${componentName}" on #${elementId}:`, err);
    }

    const instance = { componentName, variantName, modifiers: modifierTokens, ctx, cleanupFns };
    instances.set(elementId, instance);
    return instance;
  }

  function unmount(elementId) {
    const instance = instances.get(elementId);
    if (!instance) return false;
    const def = registry.get(instance.componentName);
    try {
      if (def && typeof def.unmount === "function") def.unmount(instance.ctx);
    } catch (err) {
      console.error(`Quark: error unmounting "${instance.componentName}" on #${elementId}:`, err);
    }
    (instance.cleanupFns || []).forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error(`Quark: error running cleanup for "${instance.componentName}" on #${elementId}:`, err);
      }
    });
    removeCss(styleKey(elementId));
    removeCss(styleKey(elementId, `variant:${instance.variantName}`));
    instance.modifiers.forEach((m) => removeCss(styleKey(elementId, `modifier:${m}`)));
    instances.delete(elementId);
    return true;
  }

  function getInstance(elementId) {
    return instances.get(elementId) || null;
  }

  // ---------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------

  const Quark = global.Quark || {};
  Quark.tokens = QuarkTokens;
  Quark.css = { apply: applyCss, remove: removeCss, scope: scopeCss };
  Quark.components = { register, get, list, mount, unmount, getInstance, findPart };
  // Exposed so a library that needs to inject its OWN :root-scoped CSS
  // before any component has mounted (e.g. quark-families.js's
  // setRoot()) can force this base token sheet to exist and be appended
  // to <head> first — otherwise, since injectTokens() normally only
  // runs lazily on the first mount() call, a caller who sets something
  // at :root before ever mounting a component would have their own
  // <style> tag land first, and this base sheet would then silently
  // land after it (and win) on that eventual first mount. Verified with
  // a real jsdom check: without this call first, a family override made
  // before the first mount() got silently discarded.
  Quark.__ensureTokensInjected = injectTokens;

  // ---------------------------------------------------------------------
  // @useLib bookkeeping. Declaring a library does NOT load it at
  // runtime — see docs/PLUGIN-LIBRARIES.md for why: a .cdrca file's
  // generated code (including @useLib's own Quark.__declareLib(...) call)
  // all runs inside a single synchronous eval(), so there's no point
  // mid-script to pause and inject a <script> tag. The CLI instead
  // statically scans .cdrca source for @useLib directives at
  // create/install time and stages only the referenced library
  // <script> tags into the page ahead of time (see
  // cli/src/quark_libscan.rs). __declareLib exists purely so a mount()
  // call can warn — at the point something actually goes wrong,
  // rather than silently no-op'ing — if a component's library was
  // apparently never declared, which usually means either the
  // .cdrca file is missing its @useLib line or the CLI's static scan
  // didn't see it (e.g. it came from a dynamically-built fileSystem
  // rather than a file on disk).
  // ---------------------------------------------------------------------
  const declaredLibs = new Set(); // "pluginName.libraryName"
  Quark.__declareLib = function (pluginName, libraryName) {
    declaredLibs.add(`${pluginName}.${libraryName}`);
  };
  Quark.__isLibDeclared = function (pluginName, libraryName) {
    return declaredLibs.has(`${pluginName}.${libraryName}`);
  };

  global.Quark = Quark;
  if (typeof module !== "undefined") module.exports = Quark;
})(typeof window !== "undefined" ? window : globalThis);
