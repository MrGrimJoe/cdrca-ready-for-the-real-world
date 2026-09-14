const { test, report, assert } = require("./harness");
const { defaultTokenizer } = require("cdrca/Back-end/Transpiler/Tokenizer.js");
const plugin = require("../plugin.js");
const { reactiveCustomRule } = plugin.__internals;

// Simulates how Parser.js drives the customRule hook: it calls the
// registered callback once per token position with {tokens, pos, token}.
// We only need the single call at the position of the "triggering" token
// (the first token of the statement) since that's what our plugin acts on.
function parseStatement(source) {
  const tokens = defaultTokenizer(source);
  const pos = 0;
  const token = tokens[0];
  return reactiveCustomRule(undefined, { tokens, pos, token });
}

function code(source) {
  const result = parseStatement(source);
  assert.ok(result, `expected a JS_BLOCK for: ${source}`);
  assert.strictEqual(result.type, "JS_BLOCK");
  return result.prams.code;
}

// ---- state --------------------------------------------------------------

test("state: simple numeric literal", () => {
  assert.strictEqual(
    code("state count = 0"),
    'const R = CDRCA.reactive; R.define("count", 0);'
  );
});

test("state: single-character name and single-digit value (tokenizer edge case)", () => {
  // Regression test for the CDRCA Tokenizer.js bug documented in plugin.js
  // (isIdentifierLike/isNewlineToken) — single-char tokens get their
  // `.type` corrupted by whatever follows them.
  assert.strictEqual(code("state x = 5"), 'const R = CDRCA.reactive; R.define("x", 5);');
});

test("state: string literal", () => {
  assert.strictEqual(
    code('state name = "John"'),
    'const R = CDRCA.reactive; R.define("name", "John");'
  );
});

test("state: missing name throws", () => {
  assert.throws(() => parseStatement("state = 0"), /expected a state name/);
});

test("state: missing '=' throws", () => {
  assert.throws(() => parseStatement("state count 0"), /expected '='/);
});

test("state: missing value throws", () => {
  assert.throws(() => parseStatement("state count ="), /expected an initial value/);
});

// ---- computed -------------------------------------------------------------

test("computed: string concatenation of two state names", () => {
  assert.strictEqual(
    code('computed fullName = firstName + " " + lastName'),
    'const R = CDRCA.reactive; R.computed("fullName", () => (R.val("firstName") + " " + R.val("lastName")));'
  );
});

test("computed: arithmetic + Math passthrough", () => {
  assert.strictEqual(
    code("computed rounded = Math.round(total / count)"),
    'const R = CDRCA.reactive; R.computed("rounded", () => (Math.round(R.val("total") / R.val("count"))));'
  );
});

// ---- watch ------------------------------------------------------------

test("watch: simple call action", () => {
  assert.strictEqual(
    code("watch count => save()"),
    'const R = CDRCA.reactive; R.watch("count", (value, oldValue) => { save(); });'
  );
});

test("watch: missing '=>' throws", () => {
  assert.throws(() => parseStatement("watch count save()"), /expected '=>'/);
});

// ---- @id bind.* --------------------------------------------------------

test("bind.text with a bare state reference", () => {
  assert.strictEqual(
    code("@countText bind.text = count"),
    'const R = CDRCA.reactive; R.bind("countText", "text", () => (R.val("count")), null);'
  );
});

test("bind.value is writable back when bound to a bare state name", () => {
  assert.strictEqual(
    code("@nameInput bind.value = name"),
    'const R = CDRCA.reactive; R.bind("nameInput", "value", () => (R.val("name")), "name");'
  );
});

test("bind.value stays read-only for a computed expression", () => {
  assert.strictEqual(
    code('@nameInput bind.value = firstName + lastName'),
    'const R = CDRCA.reactive; R.bind("nameInput", "value", () => (R.val("firstName") + R.val("lastName")), null);'
  );
});

