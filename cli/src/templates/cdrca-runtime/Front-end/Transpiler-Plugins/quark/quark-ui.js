// Quark.UI — thin compatibility shim.
//
// plugin.js's generated JS_BLOCK always calls:
//   Quark.UI.mount(elementId, presetName, modifiers, value)
// (see templates/plugins/quark/plugin.js). This file's only job is to keep
// that exact call shape working forever, by forwarding straight into the
// real registry-based engine in quark-core.js. The directive grammar and
// this call signature are the backward-compatibility contract — neither
// changes as components/variants are added.
//
// Load order: quark-core.js, then quark-components.js (registers the
// component library into Quark.components), then this file.

(function (global) {
  "use strict";

  const Quark = global.Quark || (typeof module !== "undefined" ? module.exports : {});

  if (!Quark.components) {
    // quark-core.js wasn't loaded first — fail loudly rather than silently
    // no-op, matching the rest of this codebase's "loud on failure" style.
    console.error(
      "Quark.UI: quark-core.js must be loaded before quark-ui.js. " +
        "@id directives will not work."
    );
  }

  Quark.UI = {
    mount(elementId, presetName, modifiers, value) {
      if (!Quark.components) return null;
      return Quark.components.mount(elementId, presetName, modifiers || [], value || null);
    },
    unmount(elementId) {
      if (!Quark.components) return false;
      return Quark.components.unmount(elementId);
    },
  };

  global.Quark = Quark;
  if (typeof module !== "undefined") module.exports = Quark;
})(typeof window !== "undefined" ? window : globalThis);
