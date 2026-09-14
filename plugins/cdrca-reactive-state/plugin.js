// cdrca-reactive-state — transpiler plugin
//
// Registers on CDRCA's ("syntax", "customRule") hook (the same hook Quark's
// @directive plugin uses — see docs/QUARK.md and docs/REACTIVE-STATE.md) and
// recognizes five statement forms:
//
//   state <name> = <expr>
//   computed <name> = <expr>
//   watch <name> => <action>
//   @<elementId> bind.<kind>[.<subName>] = <expr>
//   @<elementId> <eventName> => <action>
//
// Every recognized form is rewritten into a JS_BLOCK node — CDRCA's own
// "raw embedded JS" AST node — so no changes to CDRCA's code generator are
// needed (identical strategy to Quark's plugin). The generated code calls
// into the small browser-side runtime (runtime.js / window.CDRCA.reactive)
// which does the actual state storage, dependency tracking, and DOM
// mutation. This file only turns DSL tokens into that runtime's calls; it
// never touches fs/child_process, which is why it declares
// `permissions: []` in cdrca.json.
//
// Coexistence with Quark: Quark's own customRule handler treats ANY
// "@<id> <identifier>(.<identifier>)* (= <token>)?" shape as one of its
// presets, generically — it doesn't know the words "bind" or event names
// are reserved by this plugin. To avoid the two plugins fighting over the
// same "@" statements, this plugin registers at a HIGHER priority (10) so
// it gets first look at every "@" statement, and returns `undefined`
// (declining) for anything that isn't "bind" or one of our reserved event
// names — letting Quark (priority 0) handle real presets normally. Quark's
// own plugin.js was given a matching one-line guard (bail out if a
// higher-priority plugin already produced a node) so the two can never both
// claim the same statement — see the "Quark coexistence" section of
// docs/REACTIVE-STATE.md for the full explanation and the exact diff.

const EVENT_NAMES = new Set([
  "click",
  "input",
  "change",
  "submit",
  "keydown",
  "keyup",
  "focus",
  "blur",
]);

const SIMPLE_BIND_KINDS = new Set([
  "text",
  "html",
  "value",
  "checked",
  "disabled",
  "show",
  "hide",
]);

const NAMED_BIND_KINDS = new Set(["class", "style", "attr", "prop"]);

// Identifiers that read as plain JS globals/literals rather than reactive
// state references, so expressions can still call Math.round(...), compare
// against true/false/null, etc. This is intentionally a short, fixed list —
// see docs/REACTIVE-STATE.md#expression-language for the exact scope and
// why arbitrary local-scoped JS (arrow functions, loops) is out of scope for
// these mini-expressions on purpose.
const PASSTHROUGH_IDENTIFIERS = new Set([
  "true",
  "false",
  "null",
  "undefined",
  "NaN",
  "Infinity",
  "Math",
  "Date",
  "JSON",
  "console",
  "window",
  "document",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "parseInt",
  "parseFloat",
  "isNaN",
]);

// ---------------------------------------------------------------------
// Small token-level helpers
// ---------------------------------------------------------------------

// IMPORTANT: CDRCA's own Tokenizer.js has a verified bug in cleanTheTokens —
// a single-character identifier or single-digit number immediately
// followed by another token has its `.type` silently overwritten with the
// *following* token's type (e.g. `state x = 5` tokenizes "x" as type
// "token", not "identifier", because it's immediately followed by "=").
// Multi-character tokens are unaffected (they take a different code path).
// Rather than relying on `.type` (unreliable for exactly the short
// identifiers/numbers real code uses all the time — `x`, `i`, `0`, `1`...),
// this plugin classifies tokens by the *shape of their value* wherever it
// matters. `.value` is never corrupted, only `.type` is.
function isIdentifierLike(t) {
  return !!t && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.value);
}

function isNewlineToken(t) {
  return !!t && t.value === "\n";
}

function readUntilNewline(tokens, pos) {
  const exprTokens = [];
  while (pos < tokens.length && !isNewlineToken(tokens[pos])) {
    exprTokens.push(tokens[pos]);
    pos++;
  }
  return { exprTokens, newPosition: pos };
}

function noSpaceBefore(value) {
  return value === "." || value === "," || value === ")" || value === "]" || value === "(" || value === ";";
}

function noSpaceAfter(value) {
  return value === "." || value === "(" || value === "[";
}

