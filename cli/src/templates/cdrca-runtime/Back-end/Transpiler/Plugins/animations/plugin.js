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
    case "background":
      // Compiles to JS_BLOCK (like every plugin's non-native statements):
      // it calls into runtime objects (`Backdrop`, `OAS_OBJ`) rather than
      // something CDRCA's own transpiler has dedicated support for. Lives in
      // `animations` rather than as its own plugin because it is a
      // capability of animations — putting an animation behind the page or
      // an element — not a distinct language feature. See parseBackground.
      return parseBackground(tokens, pos + 1);
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

// ---------------------------------------------------------------------
// background [<elementId>] [from "<file>.cdrca"]
//
//   background                                whole page, THIS file's scene
//   background heroSection                    that element, THIS file's scene
//   background from "bg.cdrca"                whole page, bg.cdrca's scene
//   background heroSection from "bg.cdrca"    that element, bg.cdrca's scene
//
// A bare verb-first statement (docs/guides/SYNTAX-STYLE-GUIDE.md, shape 4):
// the element id is the verb's subject, and the ONE optional value uses a
// natural preposition (`from`), not `with {}`. A leading '#' on the id is
// accepted and ignored.
//
// `from` is a path to a .cdrca file in the same project, relative to the
// PROJECT ROOT (the same base as cdrca.json's `entry`). It is compiled
// separately — into its own program that draws into the canvas placed for
// this statement — so it can be authored, and reused, on its own.
//
// Compiles to a JS_BLOCK (see the dispatch case above). Two shapes:
//   own scene -> OAS_OBJ.renderMode = { mode, target }
//                Renderer.js reads it when this file's scene starts.
//   from file -> Backdrop.attach(target, Backdrop.programUrl(path))
//                animations-backdrop.js places the canvas, loads the program
//                the project server / build emits for that path, and runs it.
// ---------------------------------------------------------------------

const ELEMENT_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// By .value ONLY. The tokenizer can tag a single-character token (an id like
// `x`) with type "newline", so a .type check would swallow it.
function isNewlineToken(t) {
  return !!t && t.value === "\n";
}

function isQuoted(t) {
  return (
    !!t &&
    typeof t.value === "string" &&
    t.value.length >= 2 &&
    t.value[0] === '"' &&
    t.value[t.value.length - 1] === '"'
  );
}

function parseBackground(tokens, pos) {
  let p = pos;
  const line = [];
  while (p < tokens.length && !isNewlineToken(tokens[p])) {
    line.push(tokens[p]);
    p++;
  }

  // Classify by .value, never .type (see this plugin's header on the
  // tokenizer's .type corruption for short identifiers).
  const fromAt = line.findIndex((t) => t.value === "from");
  const idTokens = fromAt === -1 ? line : line.slice(0, fromAt);
  const afterFrom = fromAt === -1 ? [] : line.slice(fromAt + 1);

  let target = null;
  if (idTokens.length > 0) {
    const raw = joinTokenValues(idTokens);
    target = raw.replace(/^#/, "");
    if (!ELEMENT_ID.test(target)) {
      throw new Error(
        `animations: 'background ${raw}' — '${raw}' is not a valid element id. ` +
          `Use the id of the element, e.g. 'background heroSection' (no spaces or quotes).`
      );
    }
  }

  if (fromAt === -1) {
    const code = `OAS_OBJ.renderMode = ${JSON.stringify({ mode: "background", target })};`;
    return { type: "JS_BLOCK", prams: { code }, newPosition: p };
  }

  const what = target ? `background ${target} from` : "background from";
  if (afterFrom.length === 0 || !isQuoted(afterFrom[0])) {
    throw new Error(
      `animations: expected a quoted .cdrca file path after '${what}', e.g. '${what} "bg.cdrca"'`
    );
  }
  if (afterFrom.length > 1) {
    throw new Error(`animations: unexpected token after '${what} ${afterFrom[0].value}'`);
  }

  const path = normalizeProjectPath(afterFrom[0].value.slice(1, -1));
  const code = `Backdrop.attach(${JSON.stringify(target)}, Backdrop.programUrl(${JSON.stringify(path)}));`;
  return { type: "JS_BLOCK", prams: { code }, newPosition: p };
}

// `from` paths are project-root-relative .cdrca files. Reject anything that
// could not be one, at compile time, with a message that says why — instead
// of a 404 in the browser later.
function normalizeProjectPath(raw) {
  let path = raw.trim().replace(/^\.\//, "");
  if (path === "") throw new Error("animations: the file path after 'from' is empty");
  if (/\\/.test(path)) {
    throw new Error(`animations: '${raw}' — use forward slashes in project paths`);
  }
  if (/^([A-Za-z][A-Za-z0-9+.-]*:|\/)/.test(path)) {
    throw new Error(
      `animations: '${raw}' — 'from' takes a .cdrca file inside this project, relative to the project root, not a URL or absolute path`
    );
  }
  if (path.split("/").includes("..")) {
    throw new Error(`animations: '${raw}' — a background file must be inside this project ('..' is not allowed)`);
  }
  if (!/\.cdrca$/.test(path)) {
    throw new Error(
      `animations: '${raw}' — 'from' takes a .cdrca file (a background is another CDRCA scene); got a file that doesn't end in .cdrca`
    );
  }
  return path;
}

module.exports.__internals = {
  animationsCustomRule,
  parseBackground,
  normalizeProjectPath,
};
