# Quark — the built-in `@directive` UI plugin

Quark is a small library of prebuilt UI components (sidebar, and more as
the library grows) that you apply to a real HTML element from inside a
`.cdrca` file with one line, instead of hand-coding the component:

```
@sidebar sidebar.closable.edgy = #2563eb
```

Unlike ecosystem packages/plugins (installed via `cdrca install <name>`,
see [MANIFEST-SPEC.md](./MANIFEST-SPEC.md) and
[PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md)), Quark is **built into
the CLI itself** — every `cdrca create app` and `cdrca install cdrca`
stages it into your project automatically. There's no `cdrca.json`
dependency entry, no registry involvement, and no install-time `y/N`
confirmation prompt for it.

## ⚠️ Current status: not active yet

Quark's plugin hooks into CDRCA's real `("syntax", "customRule")`
transpiler extension point (`Back-end/Transpiler/plugin.js` in a project's
own `node_modules/cdrca`). That hook system exists on
[CDRCA's GitHub `main` branch](https://github.com/ISLAH-org/CDRCA), but
**as of this writing it is not in the npm-published `cdrca` package** —
confirmed directly by installing the real package and running an
`@sidebar ...` directive through its actual `transpile()` export, which
throws:

```
Unexpected token at position 0: @
```

`cdrca create app` and `cdrca install cdrca` still stage Quark's files
into your project regardless (harmless — they just sit inert), but print
a loud warning rather than pretending it's active. `cdrca doctor` reports
this same status under "Quark UI directive plugin". Once a project's
local CDRCA copy is updated to a version that includes the hook system,
re-run `cdrca install cdrca` and it starts working with no other changes.

## Directive syntax

```
@<elementId> <preset>.<modifier>.<modifier>... = <value>
```

- `<elementId>` — must match the `id` of a real element in the page
  CDRCA renders into. Quark resolves it with `document.getElementById`
  at the point the generated code runs.
- `<preset>` — which built-in component to apply. Currently: `sidebar`.
- `.<modifier>` chain — zero or more modifiers, applied in the order
  written. Unknown modifiers are skipped with a console warning, not a
  hard failure.
- `= <value>` — optional. Sets the component instance's accent color
  (CSS custom property `--quark-accent`).

## How it works under the hood

1. CDRCA's tokenizer doesn't recognize `@sidebar` as anything special —
   `@` and `sidebar` come back as separate tokens. Left alone, the parser
   would throw `Unexpected token`.
2. Quark's plugin (`quark/plugin.js` inside your local CDRCA copy's
   `Back-end/Transpiler/Plugins/`) registers on the `("syntax",
   "customRule")` hook — the one hook that runs *before* CDRCA's own
   parser gives up on a token it doesn't recognize.
3. It reads ahead through the token stream (`@`, element id, preset name,
   `.modifier` pairs, optional `= value`) and returns a `JS_BLOCK` AST
   node — the same node type CDRCA already uses for raw embedded JS — so
   no changes to CDRCA's own code generator are needed.
4. That `JS_BLOCK` contains a call like
   `Quark.UI.mount("sidebar", "sidebar", ["closable","edgy"], "#2563eb")`,
   which lands in the same init code CDRCA already runs when the scene
   loads.
5. `Quark.UI.mount` (in `quark/quark-ui.js`, loaded alongside the
   generated scene code) looks up the element, applies the preset's base
   styles, and applies each modifier — some are pure CSS, some (like
   `.closable`) also attach real behavior (a working close button).

## Presets and modifiers

### `sidebar`

| Modifier | Effect |
|---|---|
| `.closable` | Behavioral — adds a real close button that toggles the sidebar off-screen. Sidebars are **not** closable by default (some are non-closeable by design); opt in explicitly. |
| `.edgy` | Style-only — sharp (0px) corners. |
| `.rounded` | Style-only — rounded corners on the open edge. |

More presets (navbar, modal, tooltip, ...) get added to the same registry
in `quark-ui.js` as the library grows — no changes to the plugin or the
directive syntax are needed to add one.

## One real limitation, not hidden

CDRCA only runs a plugin's `customRule` hook unconditionally for `.cdrca`
files that declare **no** `@syntaxPlugin` list at all
(`isHookAllowedForMeta` in CDRCA's `plugin.js` treats an empty list as
"allow everything," but a non-empty list becomes an explicit allowlist).
So `@sidebar ...` works out of the box in ordinary files, but a file that
explicitly opts into other syntax plugins (`@syntaxPlugin someOtherThing`)
would also need to list `quark` to keep using it. This hasn't been raised
with Ayyan yet — worth doing before relying on Quark being unconditionally
available in every file.

## Where the files live

| Path (relative to a project) | What |
|---|---|
| `node_modules/cdrca/Back-end/Transpiler/Plugins/quark/plugin.js` | The transpiler hook. |
| `node_modules/cdrca/Back-end/Transpiler/Plugins/quark/quark-ui.js` | The preset registry + `Quark.UI.mount`. |
| `node_modules/cdrca/Back-end/Transpiler/Plugins/plugins.json` | Merged-in `"quark"` entry (`uses: [["syntax","customRule"]]`, `permissions: []`) alongside any other plugins already registered there. |

All three are (re-)written by `cli/src/quark_patch.rs` every time
`cdrca create app` or `cdrca install cdrca` runs — same idempotent,
loud-on-failure approach as the port patch (see
[ARCHITECTURE.md#quark-ui-directive-patching](./ARCHITECTURE.md#quark-ui-directive-patching)).
Quark's files are always refreshed to match whatever version shipped with
your CLI; only the `plugins.json` entry itself is skipped once present, so
re-running install doesn't duplicate it.