// Reconstructs a small JS expression from raw CDRCA tokens, substituting
// bare identifiers that read as reactive-state/computed references with
// `R.val("name")`. An identifier is left alone (passed through verbatim)
// when it's a function call (`foo(`), a member access (`.foo`), or one of
// the fixed PASSTHROUGH_IDENTIFIERS above — everything else is assumed to
// be a state/computed name, and resolved (and dependency-tracked) at
// runtime by R.val(). See docs/REACTIVE-STATE.md#expression-language.
function compileExprTokens(tokens) {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    let piece;
    if (isIdentifierLike(t)) {
      const next = tokens[i + 1];
      const isCall = next && next.value === "(";
      const isMemberAccess = prev && prev.value === ".";
      // Object-literal key position: `{ id: nextId, text: ... }` — "id"
      // and "text" are property names, not state reads. Only "{" or ","
      // can legitimately precede a key (a ternary's `cond ? a : b` never
      // has "{"/"," immediately before "a"), so this can't misfire on a
      // ternary.
      const isObjectKey = next && next.value === ":" && prev && (prev.value === "{" || prev.value === ",");
      if (isCall || isMemberAccess || isObjectKey || PASSTHROUGH_IDENTIFIERS.has(t.value)) {
        piece = t.value;
      } else {
        piece = `R.val(${JSON.stringify(t.value)})`;
      }
    } else {
      // strings already include their quotes; numbers/punctuation are used
      // verbatim.
      piece = t.value;
    }
    if (prev && !noSpaceBefore(t.value) && !noSpaceAfter(prev.value)) out += " ";
    out += piece;
  }
  return out;
}

function splitTopLevel(tokens, sepValue) {
  const groups = [];
  let depth = 0;
  let current = [];
  for (const t of tokens) {
    if (t.value === "(" || t.value === "[") depth++;
    else if (t.value === ")" || t.value === "]") depth--;
    if (t.value === sepValue && depth === 0) {
      groups.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  groups.push(current);
  return groups.filter((g) => g.length > 0);
}

// Compiles a small "action" — one or more `;`-separated statements used in
// `watch`/event bodies. Supports plain expression statements (for calls
// like `save()` or `console.log(count)`) and a fixed set of assignment
// forms: `name = expr`, `name += expr` (and -=, *=, /=), and postfix
// `name++` / `name--`. Anything else (arrow functions, loops, local
// variables) is intentionally out of scope — see
// docs/REACTIVE-STATE.md#expression-language. Drop into a normal CDRCA
// `JS { ... }` block and call a plain function for anything beyond this.
function compileActionTokens(tokens) {
  const statements = splitTopLevel(tokens, ";");
  if (statements.length === 0) return "";
  return statements.map(compileSingleActionStatement).join(";\n");
}

function compileSingleActionStatement(tokens) {
  if (tokens.length >= 1 && isIdentifierLike(tokens[0])) {
    const name = tokens[0].value;

    // name++ / name--
    if (
      tokens.length === 3 &&
      (tokens[1].value === "+" || tokens[1].value === "-") &&
      tokens[2].value === tokens[1].value
    ) {
      const delta = tokens[1].value === "+" ? "+ 1" : "- 1";
      return `R.set(${JSON.stringify(name)}, R.val(${JSON.stringify(name)}) ${delta})`;
    }

    // name = expr   (but not "name == ...")
    if (tokens[1] && tokens[1].value === "=" && !(tokens[2] && tokens[2].value === "=")) {
      const rhs = compileExprTokens(tokens.slice(2));
      return `R.set(${JSON.stringify(name)}, ${rhs})`;
    }

    // name += / -= / *= / /= expr
    if (
      tokens.length >= 3 &&
      ["+", "-", "*", "/"].includes(tokens[1].value) &&
      tokens[2].value === "="
    ) {
      const op = tokens[1].value;
      const rhs = compileExprTokens(tokens.slice(3));
      return `R.set(${JSON.stringify(name)}, R.val(${JSON.stringify(name)}) ${op} (${rhs}))`;
    }
  }
  // Fallback: a plain expression statement (function calls, etc.)
  return compileExprTokens(tokens);
}

function jsBlock(code, newPosition) {
  return { type: "JS_BLOCK", prams: { code }, newPosition };
}

// ---------------------------------------------------------------------
// Statement parsers
// ---------------------------------------------------------------------

function parseStateDecl(tokens, pos) {
  let p = pos + 1;
  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("Reactive: expected a state name after 'state'");
  }
  const name = tokens[p].value;
  p++;
  if (!(tokens[p] && tokens[p].value === "=")) {
    throw new Error(`Reactive: expected '=' after 'state ${name}'`);
  }
  p++;
  const { exprTokens, newPosition } = readUntilNewline(tokens, p);
  if (exprTokens.length === 0) {
    throw new Error(`Reactive: expected an initial value after 'state ${name} ='`);
  }
  const exprCode = compileExprTokens(exprTokens);
  const code = `const R = CDRCA.reactive; R.define(${JSON.stringify(name)}, ${exprCode});`;
  return jsBlock(code, newPosition);
}

function parseComputedDecl(tokens, pos) {
  let p = pos + 1;
  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("Reactive: expected a name after 'computed'");
  }
  const name = tokens[p].value;
  p++;
  if (!(tokens[p] && tokens[p].value === "=")) {
    throw new Error(`Reactive: expected '=' after 'computed ${name}'`);
  }
  p++;
  const { exprTokens, newPosition } = readUntilNewline(tokens, p);
  if (exprTokens.length === 0) {
    throw new Error(`Reactive: expected an expression after 'computed ${name} ='`);
  }
  const exprCode = compileExprTokens(exprTokens);
  const code = `const R = CDRCA.reactive; R.computed(${JSON.stringify(name)}, () => (${exprCode}));`;
  return jsBlock(code, newPosition);
}

