// Animations plugin — the original CDRCA scene/prop/action grammar
// (`def PROP`, `def ACTION`, `use ... as`, `add new action`, `gredientMap =`,
// `BGcolor =`), lifted verbatim out of Parser.js's hardcoded switch and
// registered as a real plugin on the same ("syntax","customRule") hook
// Quark uses. Grammar/AST shape is unchanged — every parse* function below
// is a direct copy of the corresponding function in THIS repo's Parser.js,
// including its joinTokenValues() word-boundary-aware join fix (see
// Parser.js's own comment above that function) — not a reimplementation and
// not copied from an older/different copy of Parser.js.
//
// Parser.js's customRule hook runs BEFORE its hardcoded switch on every
// statement. This plugin claims the five animation keywords there; the
// switch cases for them now only fire as a fallback if this plugin is
// absent/disabled (e.g. plugins.json edited out), so removing this plugin
// degrades gracefully instead of breaking anything else. See
// docs/ARCHITECTURE.md for why the switch already worked this way without
// needing any change itself.

module.exports = function (sandboxedPlugin /*, hostAPI */) {
  sandboxedPlugin.register(0, "syntax", "customRule", animationsCustomRule);
};

function animationsCustomRule(currentValue, ctx) {
  // Another (higher-priority) plugin already produced a node for this
  // statement — don't override it (same coexistence convention Quark's
  // plugin.js uses).
  if (currentValue && currentValue.newPosition !== undefined) return undefined;

  const { tokens, pos, token } = ctx || {};
  if (!token) return undefined;

  switch (token.value) {
    case "def":
      return parseDefStatement(tokens, pos);
    case "use":
      return parsePropUse(tokens, pos);
    case "add":
      return parseActionUse(tokens, pos);
    case "gredientMap":
      return parseDefault(tokens, pos, "GREDIENT_MAP");
    case "BGcolor":
      return parseDefault(tokens, pos, "BGCOLOR");
    default:
      // Not ours — return undefined so the next plugin / core fallback
      // switch handles it, per plugin.js's run() semantics
      // (`if (result !== undefined) currentValue = result`).
      return undefined;
  }
}

// Verbatim copy of Parser.js's own joinTokenValues, including its fix for
// hex literals (0xff0000 tokenizes as "0" then "xff0000" and would
// otherwise get a wrongly-inserted space) — see that file's comments for
// the full rationale on both fixes.
function joinTokenValues(tokens) {
  const isWordChar = (c) => !!c && /[A-Za-z0-9_$]/.test(c);
  const endsInBareDigits = (s) => /(?:^|[^0-9A-Za-z_$])[0-9]+$/.test(s);
  const isHexContinuation = (s) => /^[xX][0-9a-fA-F]*$/.test(s);
  return tokens.reduce((acc, t) => {
    const value = String(t.value);
    const prevChar = acc[acc.length - 1];
    if (
      acc.length > 0 &&
      isWordChar(prevChar) &&
      isWordChar(value[0]) &&
      !(endsInBareDigits(acc) && isHexContinuation(value))
    ) {
      return acc + " " + value;
    }
    return acc + value;
  }, "");
}

// --- everything below is a verbatim copy of this repo's Parser.js logic ---

function parseDefStatement(tokens, pos) {
  pos++;
  if (pos >= tokens.length)
    throw new Error("Expected PROP or ACTION after 'def'");
  const type = tokens[pos].value;
  if (type === "PROP") return parsePropDef(tokens, pos);
  if (type === "ACTION") return parseActionDef(tokens, pos);
  throw new Error(`Unexpected definition type: ${type}`);
}

function parsePropDef(tokens, pos) {
  pos++; // Skip "PROP"
  if (pos >= tokens.length || tokens[pos].type !== "identifier")
    throw new Error("Expected prop name after 'PROP'");
  const name = tokens[pos].value;
  pos++;
  let abstracts = false;
  let optionOtherPROP = null;
  if (pos < tokens.length && tokens[pos].value === "abstracts") {
    abstracts = true;
    pos++;
    if (pos >= tokens.length || tokens[pos].type !== "identifier")
      throw new Error("Expected other PROP name after 'abstracts'");
    optionOtherPROP = tokens[pos].value;
    pos++;
    while (pos < tokens.length && tokens[pos].value === ".") {
      pos++;
      if (pos >= tokens.length || tokens[pos].type !== "identifier")
        throw new Error("Expected identifier after '.' in abstracts clause");
      optionOtherPROP += "." + tokens[pos].value;
      pos++;
    }
  }
  if (pos >= tokens.length || tokens[pos].value !== "{")
    throw new Error("Expected '{' in prop definition");
  pos++;
  let depth = 1;
  const codeTokens = [];
  while (pos < tokens.length && depth > 0) {
    const token = tokens[pos];
    if (token.value === "{") depth++;
    else if (token.value === "}") depth--;
    if (depth > 0) codeTokens.push(token);
    pos++;
  }
  if (depth !== 0) throw new Error("Unclosed prop definition");
  const code = joinTokenValues(codeTokens);
  return {
    type: "PROP_DEF",
    prams: { name, abstracts, optionOtherPROP, code },
    newPosition: pos,
  };
}

