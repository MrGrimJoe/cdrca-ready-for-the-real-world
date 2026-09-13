# Plugin libraries — `@useLib`

Built-in plugins like Quark can ship more than just their core engine —
Quark alone has `quark-components.js` (a ~20-component library) and
`quark-templates.js` (structural scaffolding helpers) as separate,
optional bundles on top of its required `quark-core.js` engine and
`quark-ui.js` compatibility shim. As more built-in plugins are added,
each will likely have its own multi-file library set the same way.

Unconditionally loading every bundle from every plugin into every
project's page doesn't scale — most `.cdrca` files won't touch most of
a given plugin's library surface. `@useLib` is how a `.cdrca` file
declares which specific library bundles it actually needs, so only
those get loaded into the page.

## Syntax

```
@useLib <pluginName>.<libraryName>
```

Example, in a file that uses Quark's component library but not its
template scaffolding:

```
@useLib quark.components

@mainNav navbar.glass
@profileCard card.elevated
```

## Why this is resolved statically, not at runtime

CDRCA's real `Front-end/index.js` runs a `.cdrca` file's entire
transpiled output as a single synchronous `eval()` call
(`updateRenderer`). Every directive in a file — including `@useLib`
itself — compiles to code that runs inside that one `eval()`. There is
no point *mid-script* to pause execution, inject a new `<script>` tag,
wait for it to load, and then continue running the rest of the
script — by the time any generated code executes, the page's `<script>`
tags have already been decided.

So library selection has to happen **before** the page ever loads, based
on the actual `.cdrca` source text, not at eval-time. The CLI's
`cli/src/quark_libscan.rs` does a plain, best-effort text scan for
`@useLib` lines across every `.cdrca` file in a project (skipping
`node_modules`) whenever `cdrca create app` or `cdrca install cdrca`
runs, and `cli/src/quark_patch.rs`'s `patch_quark_frontend()` uses the
result to decide which library `<script>` tags to write into this
project's local `Front-end/index.html` copy — see
[ARCHITECTURE.md](./ARCHITECTURE.md#quark-ui-directive-patching) for how
that patch works and why it's a local, per-project patch in the first
place.

This means:
- Adding a new `@useLib` line and re-running `cdrca install cdrca`
  picks up the newly-referenced library.
- `Quark.UI.mount(...)` calls still work exactly the same either way —
  `@useLib` only affects which `<script>` tags exist on the page ahead
  of time, never how the mount call itself is compiled.
- `Quark.__declareLib(...)` (what `@useLib` actually compiles to, via
  `plugin.js`) does **not** load anything at runtime. It exists purely
  as a bookkeeping/diagnostic hook — see below.

## What `@useLib` actually compiles to

Same mechanism as Quark's `@id component.variant` directive: `plugin.js`
recognizes `@useLib` via the `("syntax","customRule")` hook and rewrites
it into a `JS_BLOCK` node:

```js
Quark.__declareLib("quark", "components");
```

This call is a no-op with respect to loading anything — by the time it
runs, the script tags are already fixed. What it's for: if
`Quark.components.mount(...)` is ever called for a component whose
library was apparently never declared (usually meaning either the
`.cdrca` file is missing its `@useLib` line, or the CLI's static scan
never saw it — e.g. the file was built dynamically at runtime rather
than read from disk), `Quark.__isLibDeclared(...)` gives future tooling
a way to surface a clear warning instead of a silent, confusing
"component not found" failure. It's diagnostic bookkeeping, not the
loading mechanism itself.

## Which of Quark's bundles need `@useLib`

`quark-core.js` (the registry/tokens/mount engine) and `quark-ui.js`
(the `Quark.UI.mount(...)` compatibility shim generated code calls into)
are **always** loaded — they're Quark's required engine, not optional
libraries, so there's no `@useLib quark.core` or `@useLib quark.ui`.
Only the genuinely optional bundles need declaring:

| `@useLib` name | File | Contents |
|---|---|---|
| `quark.components` | `quark-components.js` | The ~20 built-in components (navbar, card, button, modal, etc.) — see [QUARK.md](./QUARK.md#component-reference) for the full list. |
| `quark.templates` | `quark-templates.js` | Structural scaffolding helpers (`Quark.templates.scaffold(...)`) — optional even if you use components, since most `.cdrca` files author their own HTML structure directly. |

A `.cdrca` file that only calls `Quark.UI.mount(...)` for components
needs `@useLib quark.components`; one that also uses the template
scaffolding system needs both lines.

## Adding a new library bundle to an existing plugin

Two places need updating together — see the comment in
`cli/src/quark_patch.rs`'s `quark_library_file()` for why they must
stay in sync:

1. **`plugin.js`** — add the new bundle name to its own validation map
   (e.g. `QUARK_LIBRARIES` in Quark's `plugin.js`), so
   `@useLib quark.<name>` is validated with a real parse-time error on a
   typo, rather than silently accepted and then failing to do anything.
2. **`quark_patch.rs`** — add the bundle to `quark_library_file()`,
   mapping the same name to its actual bundled file (via `include_str!`),
   so the CLI's static scan knows to stage and reference it.

## Adding this to a brand-new plugin

The `@useLib` directive itself isn't generic infrastructure baked into
the language or into `quark_libscan.rs` — the scanner is a plain text
scan of `@useLib <anything>.<anything>` lines, so it already works for
any plugin name, not just `quark`. A new plugin's own `plugin.js`
implements its own `parseUseLib`-equivalent validation (or reuses the
same pattern Quark's does) for its own library names, and its own
CLI-side patch function (following `quark_patch.rs`'s
`patch_quark_frontend()` as the reference implementation) decides which
of its bundles to stage based on what the scan finds referencing its
plugin name.
