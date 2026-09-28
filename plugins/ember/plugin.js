// ember — a motion/effects system for CDRCA.
//
// Registers on the ("syntax", "customRule") hook, the same one Quark,
// `animations`, and cdrca-reactive-state all use — see this plugin's
// README for why that's the only integration surface a plugin actually
// has (verified directly against CDRCA's real Back-end/Transpiler
// source, not assumed): PROP_USE/ACTION_USE/PROP_DEF/ACTION_DEF are AST
// node types CDRCA's own core transpiler has dedicated, hard-coded
// support for — a third-party plugin can't introduce a new one of those
// without CDRCA's own core supporting it. JS_BLOCK is the one node type
// guaranteed to work for anyone, which is why Quark, `animations`
// (before it became a plugin), and reactive-state all ultimately funnel
// through it too. Real scale, for a plugin, comes from what it builds on
// top of that — its own registry/engine architecture — not from reaching
// deeper into the AST. See ember-core.js.
//
// Recognizes one statement form:
//
//   fx <elementId> <preset>.<modifier>.<modifier>... [with <params>]
//
// Rewrites into a JS_BLOCK calling Ember.play(...) — ember-core.js's own
// registry then looks up the named preset/easing and actually runs it.
// This file only turns DSL tokens into that call; it never touches
// fs/child_process, so it declares `permissions: []` in cdrca.json.
//
// This plugin does NOT itself recognize `@useLib ember.<n>` — unlike
// Quark's plugin.js, which parses it into a `Quark.__declareLib(...)`
// JS_BLOCK for a page-side loader (`quark-loader.js`) that, on
// inspection, doesn't actually exist in this ecosystem yet. `@useLib`
// resolution for ANY plugin — confirmed directly by reading
// plugin_frontend_patch.rs, and already proven working for `animations`
// — happens generically at the CLI's build-time file-staging level, not
// through a plugin's own customRule. `animations` itself ships zero
// `@useLib` handling in its own plugin.js and that's correct, not an
// oversight — this plugin follows that same, simpler, actually-necessary
// pattern rather than replicating a mechanism that appears unfinished
// even in its origin.
//
// Tokenizer workaround (same documented, verified bug Quark/
// cdrca-reactive-state work around, confirmed again directly against the
// real tokenizer while building this plugin): never trust `.type`,
// classify every token by the shape of `.value`.

module.exports = function (pluginAPI /*, hostAPI */) {
  pluginAPI.register(0, "syntax", "customRule", emberCustomRule);
};

function isIdentifierLike(t) {
  return !!t && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value);
}

function isKeyword(t, word) {
  return !!t && t.value === word;
}

function isNewlineToken(t) {
  return !!t && t.value === "\n";
}

// Concatenates every token's literal text with no added whitespace, up
// to (but not including) the terminating newline/end-of-input — the
// exact same strategy Quark's plugin.js uses for its own `= <value>`,
// for the exact same reason: no assumption about how many raw tokens a
// literal splits into (verified firsthand while building the previous
// plugin in this series that even a plain `0xRRGGBB` number splits into
// two tokens on the real tokenizer). `with { intensity: 8 }` reassembles
// with no added spaces (`{intensity:8}`) — still valid JS either way,
// since none of these values are ever inside a string literal here.
function readRawUntilNewline(tokens, pos) {
  const parts = [];
  let p = pos;
  while (p < tokens.length && !isNewlineToken(tokens[p])) {
    parts.push(tokens[p].value);
    p++;
  }
  return { raw: parts.join(""), newPosition: p };
}

function jsBlock(code, newPosition) {
  return { type: "JS_BLOCK", prams: { code }, newPosition };
}

function parseFx(tokens, pos) {
  let p = pos;

  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("ember: expected an element id after 'fx'");
  }
  const elementId = tokens[p].value;
  p++;

  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error(`ember: expected a preset name after 'fx ${elementId}'`);
  }
  const preset = tokens[p].value;
  p++;

  const modifiers = [];
  while (p < tokens.length && tokens[p].value === ".") {
    p++;
    if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
      throw new Error("ember: expected a modifier name after '.'");
    }
    modifiers.push(tokens[p].value);
    p++;
  }

  let paramsRaw = null;
  if (isKeyword(tokens[p], "with")) {
    p++;
    if (p >= tokens.length || isNewlineToken(tokens[p])) {
      throw new Error(`ember: expected parameters after 'fx ${elementId} ${preset}${modifiers.map((m) => "." + m).join("")} with'`);
    }
    const { raw, newPosition } = readRawUntilNewline(tokens, p);
    paramsRaw = raw;
    p = newPosition;
  }

  const args = [JSON.stringify(elementId), JSON.stringify(preset), JSON.stringify(modifiers)];
  args.push(paramsRaw !== null ? `(${paramsRaw})` : "undefined");
  const code = `Ember.play(${args.join(", ")});`;
  return jsBlock(code, p);
}

function emberCustomRule(currentValue, ctx) {
  // Another (higher-priority) plugin already produced a node for this
  // statement — don't override it.
  if (currentValue && currentValue.newPosition !== undefined) return undefined;

  const { tokens, pos, token } = ctx || {};
  if (!token || token.value !== "fx") return undefined;

  return parseFx(tokens, pos + 1);
}

module.exports.__internals = {
  emberCustomRule,
  parseFx,
  isIdentifierLike,
  isNewlineToken,
};
