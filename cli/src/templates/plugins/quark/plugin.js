// Quark UI plugin for CDRCA
//
// Registers on the ("syntax", "customRule") hook — the only hook that can
// intercept a statement *before* CDRCA's own parser rejects it. Recognizes:
//
//   @<elementId> <preset>.<modifier>.<modifier>... = <value>
//
// and rewrites it into a JS_BLOCK node, reusing CDRCA's existing raw-JS
// code-gen path instead of teaching the transpiler a new node type:
//
//   { type: "JS_BLOCK", prams: { code: "Quark.UI.mount(...)" }, newPosition }
//
// Permissions required: none. This plugin only reads tokens and returns a
// plain object — it never touches fs/child_process, so it should be
// registered with permissions: [] in plugins.json.

module.exports = function (register /*, hostAPI */) {
  register(0, "syntax", "customRule", quarkCustomRule);
};

function quarkCustomRule(currentValue, ctx) {
  const { tokens, pos, token } = ctx || {};

  // Not an "@..." statement -> not ours. Return undefined so CDRCA's
  // normal switch-case parsing (or another plugin) handles it.
  if (!token || token.value !== "@") return undefined;

  let p = pos + 1;

  // @<elementId>
  if (p >= tokens.length || tokens[p].type !== "identifier") return undefined;
  const elementId = tokens[p].value;
  p++;

  // <preset>
  if (p >= tokens.length || tokens[p].type !== "identifier") return undefined;
  const preset = tokens[p].value;
  p++;

  // .<modifier> .<modifier> ...
  const modifiers = [];
  while (p < tokens.length && tokens[p].value === ".") {
    p++;
    if (p >= tokens.length || tokens[p].type !== "identifier") {
      throw new Error("Quark: expected a modifier name after '.'");
    }
    modifiers.push(tokens[p].value);
    p++;
  }

  // optional = <value>
  let value = null;
  if (p < tokens.length && tokens[p].value === "=") {
    p++;
    if (p >= tokens.length || tokens[p].type === "newline") {
      throw new Error("Quark: expected a value after '='");
    }
    value = tokens[p].value;
    p++;
  }

  const args = [JSON.stringify(elementId), JSON.stringify(preset), JSON.stringify(modifiers)];
  if (value !== null) args.push(JSON.stringify(value));
  const code = `Quark.UI.mount(${args.join(", ")});`;

  return { type: "JS_BLOCK", prams: { code }, newPosition: p };
}
