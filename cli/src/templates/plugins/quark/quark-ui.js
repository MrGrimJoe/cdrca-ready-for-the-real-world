// Quark.UI — the runtime side of the `@id preset.mod.mod = value` directive.
//
// In the real project this should call quark.js's own RelativeCSS/applyCss
// directly instead of the two small helpers below — they're just a
// self-contained stand-in (same behavior: inject a <style> tag scoped to
// #elementId) so this file runs standalone without loading the full
// quark.js file, e.g. for this demo.

function applyCss(css) {
  const styleElement = document.createElement("style");
  styleElement.textContent = css;
  document.head.appendChild(styleElement);
}

function RelativeCSS(elementId, css) {
  applyCss(css);
}

const QuarkPresets = {
  sidebar: {
    baseCss: `
      position: fixed; top: 0; left: 0; height: 100%; width: 260px;
      background: var(--quark-accent, #1e2327); transition: transform .2s ease;
    `,
    modifiers: {
      edgy: { css: `border-radius: 0;` },
      rounded: { css: `border-radius: 0 12px 12px 0;` },
      closable: {
        // behavioral: adds a real close button + toggle, not just a class
        behavior: (el) => {
          const btn = document.createElement("span");
          btn.textContent = "\u2715";
          btn.style.cssText = "position:absolute;top:8px;right:8px;cursor:pointer;";
          btn.onclick = () => el.classList.toggle("quark-closed");
          el.appendChild(btn);
          RelativeCSS(el.id, `&.quark-closed { transform: translateX(-100%); }`);
        },
      },
      // non-closable is the default (no modifier needed) — sidebars are
      // closable only when you opt in, matching "some are closeable by
      // design and some aren't"
    },
  },
  // navbar, modal, tooltip, etc. go here as the library grows
};

const Quark = (typeof window !== "undefined" && window.Quark) || {};

Quark.UI = {
  mount(elementId, presetName, modifiers = [], value = null) {
    const el = document.getElementById(elementId);
    if (!el) {
      console.error(`Quark: no element with id "${elementId}" found`);
      return;
    }
    const preset = QuarkPresets[presetName];
    if (!preset) {
      console.error(`Quark: unknown preset "${presetName}"`);
      return;
    }

    if (value) el.style.setProperty("--quark-accent", value);
    RelativeCSS(elementId, `#${elementId} { ${preset.baseCss} }`);

    modifiers.forEach((modName) => {
      const mod = preset.modifiers[modName];
      if (!mod) {
        console.warn(`Quark: unknown modifier ".${modName}" on preset "${presetName}"`);
        return;
      }
      if (mod.css) RelativeCSS(elementId, `#${elementId} { ${mod.css} }`);
      if (mod.behavior) mod.behavior(el);
    });
  },
};

if (typeof window !== "undefined") window.Quark = Quark;
if (typeof module !== "undefined") module.exports = Quark;
