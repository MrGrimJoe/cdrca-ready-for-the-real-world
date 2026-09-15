// plugin.js — CDRCA transpiler plugin entry point.
//
// This shape is REQUIRED, not a style choice: `Back-end/Transpiler/plugin.js`
// (CDRCA's real plugin host) calls your module.exports function as
// `exported(pluginAPI, hostAPI)`, where `pluginAPI` is an object with a
// `.register(priority, hookType, hookProcess, callback)` method — NOT the
// register function itself. Calling `pluginAPI(...)` directly, or assuming
// the first argument IS the register function, throws
// "pluginAPI is not a function" and your plugin never loads. This exact
// mismatch was a real, verified bug once (see
// docs/REACTIVE-STATE.md's bug #3 note) — Quark's own template and this
// scaffold are both written the correct way on purpose.
module.exports = function (pluginAPI /*, hostAPI */) {
  // `priority` (0 here) decides registration order when more than one
  // plugin hooks the SAME (hookType, hookProcess) pair — lower runs
  // first. Quark registers its own "@" directive parser at priority 0;
  // pick a different number only if you need to run before/after another
  // specific plugin you know is installed alongside yours.
  pluginAPI.register(0, "syntax", "customRule", myCustomRule);

  // Every (hookType, hookProcess) pair CDRCA's real transpiler actually
  // calls pluginAPI.run(...) for, verified directly against the source
  // (Parser.js / Partial_transpiler.js / index.js) — register.rs's
  // `uses` field in cdrca.json must list whichever of these you use, or
  // your plugin gets permanently seized the first time it tries:
  //   syntax.beforeTokenize   syntax.afterTokenize
  //   syntax.afterParseNode   syntax.customRule      (the one above)
  //   ast.visitStatement      ast.visitHeader         ast.visitSubHeader
  //   exec.beforeSwitch       exec.beforeIf           exec.beforeLoop
  //   exec.afterLoop
  //   before.parse            after.parse
  //   before.partialTranspile after.partialTranspile
  //   before.multiFile        after.multiFile
  //   before.semanticAnalyze  after.semanticAnalyze
  //   before.fullTranspile    after.fullTranspile
  //   before.postOptionalParse after.postOptionalParse
  // See docs/PLUGIN-PERMISSIONS.md for what `uses` actually enforces.
};

// `customRule` is CDRCA's escape hatch for adding new statement syntax —
// this is the same hook Quark uses for its own "@id preset.modifier"
// directives (see templates/plugins/quark/plugin.js for a real, more
// complete example of this exact hook).
//
// Called once per statement CDRCA's parser doesn't already recognize.
// Return `undefined` if this statement isn't yours — CDRCA moves on to
// try another registered plugin, or falls through to its own built-in
// parsing. Return an AST node object (with at least `newPosition`) if it
// IS yours.
function myCustomRule(currentValue, ctx) {
  // If a higher-priority plugin already produced a real node for this
  // statement, don't override it — same coexistence pattern
  // quark-patched plugins use (see plugin_frontend_patch.rs's module
  // docs, and templates/plugins/quark/plugin.js's own "Coexistence" note).
  if (currentValue && currentValue.newPosition !== undefined) return undefined;

  const { tokens, pos, token } = ctx || {};

  // TODO: replace this with your own statement-recognition logic. This
  // stub never matches anything — it's here so `cdrca build app` doesn't
  // immediately error on an empty function, not as real starter behavior.
  if (!token) return undefined;

  return undefined;
}