function parseWatchDecl(tokens, pos) {
  let p = pos + 1;
  if (p >= tokens.length || !isIdentifierLike(tokens[p])) {
    throw new Error("Reactive: expected a state/computed name after 'watch'");
  }
  const name = tokens[p].value;
  p++;
  if (!(tokens[p] && tokens[p].value === "=" && tokens[p + 1] && tokens[p + 1].value === ">")) {
    throw new Error(`Reactive: expected '=>' after 'watch ${name}'`);
  }
  p += 2;
  const { exprTokens: actionTokens, newPosition } = readUntilNewline(tokens, p);
  if (actionTokens.length === 0) {
    throw new Error(`Reactive: expected an action after 'watch ${name} =>'`);
  }
  const actionCode = compileActionTokens(actionTokens);
  const code = `const R = CDRCA.reactive; R.watch(${JSON.stringify(name)}, (value, oldValue) => { ${actionCode}; });`;
  return jsBlock(code, newPosition);
}

function parseBindRule(tokens, pos, elementId, p) {
  if (!(tokens[p] && tokens[p].value === ".")) {
    throw new Error(`Reactive: expected '.' after 'bind' in the binding on #${elementId}`);
  }
  p++;
  if (!(tokens[p] && isIdentifierLike(tokens[p]))) {
    throw new Error(`Reactive: expected a binding kind after 'bind.' on #${elementId}`);
  }
  const kind = tokens[p].value;
  p++;

  if (kind === "list") {
    if (!(tokens[p] && tokens[p].value === "=")) {
      throw new Error(`Reactive: expected '=' after 'bind.list' on #${elementId}`);
    }
    p++;
    if (!(tokens[p] && isIdentifierLike(tokens[p]))) {
      throw new Error(`Reactive: expected a state name after 'bind.list =' on #${elementId}`);
    }
    const stateName = tokens[p].value;
    p++;
    if (!(tokens[p] && tokens[p].value === "using")) {
      throw new Error(
        `Reactive: expected 'using <templateId>' after 'bind.list = ${stateName}' on #${elementId}`
      );
    }
    p++;
    if (!(tokens[p] && isIdentifierLike(tokens[p]))) {
      throw new Error(`Reactive: expected a <template> element id after 'using' on #${elementId}`);
    }
    const templateId = tokens[p].value;
    p++;
    const code = `const R = CDRCA.reactive; R.bindList(${JSON.stringify(elementId)}, ${JSON.stringify(
      stateName
    )}, ${JSON.stringify(templateId)});`;
    return jsBlock(code, p);
  }

  let subName = null;
  if (NAMED_BIND_KINDS.has(kind)) {
    if (!(tokens[p] && tokens[p].value === ".")) {
      throw new Error(
        `Reactive: 'bind.${kind}' needs a name, e.g. 'bind.${kind}.something' (on #${elementId})`
      );
    }
    p++;
    if (!(tokens[p] && isIdentifierLike(tokens[p]))) {
      throw new Error(`Reactive: expected a name after 'bind.${kind}.' on #${elementId}`);
    }
    subName = tokens[p].value;
    p++;
  } else if (!SIMPLE_BIND_KINDS.has(kind)) {
    throw new Error(
      `Reactive: unknown binding kind 'bind.${kind}' on #${elementId}. Valid kinds: ` +
        `text, html, value, checked, disabled, show, hide, class.<name>, style.<prop>, attr.<name>, prop.<name>, list.`
    );
  }

  if (!(tokens[p] && tokens[p].value === "=")) {
    const label = subName ? `${kind}.${subName}` : kind;
    throw new Error(`Reactive: expected '=' after 'bind.${label}' on #${elementId}`);
  }
  p++;
  const { exprTokens, newPosition } = readUntilNewline(tokens, p);
  if (exprTokens.length === 0) {
    const label = subName ? `${kind}.${subName}` : kind;
    throw new Error(`Reactive: expected an expression after 'bind.${label} =' on #${elementId}`);
  }
  const exprCode = compileExprTokens(exprTokens);
  const kindKey = subName ? `${kind}:${subName}` : kind;

  // Two-way sync (value/checked) only makes sense when the expression is a
  // single bare state name — there's no single place to write a derived
  // expression back to. See docs/REACTIVE-STATE.md#two-way-bindings.
  let writableName = "null";
  if ((kind === "value" || kind === "checked") && exprTokens.length === 1 && isIdentifierLike(exprTokens[0])) {
    writableName = JSON.stringify(exprTokens[0].value);
  }

  const code =
    `const R = CDRCA.reactive; R.bind(${JSON.stringify(elementId)}, ${JSON.stringify(kindKey)}, ` +
    `() => (${exprCode}), ${writableName});`;
  return jsBlock(code, newPosition);
}

