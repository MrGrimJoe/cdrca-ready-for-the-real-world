// {{PLUGIN_NAME}}-{{LIBRARY_NAME}}.js — an opt-in browser-side bundle for
// {{PLUGIN_NAME}}, loaded only when a project's .cdrca source has
// `@useLib {{PLUGIN_NAME}}.{{LIBRARY_NAME}}` somewhere — see this
// plugin's cdrca.json `libraries` map and docs/PLUGIN-LIBRARIES.md.
//
// Follows the same pattern Quark's own library bundles use
// (templates/cdrca-runtime's quark-components.js): an IIFE, no top-level
// globals of your own, register INTO your plugin's own existing runtime
// namespace rather than defining a new one, and guard-check that
// namespace actually exists before touching it — fail loud, not silent,
// since a missing "core" script is a real setup mistake worth surfacing
// immediately rather than a mysterious later error.
(function (global) {
  "use strict";

  // TODO: replace `{{PLUGIN_NAME_GLOBAL}}` with whatever global namespace
  // your plugin's OWN generated JS_BLOCK code actually calls into (the
  // browser-side equivalent of this plugin's server-side plugin.js).
  // Unlike Quark, CDRCA's manifest schema has no "always load this core
  // script" concept for a generic plugin (see plugin_frontend_patch.rs's
  // module docs) — if you need one, the common pattern is to name a
  // library bundle "core" and document that users should
  // `@useLib {{PLUGIN_NAME}}.core` even when they don't need anything
  // else from you.
  const {{PLUGIN_NAME_GLOBAL}} = global.{{PLUGIN_NAME_GLOBAL}};
  if (!{{PLUGIN_NAME_GLOBAL}}) {
    console.error(
      "{{PLUGIN_NAME}}-{{LIBRARY_NAME}}.js: {{PLUGIN_NAME_GLOBAL}}'s core script must be loaded first."
    );
    return;
  }

  // TODO: register whatever this bundle actually provides — a component,
  // a preset, a helper — into {{PLUGIN_NAME_GLOBAL}}'s own registry.
})(typeof window !== "undefined" ? window : this);