function parseActionDef(tokens, pos) {
  pos++; // Skip "ACTION"
  if (pos >= tokens.length || tokens[pos].type !== "identifier")
    throw new Error("Expected action name after 'ACTION'");
  const name = tokens[pos].value;
  pos++;
  const parts = [];
  while (pos < tokens.length && tokens[pos].type !== "newline") {
    if (tokens[pos].type !== "identifier")
      throw new Error("Expected prop name in action definition");
    let propName = tokens[pos].value;
    pos++;
    while (pos < tokens.length && tokens[pos].value === ".") {
      pos++;
      if (pos >= tokens.length || tokens[pos].type !== "identifier")
        throw new Error("Expected identifier after '.' in action definition");
      propName += "." + tokens[pos].value;
      pos++;
    }
    if (pos >= tokens.length || tokens[pos].type !== "identifier")
      throw new Error("Expected method name in action definition");
    const methodName = tokens[pos].value;
    pos++;
    if (pos >= tokens.length)
      throw new Error("Expected parameters in action definition");
    const prams = tokens[pos].value;
    pos++;
    parts.push({ propName, methodName, prams });
  }
  return { type: "ACTION_DEF", prams: { name, parts }, newPosition: pos };
}

function parsePropUse(tokens, pos) {
  pos++;
  if (pos >= tokens.length || tokens[pos].type !== "identifier")
    throw new Error("Expected prop name after 'use'");
  let name = tokens[pos].value;
  pos++;
  while (pos < tokens.length && tokens[pos].value === ".") {
    pos++;
    if (pos >= tokens.length || tokens[pos].type !== "identifier")
      throw new Error("Expected identifier after '.' in prop use");
    name += "." + tokens[pos].value;
    pos++;
  }
  if (pos >= tokens.length || tokens[pos].value !== "(")
    throw new Error("Expected '(' in prop use");
  pos++;
  let depth = 1;
  const pramsTokens = [];
  while (pos < tokens.length && depth > 0) {
    const token = tokens[pos];
    if (token.value === "(") depth++;
    else if (token.value === ")") depth--;
    if (depth > 0) pramsTokens.push(token);
    pos++;
  }
  if (depth !== 0) throw new Error("Unclosed parameters in prop use");
  const prams = joinTokenValues(pramsTokens);

  let alias = null;
  if (pos < tokens.length && tokens[pos].value === "as") {
    pos++;
    if (pos >= tokens.length || tokens[pos].type !== "identifier")
      throw new Error("Expected alias name after 'as'");
    alias = tokens[pos].value;
    pos++;
  }

  return {
    type: "PROP_USE",
    prams: { name, prams, as: alias },
    newPosition: pos,
  };
}

function parseActionUse(tokens, pos) {
  pos++;
  if (pos >= tokens.length || tokens[pos].value !== "new")
    throw new Error("Expected 'new' in action use");
  pos++;
  if (pos >= tokens.length || tokens[pos].value !== "action")
    throw new Error("Expected 'action' in action use");
  pos++;
  if (pos >= tokens.length)
    throw new Error("Expected stay time in action use");
  const actionName = tokens[pos].value;
  pos++;
  if (pos >= tokens.length)
    throw new Error("Expected stay time in action use");
  const stayTime = tokens[pos].value;
  pos++;
  if (pos >= tokens.length)
    throw new Error("Expected lerp time in action use");
  const lerpTime = tokens[pos].value;
  pos++;
  let actionUseName;
  if (
    pos >= tokens.length ||
    tokens[pos].type === "newline" ||
    tokens[pos].value === "\n"
  ) {
    actionUseName =
      actionName + "_Use" + String(Math.random()).replace("0.", "");
  } else {
    actionUseName = tokens[pos].value;
  }

  pos++;
  return {
    type: "ACTION_USE",
    prams: { actionUseName, actionName, stayTime, lerpTime },
    newPosition: pos,
  };
}

function parseDefault(tokens, pos, type) {
  const keyword = tokens[pos].value;
  pos++;
  if (pos >= tokens.length || tokens[pos].value !== "=")
    throw new Error(`Expected '=' after ${keyword}`);
  pos++;
  const valueTokens = [];
  while (pos < tokens.length && tokens[pos].type !== "newline") {
    valueTokens.push(tokens[pos]);
    pos++;
  }
  const value = joinTokenValues(valueTokens);
  return { type, prams: { value }, newPosition: pos };
}