function parseEventRule(tokens, pos, elementId, p, eventName) {
  if (!(tokens[p] && tokens[p].value === "=" && tokens[p + 1] && tokens[p + 1].value === ">")) {
    // Not our shape (e.g. Quark preset named the same as an event) — decline.
    return undefined;
  }
  p += 2;
  const { exprTokens: actionTokens, newPosition } = readUntilNewline(tokens, p);
  if (actionTokens.length === 0) {
    throw new Error(`Reactive: expected an action after '@${elementId} ${eventName} =>'`);
  }
  const actionCode = compileActionTokens(actionTokens);
  const code =
    `const R = CDRCA.reactive; R.on(${JSON.stringify(elementId)}, ${JSON.stringify(eventName)}, ` +
    `(event) => { ${actionCode}; });`;
  return jsBlock(code, newPosition);
}

function parseAtRule(tokens, pos) {
  let p = pos + 1;
  if (!(tokens[p] && isIdentifierLike(tokens[p]))) return undefined;
  const elementId = tokens[p].value;
  p++;
  if (!(tokens[p] && isIdentifierLike(tokens[p]))) return undefined;
  const second = tokens[p].value;

  if (second === "bind") {
    return parseBindRule(tokens, pos, elementId, p + 1);
  }
  if (EVENT_NAMES.has(second)) {
    return parseEventRule(tokens, pos, elementId, p + 1, second);
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Hook registration
// ---------------------------------------------------------------------

function reactiveCustomRule(currentValue, ctx) {
  // Another (higher- or equal-priority) plugin already produced a node for
  // this statement — don't override it. See the "Quark coexistence" note
  // at the top of this file.
  if (currentValue && currentValue.newPosition !== undefined) return undefined;

  const { tokens, pos, token } = ctx || {};
  if (!token) return undefined;

  switch (token.value) {
    case "state":
      return parseStateDecl(tokens, pos);
    case "computed":
      return parseComputedDecl(tokens, pos);
    case "watch":
      return parseWatchDecl(tokens, pos);
    case "@":
      return parseAtRule(tokens, pos);
    default:
      return undefined;
  }
}

module.exports = function (pluginAPI /*, hostAPI */) {
  // Priority 10 (Quark registers at the default 0) so this plugin gets
  // first look at "@" statements — see the coexistence note above.
  pluginAPI.register(10, "syntax", "customRule", reactiveCustomRule);
};

// Exported for direct unit testing (tests/plugin.test.js) without needing
// to go through the full register()/hook-runner machinery.
module.exports.__internals = {
  reactiveCustomRule,
  compileExprTokens,
  compileActionTokens,
};
