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

// ---- multi-character operators ------------------------------------------
// Regression: the tokenizer emits every punctuation character as its own
// token and drops whitespace, so `a == 1` arrives as `a` `=` `=` `1`. The
// expression compiler used to re-join those with spaces (`= =`), which is
// invalid JS and crashed the whole compiled program at load — this had
// already slipped past once before without a regression test, and did so
// again; every case below is checked two ways, the exact text AND that it
// PARSES, specifically so a future string-only check can't let this back in
// a third time.

function exprOf(source) {
  const c = code(source);
  const m = /R\.computed\("x", \(\) => ([\s\S]*)\);$/.exec(c);
  assert.ok(m, "unexpected shape: " + c);
  return m[1];
}

const OPERATOR_CASES = [
  ["clicks == 1", '(R.val("clicks") == 1)'],
  ["clicks === 1", '(R.val("clicks") === 1)'],
  ["clicks != 1", '(R.val("clicks") != 1)'],
  ["clicks !== 1", '(R.val("clicks") !== 1)'],
  ["clicks >= 1", '(R.val("clicks") >= 1)'],
  ["clicks <= 1", '(R.val("clicks") <= 1)'],
  ["clicks > 1", '(R.val("clicks") > 1)'],
  ["clicks && flag", '(R.val("clicks") && R.val("flag"))'],
  ["clicks || 0", '(R.val("clicks") || 0)'],
  ["flag ?? 5", '(R.val("flag") ?? 5)'],
  ["clicks ** 2", '(R.val("clicks") ** 2)'],
];

for (const [expr, expected] of OPERATOR_CASES) {
  test(`operators: "${expr}" compiles to valid JS`, () => {
    const out = exprOf(`computed x = ${expr}`);
    assert.strictEqual(out, expected);
    assert.doesNotThrow(() => new Function("R", "return " + out), "emitted JS must parse: " + out);
  });
}

test('operators: the real ternary used in docs/REACTIVE-STATE.md, "clicks == 1 ? ... : ..."', () => {
  const out = exprOf('computed x = clicks == 1 ? "1 click" : clicks + " clicks"');
  assert.strictEqual(out, '(R.val("clicks") == 1 ? "1 click" : R.val("clicks") + " clicks")');
  assert.doesNotThrow(() => new Function("R", "return " + out));
});

test("operators: a mixed chain keeps precedence-relevant tokens intact", () => {
  const out = exprOf("computed x = clicks >= 10 && flag || clicks == 0");
  assert.strictEqual(out, '(R.val("clicks") >= 10 && R.val("flag") || R.val("clicks") == 0)');
  assert.doesNotThrow(() => new Function("R", "return " + out));
});

test("operators: compound assignment still uses the dedicated += path, unaffected by the operator table", () => {
  assert.strictEqual(
    code("@inc click => count += 1"),
    'const R = CDRCA.reactive; R.on("inc", "click", (event) => { R.set("count", R.val("count") + (1)); });'
  );
});

// ---- reserved-word operators ----------------------------------------------
// Regression: `new`, `typeof`, `in`, `instanceof`, `void` were treated as
// state names and rewritten to R.val("new") etc. They are reserved words, so
// they can never be a state name and are always safe to pass through.

const KEYWORD_CASES = [
  ["new Date().getFullYear()", "(new Date().getFullYear())"],
  ["typeof count", '(typeof R.val("count"))'],
  ['"a" in obj', '("a" in R.val("obj"))'],
  ["items instanceof Array", '(R.val("items") instanceof Array)'],
  ["void 0", "(void 0)"],
];
for (const [expr, expected] of KEYWORD_CASES) {
  test(`keywords: "${expr}" compiles to valid JS`, () => {
    const out = exprOf(`computed x = ${expr}`);
    assert.strictEqual(out, expected);
    assert.doesNotThrow(() => new Function("R", "return " + out), "emitted JS must parse: " + out);
  });
}

// ---- bind.list with a dotted (.property) source name ---------------------
// Regression: `bind.list = users.data using userTemplate` — the exact form
// docs/REACTIVE-STATE.md's Query section documents for an R.query() result
// — was a parse error. bind.list has its own hand-rolled parser (not the
// shared expression compiler bind.show/bind.text use), which only ever
// accepted a single bare identifier.

test("bind.list: a bare state name (no dot) still works, unchanged", () => {
  assert.strictEqual(
    code("@list bind.list = todos using tpl"),
    'const R = CDRCA.reactive; R.bindList("list", "todos", "tpl");'
  );
});

test("bind.list: a one-level dotted path compiles", () => {
  assert.strictEqual(
    code("@userList bind.list = users.data using userTemplate"),
    'const R = CDRCA.reactive; R.bindList("userList", "users.data", "userTemplate");'
  );
});

test("bind.list: the error message still names the right thing when 'using' is missing", () => {
  assert.throws(
    () => code("@userList bind.list = users.data"),
    /expected 'using <templateId>' after 'bind.list = users\.data' on #userList/
  );
});

// ---- the runtime alias "R" is never mistaken for a state name -----------
// Regression: `R.refetch("users")` — the exact call docs/REACTIVE-STATE.md's
// own Query section recommends from an event handler — compiled to
// `R.val("R").refetch("users")`, because the compiler only special-cased
// identifiers preceded by "." (the member NAME), never identifiers
// followed by "." (the member's RECEIVER), unless that receiver happened
// to be in the fixed PASSTHROUGH_IDENTIFIERS list (which "Math" was, but
// "R" was not).

test('the runtime alias: "R.refetch(...)" in an event body is passed through, not read as state', () => {
  assert.strictEqual(
    code('@saveButton click => R.refetch("users")'),
    'const R = CDRCA.reactive; R.on("saveButton", "click", (event) => { R.refetch("users"); });'
  );
});

test('the runtime alias: "R.get(...)" in a computed expression is passed through', () => {
  const out = exprOf('computed x = R.get("count")');
  assert.strictEqual(out, '(R.get("count"))');
});

// ---- callbacks are a build error, not broken output ------------------------
// The docs draw a hard line (no local scope => no arrow functions). The
// compiler must cross that line loudly (a build-time error) rather than
// silently (parameters read as state, invalid JS emitted, page dies at load).

test("callbacks: an arrow function in an event body is a clear build error", () => {
  assert.throws(
    () => code("@b click => items = items.filter(i => i.done)"),
    /arrow functions and function expressions can't be used inside an expression.*JS \{ \} block/
  );
});

test("callbacks: a function expression is a clear build error", () => {
  assert.throws(
    () => code("@b click => items = items.filter(function (i) { return i.done; })"),
    /arrow functions and function expressions can't be used inside an expression/
  );
});

test("callbacks: the same error applies in a computed expression", () => {
  assert.throws(() => code("computed x = items.map(t => t.id)"), /arrow functions/);
});

test("callbacks: the event arrow itself (`click =>`) is not mistaken for one", () => {
  assert.doesNotThrow(() => code("@b click => count += 1"));
});

report();
