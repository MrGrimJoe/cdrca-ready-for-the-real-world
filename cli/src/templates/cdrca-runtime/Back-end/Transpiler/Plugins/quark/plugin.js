// Quark UI plugin for CDRCA
//
// Registers on the ("syntax", "customRule") hook — the only hook that can
// intercept a statement *before* CDRCA's own parser rejects it. Recognizes
// TWO directive shapes:
//
//   @<elementId> <preset>.<modifier>.<modifier>... = <value>
//   @useLib quark.<libraryName>
//
// The first rewrites into a JS_BLOCK calling Quark.UI.mount(...), reusing
// CDRCA's existing raw-JS code-gen path instead of teaching the transpiler
// a new node type. The second rewrites into a JS_BLOCK calling
// Quark.__declareLib(...), which the page-side loader
// (Front-end/Transpiler-Plugins/quark-loader.js) reads at runtime to decide
// which of Quark's own library bundles to <script>-inject — so a .cdrca
// file that only ever uses navbar/card doesn't need
// quark-templates.js loaded, and a future plugin with its own multi-file
// library set follows the exact same @useLib <pluginName>.<libraryName>
// shape without any change to this file or to CDRCA's core tokenizer/
// parser (see docs/PLUGIN-LIBRARIES.md for the full design).
//
// Permissions required: none. This plugin only reads tokens and returns a
// plain object — it never touches fs/child_process, so it should be
// registered with permissions: [] in plugins.json.
//
// Coexistence with other "@" plugins (e.g. cdrca-reactive-state, which
// registers at a higher priority for "bind"/event directives): the first
// line of quarkCustomRule bails out if a higher-priority plugin already
// produced a real node for this statement, so the two never fight over the
// same "@" statement. Quark's own pattern is a wildcard
// ("@id anyIdentifier(.anyIdentifier)* (= token)?") that would otherwise
// also match e.g. "@count bind.text = count" and misread "bind" as an
// unknown preset name.
//
// Tokenizer workaround: CDRCA's real Tokenizer.js has a verified bug —
// a single-character identifier or single-digit number immediately
// followed by another token has its `.type` silently overwritten with the
// *following* token's type (e.g. "@x navbar" tokenizes "x" as type
// "token", not "identifier"). This breaks every single-character element
// id/modifier/value. `.value` is never corrupted, only `.type` is — so
// this file classifies tokens by the shape of `.value` (isIdentifierLike /
// isNewlineToken) instead of trusting `.type`, everywhere it matters.

module.exports = function (pluginAPI /*, hostAPI */) {
  pluginAPI.register(0, "syntax", "customRule", quarkCustomRule);
};

function isIdentifierLike(t) {
  return !!t && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value);
}

function isNewlineToken(t) {
  return !!t && t.value === "\n";
}

// Every library bundle Quark itself ships, beyond the always-loaded
// quark-core.js + quark-ui.js (those two are the plugin's engine and
// compatibility shim, not optional bundles — see PLUGIN-LIBRARIES.md for
// why they're excluded from this list on purpose). Kept here, not just in
// plugins.json, so quarkCustomRule can validate `@useLib quark.<name>`
// against real bundle names at parse time rather than silently accepting
// a typo.
const QUARK_LIBRARIES = {
  components: "quark-components.js",
  templates: "quark-templates.js",
  families: "quark-families.js",
};

function quarkCustomRule(currentValue, ctx) {
  // Another (higher-priority) plugin already produced a node for this
  // statement — don't override it. See the "Coexistence" note above.
  if (currentValue && currentValue.newPosition !== undefined) return undefined;

  const { tokens, pos, token } = ctx || {};

  // Not an "@..." statement -> not ours. Return undefined so CDRCA's
  // normal switch-case parsing (or another plugin) handles it.
  if (!token || token.value !== "@") return undefined;

  let p = pos + 1;
  if (p >= tokens.length || !isIdentifierLike(tokens[p])) return undefined;

  // @useLib <pluginName>.<libraryName>  — checked first since "useLib" is
  // a fixed keyword, distinct from the arbitrary element-id in the other
  // directive shape below.
  if (tokens[p].value === "useLib") {
    return parseUseLib(tokens, p + 1);
  }

  return parseElementDirective(tokens, p);
}

function parseUseLib(tokens, p) {
  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("Quark: expected a plugin name after '@useLib'");
  }
  const pluginName = tokens[p].value;
  p++;

  if (p >= tokens.length || tokens[p].value !== ".") {
    throw new Error("Quark: expected '.<libraryName>' after '@useLib " + pluginName + "'");
  }
  p++;
  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("Quark: expected a library name after '@useLib " + pluginName + ".'");
  }
  const libraryName = tokens[p].value;
  p++;

  // Only validate bundle names for THIS plugin (quark) — a different
  // plugin's own plugin.js validates its own @useLib <itsName>.<lib>
  // the same way; if pluginName doesn't match, this plugin has nothing
  // useful to say about it, so decline rather than guess.
  if (pluginName === "quark" && !QUARK_LIBRARIES[libraryName]) {
    throw new Error(
      `Quark: unknown library "quark.${libraryName}" — expected one of: ` +
        Object.keys(QUARK_LIBRARIES).map((n) => `quark.${n}`).join(", ")
    );
  }

  const code = `Quark.__declareLib(${JSON.stringify(pluginName)}, ${JSON.stringify(libraryName)});`;
  return { type: "JS_BLOCK", prams: { code }, newPosition: p };
}

function parseElementDirective(tokens, p) {
  // @<elementId>
  const elementId = tokens[p].value;
  p++;

  // <preset>
  if (p >= tokens.length || !isIdentifierLike(tokens[p])) return undefined;
  const preset = tokens[p].value;
  p++;

  // .<modifier> .<modifier> ...
  const modifiers = [];
  while (p < tokens.length && tokens[p].value === ".") {
    p++;
    if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
      throw new Error("Quark: expected a modifier name after '.'");
    }
    modifiers.push(tokens[p].value);
    p++;
  }

  // optional = <value>
  // The real tokenizer splits a hex color like #2563eb into THREE
  // separate tokens: "#", a number token "2563", and an identifier
  // token "eb" (hex digits after the first non-digit aren't part of
  // CDRCA's number token). So the value isn't necessarily one token —
  // concatenate every token's literal text up to (but not including)
  // the terminating newline/end-of-input, with no added whitespace.
  let value = null;
  if (p < tokens.length && tokens[p].value === "=") {
    p++;
    if (p >= tokens.length || isNewlineToken(tokens[p])) {
      throw new Error("Quark: expected a value after '='");
    }
    const valueParts = [];
    while (p < tokens.length && !isNewlineToken(tokens[p])) {
      valueParts.push(tokens[p].value);
      p++;
    }
    value = valueParts.join("");
  }

  const args = [JSON.stringify(elementId), JSON.stringify(preset), JSON.stringify(modifiers)];
  if (value !== null) args.push(JSON.stringify(value));
  const code = `Quark.UI.mount(${args.join(", ")});`;

  return { type: "JS_BLOCK", prams: { code }, newPosition: p };
}