test("bind.class.<name> uses a namespaced kind key", () => {
  assert.strictEqual(
    code("@card bind.class.active = isActive"),
    'const R = CDRCA.reactive; R.bind("card", "class:active", () => (R.val("isActive")), null);'
  );
});

test("bind.style.<prop>", () => {
  assert.strictEqual(
    code("@box bind.style.color = theme"),
    'const R = CDRCA.reactive; R.bind("box", "style:color", () => (R.val("theme")), null);'
  );
});

test("bind.attr.<name>", () => {
  assert.strictEqual(
    code("@link bind.attr.href = url"),
    'const R = CDRCA.reactive; R.bind("link", "attr:href", () => (R.val("url")), null);'
  );
});

test("bind.list = state using template", () => {
  assert.strictEqual(
    code("@todoList bind.list = todos using todoItemTemplate"),
    'const R = CDRCA.reactive; R.bindList("todoList", "todos", "todoItemTemplate");'
  );
});

test("unknown bind kind throws a clear error", () => {
  assert.throws(() => parseStatement("@el bind.whatever = x"), /unknown binding kind 'bind\.whatever'/);
});

test("bind.class without a sub-name throws", () => {
  assert.throws(() => parseStatement("@el bind.class = x"), /needs a name/);
});

// ---- @id <event> => action ----------------------------------------------

test("click event with compound assignment", () => {
  assert.strictEqual(
    code("@increment click => count += 1"),
    'const R = CDRCA.reactive; R.on("increment", "click", (event) => { R.set("count", R.val("count") + (1)); });'
  );
});

test("postfix increment shorthand", () => {
  assert.strictEqual(
    code("@increment click => count++"),
    'const R = CDRCA.reactive; R.on("increment", "click", (event) => { R.set("count", R.val("count") + 1); });'
  );
});

test("plain assignment action", () => {
  assert.strictEqual(
    code('@reset click => count = 0'),
    'const R = CDRCA.reactive; R.on("reset", "click", (event) => { R.set("count", 0); });'
  );
});

test("multiple ;-separated statements in one action", () => {
  assert.strictEqual(
    code("@save click => count = 0; save()"),
    'const R = CDRCA.reactive; R.on("save", "click", (event) => { R.set("count", 0);\nsave(); });'
  );
});

test("single-character element id and event action (tokenizer edge case)", () => {
  assert.strictEqual(
    code("@a click => x = 1"),
    'const R = CDRCA.reactive; R.on("a", "click", (event) => { R.set("x", 1); });'
  );
});

// ---- non-matches / coexistence with Quark --------------------------------

test("a Quark-style preset directive is declined (returns undefined)", () => {
  // e.g. `@sidebar sidebar.closable.edgy = color` — second identifier is
  // "sidebar", not "bind" or a reserved event name, so this plugin must
  // stay out of the way entirely.
  const result = parseStatement("@sidebar sidebar.closable = color");
  assert.strictEqual(result, undefined);
});

test("a statement that is neither ours nor an '@' rule is declined", () => {
  const result = parseStatement("use SomeProp() as p");
  assert.strictEqual(result, undefined);
});

test("already-claimed statements (currentValue set) are never overridden", () => {
  const tokens = defaultTokenizer("@sidebar sidebar.closable = color");
  const fakeQuarkNode = { type: "JS_BLOCK", prams: { code: "/* quark */" }, newPosition: 99 };
  const result = reactiveCustomRule(fakeQuarkNode, { tokens, pos: 0, token: tokens[0] });
  assert.strictEqual(result, undefined);
});

test("object literal keys are not mistaken for state reads", () => {
  assert.strictEqual(
    code("@add click => todos = todos.concat([{ id: nextId, text: newTodoText, done: false }])"),
    'const R = CDRCA.reactive; R.on("add", "click", (event) => { R.set("todos", R.val("todos").concat([{ id : R.val("nextId"), text : R.val("newTodoText"), done : false }])); });'
  );
});

report();
