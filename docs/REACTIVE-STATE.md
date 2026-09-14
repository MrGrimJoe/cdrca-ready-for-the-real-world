# cdrca-reactive-state

A lightweight reactive state + DOM data-binding plugin for CDRCA. No
virtual DOM, no component system, no build step — declare some state,
point HTML at it, and it stays in sync.

- [What this solves](#what-this-solves)
- [Install](#install)
- [State](#state)
- [Bindings](#bindings)
- [Two-way bindings](#two-way-bindings)
- [Events](#events)
- [Computed state](#computed-state)
- [Watchers](#watchers)
- [Collections](#collections)
- [Expression language](#expression-language)
- [Lifecycle](#lifecycle)
- [Scoping](#scoping)
- [Async state](#async-state)
- [Storage integration (extension point)](#storage-integration-extension-point)
- [Errors](#errors)
- [Interaction with Quark](#interaction-with-quark)
- [Platform compatibility](#platform-compatibility)
- [A complete small app](#a-complete-small-app)
- [Limitations & what's deliberately NOT here](#limitations--whats-deliberately-not-here)
- [Verified bugs found in CDRCA itself while building this](#verified-bugs-found-in-cdrca-itself-while-building-this)

## What this solves

Without this plugin, keeping the DOM in sync with application data means
manually finding elements and writing to them every time a value changes:

```js
let count = 0;
document.getElementById("count").textContent = count;
// ...somewhere else...
count++;
document.getElementById("count").textContent = count; // don't forget this line
```

This plugin lets you declare the relationship once:

```
state count = 0
@count bind.text = count
@increment click => count += 1
```

`count` now updates `#count`'s text automatically, forever, no matter how
many places change it. HTML stays completely normal HTML — no custom
tags, no framework markup, just plain elements with `id`s that CDRCA
statements point at.

## Install

This is a normal CDRCA ecosystem plugin (`type: "plugin"` in its
`cdrca.json`), not a built-in like Quark — a project that doesn't use it
needs nothing extra. Once published to the registry:

```
cdrca install cdrca-reactive-state
```

`cdrca install` stages it into your project's local CDRCA runtime and
records it in your lockfile (see [Verified bugs found in CDRCA
itself](#verified-bugs-found-in-cdrca-itself-while-building-this) — a
couple of small, real bugs in CDRCA's own plugin loader had to be patched
locally for ANY plugin, including Quark, to actually work; `cdrca create`
and `cdrca install` apply those automatically).

You also need to load the small runtime file once, in your page:

```html
<script src="node_modules/cdrca-reactive-state/runtime.js"></script>
```

(`runtime.js` has zero dependencies and doesn't need a bundler — it's a
plain `<script>` tag.)

## State

```
state count = 0
state name = "Ada"
state loading = false
```

Declares a piece of reactive state with an initial value. State is stored
in a single shared runtime store (`window.CDRCA.reactive`) — see
[Scoping](#scoping) for how to avoid name collisions across a larger app.

Reading state in an expression is just using its name:

```
computed doubled = count * 2
```

Writing state happens from an event or a watcher (see below) — there's no
statement form for "just assign state" outside of those, on purpose:
state changes should be a response to something (a click, an input, a
computed re-run), not sprinkled arbitrarily through the file.

Re-declaring the same `state name = ...` a second time (e.g. because your
scene's init code runs twice) is a no-op — it keeps the current value
instead of resetting it. See [Lifecycle](#lifecycle).

## Bindings

```
@<elementId> bind.<kind> = <expression>
```

| Kind | Effect |
|---|---|
| `bind.text` | `element.textContent` |
| `bind.html` | `element.innerHTML` — **trusted content only**, no sanitization |
| `bind.value` | `element.value` (two-way if bound to a bare state name — see below) |
| `bind.checked` | `element.checked` (two-way if bound to a bare state name) |
| `bind.disabled` | `element.disabled` |
| `bind.show` | `element.style.display` — shown when truthy |
| `bind.hide` | `element.style.display` — shown when falsy |
| `bind.class.<name>` | toggles the single class `<name>` based on truthiness |
| `bind.style.<prop>` | sets the CSS property `<prop>` |
| `bind.attr.<name>` | sets/removes the attribute `<name>` (`false`/`null` removes it) |
| `bind.prop.<name>` | sets the DOM property `<name>` directly |
| `bind.list` | renders an array — see [Collections](#collections) |

Examples:

```
@countText bind.text = count
@card bind.class.active = isActive
@box bind.style.color = theme
@link bind.attr.href = profileUrl
@saveBtn bind.disabled = saving
@panel bind.show = isOpen
```

A binding's expression can read multiple states — whichever ones it
actually reads become its dependencies, tracked automatically (see
[Computed state](#computed-state) for how this tracking works). Only the
bindings that actually depend on a changed value re-run; nothing else on
the page is touched.

Multiple bindings — even different kinds, even on different elements —
can point at the same state; all of them update independently.

## Two-way bindings

Only `bind.value` and `bind.checked` are ever two-way, and only when
bound to a **bare state name**, not a computed expression:

```
@nameInput bind.value = name        ' two-way: typing updates `name`
@display   bind.value = first + last ' one-way only — nowhere to write back to
```

Nothing else is two-way. `bind.text`, `bind.attr.*`, etc. are always
one-way (state → DOM) — the prompt this plugin was built against was
explicit that not everything should silently become two-way, and that's
the rule here: it's opt-in by construction (a plain state reference),
never automatic.

## Events

```
@<elementId> <eventName> => <action>
```

Supported event names: `click`, `input`, `change`, `submit`, `keydown`,
`keyup`, `focus`, `blur`.

```
@increment click => count += 1
@resetBtn click => count = 0
@form submit => save(); count = 0
```

An action can be:
- a compound assignment: `name += expr`, `-=`, `*=`, `/=`
- a postfix increment/decrement: `name++`, `name--`
- a plain assignment: `name = expr`
- a plain call: `save()`
- several of the above separated by `;`

That's the entire action language, deliberately. See [Expression
language](#expression-language) for why, and what to do instead for
anything more elaborate.

## Computed state

```
state firstName = "John"
state lastName = "Smith"
computed fullName = firstName + " " + lastName

@name bind.text = fullName
```

A computed value re-evaluates whenever any state (or other computed) it
actually read last time changes — dependency tracking is automatic (it
records every name your expression reads while it runs, no manual
dependency list), and it recalculates the minimum necessary: if your
expression is `useA ? a : b`, changing `b` while `useA` is true does
nothing, because `b` wasn't read on the last run.

Computed values can depend on other computed values (`quadrupled` depends
on `doubled` depends on `count`) — changes propagate through the whole
chain, still with a single DOM write at the end for whatever's actually
bound.

A computed can't be written to directly (`R.set("fullName", ...)` throws)
— it only ever reflects its expression.

## Watchers

```
watch <name> => <action>
```

For side effects that shouldn't drive UI updates directly — saving,
logging, calling out to something else:

```
watch count => console.log(count)
watch todos => persistTodos()
```

`watch` uses the same small action language as events. Bindings, not
watchers, are the mechanism for normal UI reactivity — don't reach for
`watch count => document.getElementById(...).textContent = count` when a
plain `bind.text = count` already does that, automatically, for free.

## Collections

```
state todos = [
  ' populated at runtime, e.g. via events
]
```

```html
<div id="todoList"></div>
<template id="todoItemTemplate">
  <li>
    <span data-bind-text="text"></span>
    <input type="checkbox" data-bind-checked="done">
  </li>
</template>
```

```
@todoList bind.list = todos using todoItemTemplate
```

`bind.list` clones the `<template>` once per array item, matches items
across re-renders by an `id` field (falling back to array index if there
isn't one), and only adds/removes/reorders the DOM nodes that actually
need it — existing nodes are moved, not destroyed and recreated. Inside
the template, a handful of `data-bind-*` attributes interpolate fields
from each item:

| Attribute | Effect |
|---|---|
| `data-bind-text="field"` | `element.textContent = item.field` |
| `data-bind-html="field"` | `element.innerHTML = item.field` |
| `data-bind-checked="field"` | `element.checked = Boolean(item.field)` |
| `data-bind-class="cls:field"` | toggles class `cls` based on `item.field` |
| `data-bind-attr="attr:field"` | sets/removes attribute `attr` from `item.field` |

This is deliberately the whole feature. There's no per-item event
syntax — `bind.list` clones real DOM nodes, so an ordinary inline
`onclick="removeTodo(this)"` in the template, calling a plain function
defined in a normal CDRCA `JS { ... }` block that uses
`CDRCA.reactive.get`/`set`/`update` directly, works exactly as it would
anywhere else in HTML (per spec, `cloneNode` preserves inline
event-handler attributes — MDN: "cloning a node copies all of its
attributes and their values, including event listeners specified via
attributes"). See [the todo app below](#a-complete-small-app) for a
working example.

> **Testing note:** the test suite verifies `bind.list`'s rendering,
> reconciliation, and the plain helper functions the template's inline
> handlers call, each directly — jsdom (used for `tests/runtime.test.js`)
> has a known gap where it doesn't fire inline event-handler attributes on
> nodes cloned from a `<template>`, so that one specific combination
> (clone → insert → dispatch) isn't exercised by an automated test here.
> The underlying pieces are proven independently; verifying the full
> combination end-to-end needs a real browser.

**What's intentionally NOT here, and why:** per-item computed bindings,
keyed animation on reorder, and a richer templating mini-language (loops,
conditionals inside the template) would all be genuinely useful, but each
adds real complexity for a feature category most apps only lightly touch.
Rather than build a half-good version of any of them into this plugin,
they're left as a natural extension for a later, separate
list-rendering-focused plugin, built on the same JS_BLOCK mechanism, once
there's a concrete app that needs them.

## Expression language

Bindings, `computed`, and the right-hand side of `state` all share a
small expression compiler. A bare identifier reads a state/computed value
(`count` becomes `R.val("count")`); a call (`Math.round(x)`) or a member
access (`.length`) is left as plain JS; string/number literals and the
arithmetic/comparison operators work as expected.

This is intentionally **not** a JS parser. It has no notion of local
scope, so it cannot support:

- arrow functions (`.filter(t => t.id !== id)`)
- `for`/`while` loops
- local `let`/`const`

That's a hard, deliberate line, not an oversight — teaching this compiler
real scoping would be most of the way to building a second JS parser, and
that's exactly the kind of scope creep this plugin is trying to avoid.
Anything past a flat read-arithmetic-and-calls expression belongs in a
normal CDRCA `JS { ... }` block, defining a plain function that reads and
writes state directly:

```
JS {
  function removeTodo(id) {
    const todos = CDRCA.reactive.get("todos");
    CDRCA.reactive.set("todos", todos.filter(t => t.id !== id));
  }
}
```

...and then called from an ordinary event or action: `@clearBtn click =>
removeTodo(currentId)`. This is the same "drop into `JS {}` for anything
beyond the mini-language" idea the prompt asked for, reusing a mechanism
CDRCA already has rather than inventing a second event/expression
language.

## Lifecycle

- **Initialization**: `state`/`computed` declarations run once, in source
  order, when the scene's generated code executes.
- **Re-initialization / duplicate mounting**: re-running the same `state
  name = ...` or `computed name = ...` (e.g. scene init code running
  twice) is a no-op — the existing value and computed subscriptions are
  kept. Re-registering the same `@id bind.kind` or `@id event` a second
  time replaces the previous binding/listener rather than stacking a
  second one.
- **Updates**: a `set()` skips notifying subscribers entirely if the new
  value is `Object.is`-equal to the old one — no redundant DOM writes.
- **Cleanup**: a single shared `MutationObserver` (not polling) notices
  when a bound element is removed from the document and disposes its
  binding/event listener, so pages that add and remove DOM nodes over
  time don't leak subscriptions.

## Scoping

By default, every `state`/`computed` name lives in one shared store for
the whole page — this is the "app state" model: anything can bind to
anything, which is exactly what you want for values genuinely shared
across a page.

For state that's conceptually local to one widget/section, group it into
a single state value instead of inventing separate flat names:

```
state todoApp = { count: 0, filter: "all" }
computed remaining = todoApp.count
```

(the base identifier `todoApp` is resolved through `R.val`, and the
following `.count`/`.filter` are plain JS member access — this already
works with the expression compiler above, no special syntax needed).

**Known limitation:** true per-instance isolated scope (e.g. two
independent copies of the same widget on one page, each with its own
`count`) isn't supported — CDRCA's transpiler doesn't currently expose a
stable per-file or per-component identifier that a plugin could use to
automatically namespace names. Documented here rather than solved with a
naming-convention band-aid; a future version of CDRCA's plugin API
exposing such an identifier would let this be added without any change to
the directive syntax itself.

## Async state

No special syntax — the common `loading`/`data`/`error` pattern is just
three plain `state` declarations, updated from a normal `JS {}` block:

```
state loading = false
state users = []
state error = null

JS {
  function loadUsers() {
    CDRCA.reactive.set("loading", true);
    CDRCA.reactive.set("error", null);
    fetch("/api/users")
      .then(r => r.json())
      .then(data => CDRCA.reactive.set("users", data))
      .catch(err => CDRCA.reactive.set("error", String(err)))
      .finally(() => CDRCA.reactive.set("loading", false));
  }
}
```

```
@spinner bind.show = loading
@errorBox bind.show = error
@errorBox bind.text = error
@userList bind.list = users using userTemplate
```

## Storage integration (extension point)

`CDRCA.reactive.subscribeAll(fn)` calls `fn({ name, value, oldValue })` on
**every** state/computed change, page-wide — the hook a future storage
plugin needs to persist state without this plugin knowing anything about
storage:

```js
CDRCA.reactive.subscribeAll(({ name, value }) => {
  localStorage.setItem(`cdrca:${name}`, JSON.stringify(value));
});
```

Combined with `CDRCA.reactive.define`/`.set` for restoring a value at
startup, this is enough to build persistent settings, offline caches, etc.
as a separate plugin later, without touching this one.

## Errors

- **Unknown state** (`@el bind.text = missingState`): throws at the point
  the binding/computed first evaluates: `Reactive: "missingState" is not
  defined. Declare it first with 'state missingState = ...' or 'computed
  missingState = ...'.`
- **Invalid binding kind** (`bind.whatever`): throws immediately at
  transpile time, since it's a static mistake in the directive itself —
  no need to wait until the browser runs it.
- **Circular computed dependencies**: a *declared* cycle (`a` depends on
  `b`, `b` depends on `a`) is structurally impossible here — a computed
  can only ever read already-declared cells, so you can't even finish
  writing the second half of a real cycle. What the guard actually
  catches is the reentrant case: a compute function that mutates one of
  its own (already-subscribed) dependencies, re-entering its own
  recompute while it's still running. Because that recompute happens
  inside another state's own fan-out to potentially many subscribers, the
  error is reported via `console.error` rather than thrown all the way
  out to the original `set()` call — one runaway computed shouldn't take
  down every other binding on the same state change.

## Interaction with Quark

Quark and this plugin both register on `("syntax", "customRule")` and both
react to statements starting with `@`. Quark's own pattern is a wildcard
(`@id anyIdentifier(.anyIdentifier)* (=token)?`), so without coordination
it would also match `@count bind.text = count` and treat `"bind"` as if
it were an unknown preset name.

This is resolved with two small, coordinated pieces:

1. This plugin registers at **priority 10** (Quark registers at the
   default **0**), so it always gets first look at any `@` statement, and
   declines (`return undefined`) for anything whose second word isn't
   `"bind"` or one of the reserved event names — letting Quark handle
   everything else exactly as before.
2. Quark's own `plugin.js` template was given a one-line guard: if a
   higher-priority plugin already produced a node for this statement
   (visible as `currentValue`), bail out instead of re-parsing and
   silently overriding it. (This is a general correctness fix, not
   something specific to this plugin — any two plugins sharing a hook
   need it, and Quark's original template didn't have it because it was
   written when it was the only consumer of the hook.)

Practical consequence: **`bind` and the eight event names above are
reserved and shouldn't be used as Quark preset names.** None of Quark's
current or planned presets (`sidebar`, ...) collide with this.

Quark controls presentation/component behavior; this plugin controls
application data. Neither touches the other's territory — Quark never
reads/writes `CDRCA.reactive` state, and this plugin never calls
`Quark.UI.mount`.

## Platform compatibility

`runtime.js` only uses standard DOM/`window` APIs (`document.getElementById`,
`MutationObserver`, `addEventListener`, `classList`, `style`) — nothing
specific to a particular browser engine. It works unmodified in a plain
web page, a PWA, or a Tauri webview (CDRCA's planned native-app packaging
target), since all of those are real webviews with the same DOM APIs.

## A complete small app

A todo app showing state, input binding, button events, list rendering,
and a computed count — see
[`examples/todo-app/`](./examples/todo-app) for the full, runnable files.
The whole application logic:

```
state todos = []
state nextId = 1
state newTodoText = ""

computed remaining = todos.filter(t => !t.done).length

@newTodoInput bind.value = newTodoText

@addBtn click => todos = todos.concat([{ id: nextId, text: newTodoText, done: false }]); nextId += 1; newTodoText = ""

@todoList bind.list = todos using todoItemTemplate

@remainingCount bind.text = remaining
```

(`removeTodo`/`toggleTodo`, called from plain `onclick`/`onchange`
attributes in the `<template>`, are defined in one small `JS {}` block —
see the full file. That's the entire app: no build step, no framework,
about 15 lines of CDRCA plus the HTML it points at.)

## Limitations & what's deliberately NOT here

- No virtual DOM, no reconciliation engine — every binding writes to one
  specific DOM property/attribute, directly.
- No JSX, no component system, no `<State>`/`<Component>` custom tags —
  HTML stays HTML.
- The expression language has no local scope (see [Expression
  language](#expression-language)) — arrow functions, loops, and local
  variables belong in a `JS {}` block.
- `bind.list` is intentionally minimal (see [Collections](#collections)):
  no per-item computed bindings, no keyed reorder animation, no
  loops/conditionals inside the template.
- True per-instance/local scoping isn't supported yet (see
  [Scoping](#scoping)) — pending a stable per-component identifier from
  CDRCA's own plugin API.
- No batching/coalescing of rapid synchronous updates — each `set()`
  notifies immediately. Fine at the scale tested (hundreds of bindings,
  see `tests/runtime.test.js`); a future version could add microtask
  batching if a real app needs it, without changing the directive syntax.

## Verified bugs found in CDRCA itself while building this

None of these are specific to this plugin — they affect Quark and any
future plugin equally, and #2 and #3 affect even a plain `JS { ... }`
block with no plugin involved. Each was reproduced directly against
this repo's actual CDRCA source before being patched; nothing here is
guessed — including the one candidate bug below (originally numbered
#3 in an earlier pass over this same investigation) that turned out
**not** to apply to this repo once checked against its real source,
which is called out explicitly rather than silently dropped.

1. **`Tokenizer.js`**: a single-character identifier or single-digit
   number immediately followed by another token has its `.type` silently
   overwritten with the *following* token's type (e.g. in `state x = 5`,
   the token for `x` comes back with `type: "token"`, not
   `"identifier"`, because it's immediately followed by `=`). Both
   `plugin.js` in this package and Quark's `plugin.js` template work
   around this by classifying tokens by the shape of their `.value`
   instead of trusting `.type`. Not patched at the source, since a plugin
   can route around it without touching CDRCA's tokenizer.
2. **`FullTranspiler.js`**: `reshapeToInps()` silently drops every
   top-level `JS_BLOCK` statement — the AST node both Quark and this
   plugin compile to, and what a plain `JS { ... }` block produces too —
   because `"JS_BLOCK"` was never one of the fixed keys its `inputs`
   object recognizes. Verified with no plugin involved: a bare `JS {
   console.log("hi"); }` in a `.cdrca` file produces no trace of that
   code in current output. Already fixed at the source in this repo's
   own bundled fallback CDRCA copy
   (`cli/src/templates/cdrca-runtime/Back-end/Transpiler/FullTranspiler.js`)
   before this investigation started; `cli/src/fulltranspiler_patch.rs`
   applies the same fix to a project's separately-installed
   `node_modules/cdrca` copy, for the case where a future published npm
   version has the plugin-hook system but not yet this fix.
3. **Checked, does NOT apply here: plugin registration calling
   convention.** A previous pass over this same investigation (working
   from an isolated copy of CDRCA's source, not this repo directly)
   flagged a mismatch between how `plugin.js`'s `initializePlugin` calls
   a loaded plugin's `module.exports` — `exported(sandboxedPlugin,
   exposedAPI)`, where `sandboxedPlugin` is `{ register: fn }` — and a
   plugin convention of `module.exports = function (register) {
   register(...) }`, which calls the first argument directly rather than
   `.register` on it. **Checked directly against this repo's actual
   `Back-end/Transpiler/plugin.js` and Quark's actual `plugin.js`
   template: they already agree.** Every plugin.js in this repo (Quark's
   template, and this plugin's own `plugin.js`) is written as
   `module.exports = function (pluginAPI) { pluginAPI.register(...) }` —
   the convention that already matches the host. Applying the other
   patch here would have broken every plugin in this repo, Quark
   included (`pluginAPI.register is not a function`), by swapping the
   object for a bare function. No Rust patch module exists for this
   because there is nothing to patch in this repo. If you're
   integrating this plugin into a *different* CDRCA checkout that uses
   the other convention, re-check which side (the host, or each
   individual `plugin.js`) actually needs to change before reusing any
   fix verbatim — don't assume this repo's shape.
4. **CLI (`install.rs`)**: `cdrca install <plugin>` downloads the package
   and updates the lockfile, but never actually stages it into
   `Plugins/`+`plugins.json` — the piece that makes an installed plugin's
   hooks active. Added generically (not specific to this plugin) in
   `cli/src/plugin_stage.rs`, wired into `install.rs`.
5. **`Parser.js` (`parseJSBlock` / PROP_DEF body)**: joins a raw `JS {
   ... }` block's tokens back into a code string with
   `codeTokens.map(t => t.value).join("")` — no separator. Since CDRCA's
   tokenizer doesn't preserve whitespace as tokens, this glues adjacent
   tokens together whenever the source had a space: `function foo(){
   return 1; }` comes back as `functionfoo(){return1;}` — a SyntaxError.
   This directly undermines the "drop into `JS {}` for anything past the
   mini-language" advice in [Expression language](#expression-language)
   above. Fixed at the source in this repo's bundled fallback CDRCA copy
   (`Parser.js`'s new `joinTokenValues()` helper), and
   `cli/src/parser_spacing_patch.rs` applies the same fix to a project's
   separately-installed `node_modules/cdrca` copy. Not a blanket space
   (which would turn `i++` into the invalid `i + +`) — a space is
   inserted only between two consecutive "word" characters
   (letters/digits/`_`/`$`), leaving punctuation-to-punctuation joins like
   `++`, `--`, `=>` untouched. Verified against both cases directly, and
   end-to-end through the real transpiler (`new Function()` on the
   output).
6. **`Partial_transpiler.js` (JS_BLOCK codegen)**: emits
   `(()=>{<code>})()` with no trailing semicolon, and consecutive
   top-level statements are joined with blank lines only. Two such blocks
   back to back have no semicolon before the second one's leading `(`, so
   JavaScript's automatic semicolon insertion glues them into one invalid
   expression (the first IIFE's return value being "called" with the
   second IIFE as an argument) — `TypeError: (intermediate value)(...) is
   not a function`. This breaks any file with more than one directive —
   i.e. almost any real file. Fixed at the source in this repo's bundled
   fallback CDRCA copy, and `cli/src/js_block_semicolon_patch.rs` applies
   the same fix to a project's separately-installed `node_modules/cdrca`
   copy. Verified end-to-end: two directives back to back now produce
   output that passes `new Function()`.

Every applicable fix (everything above except #3, which needed no fix)
is described in detail, with the exact repro and exact fix, in the doc
comments of the corresponding files (`plugin.js`/`runtime.js` for #1,
`cli/src/fulltranspiler_patch.rs` for #2, `cli/src/plugin_stage.rs` for
#4, `cli/src/parser_spacing_patch.rs` for #5,
`cli/src/js_block_semicolon_patch.rs` for #6). Each was reproduced with a
minimal script before being patched, and re-verified after —
`tests/integration.test.js` (in this plugin's own `tests/` directory)
stages this plugin through the real `Back-end/Transpiler/plugin.js` host
and runs a full multi-directive scene through the real transpiler,
checking the output actually executes (via a real DOM, through
`jsdom`) — not just that it contains the right substrings. All 69 tests
across this plugin's three test files
(`plugin.test.js`/`runtime.test.js`/`integration.test.js`) pass against
this repo's actual source, `node tests/run.js` from
`plugins/cdrca-reactive-state/`.

One additional, narrower finding surfaced while wiring up
`plugin_stage.rs`, unrelated to any of the six above: `Permission::TrustedSys`
serializes (via this CLI's `#[serde(rename_all = "camelCase")]`) to the
string `"trustedSys"`, but the real plugin host checks for the literal
string `"trusted_sys"` (snake_case, the one exception among all seven
permission checks in `plugin.js` — every other permission name is
already camelCase on both sides). A plugin manifest declaring
`trustedSys` can therefore never actually receive that elevated access
end-to-end. Not fixed here — `manifest.rs` is a fixed contract shared
with the registry website, and changing either side's string
convention needs a decision about which side breaks compatibility,
not a rushed unilateral edit.
