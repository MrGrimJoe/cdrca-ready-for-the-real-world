# Quark — the built-in `@directive` UI component layer

Quark lets a `.cdrca` file apply a prebuilt, reusable UI component to a real
HTML element with one line, instead of hand-coding it:

```
@mainNav navbar.glass
@sidePanel sidebar.closable.edgy = #2563eb
@profileCard card.elevated
```

Change one word — the variant — and the visual treatment changes completely,
with no HTML rewrite:

```
@mainNav navbar.modern
@mainNav navbar.glass
@mainNav navbar.floating
```

Quark is **built into the CLI itself** — every `cdrca create app` and
`cdrca install cdrca` stages it into your project automatically. There's no
`cdrca.json` dependency entry, no registry involvement, and no install-time
confirmation prompt for it (see [PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md)
for why it's exempt from the ecosystem plugin flow).

## Status: verified working end-to-end against a real CDRCA source checkout

Quark's parser hook (`plugin.js`) registers on CDRCA's real
`("syntax", "customRule")` transpiler extension point
(`Back-end/Transpiler/plugin.js`). This is no longer a theoretical
integration — it has been run through CDRCA's actual transpiler
(`transpiler.transpile(...)`, not a mock) with real `.cdrca` source
containing `@id component.variant` directives, and confirmed to produce
correct final output. Three real bugs were found and fixed in the course
of that verification, all now fixed at the CDRCA source level (not just
worked around here):

1. **Plugin registration shape.** `plugin.js` was calling its first
   argument directly as the register function; CDRCA's real sandboxed
   plugin loader actually passes `{ register: fn }`. Every plugin load
   would have thrown. Fixed: `plugin.js` now calls `pluginAPI.register(...)`.
2. **Multi-token values.** CDRCA's real tokenizer splits a hex color
   like `#2563eb` into three separate tokens (`#`, a number token
   `2563`, and an identifier token `eb`), not one. `plugin.js` now
   concatenates every token up to the terminating newline instead of
   assuming the value is a single token.
3. **`JS_BLOCK` statements were silently dropped from final output —
   a real, previously-unknown bug in CDRCA itself, unrelated to Quark's
   own code.** `FullTranspiler.js`'s `reshapeToInps()` only forwards a
   statement into the final output if its `type` is one of a hardcoded
   set of known keys (`ACTION_DEF`, `PROP_DEF`, `scenes`, etc.) —
   `"JS_BLOCK"` was never one of them, so *any* plugin compiling to a
   `JS_BLOCK` node (Quark included) had its code vanish silently, with
   no error, no log, nothing. This affected the original single-preset
   Quark too, it just was never caught because the npm package didn't
   have the parser hook at all, so it was never exercised. Fixed by
   adding a `JS_BLOCK` key to `reshapeToInps`'s known-types list and a
   template entry in `defaultTemplateRenderer_OBJs` that emits
   collected `JS_BLOCK` statements right after `OAS_OBJ` is built and
   before the scene starts rendering.

A real integration test suite (`tests/quark.test.js` in the CDRCA source
repo, run with `node tests/quark.test.js` — no mocks, calls the actual
`transpiler.transpile()`) covers all of this: a directive alone, a
directive with a multi-token hex value, multiple directives in source
order, a directive alongside real scene content, and confirming a file
with zero directives produces no stray output.

**This applies out of the box via `cdrca create app` / `cdrca install cdrca`.**
This CLI bundles the exact fixed CDRCA source checkout described above
directly into the binary (see
[ARCHITECTURE.md#bundled-cdrca-runtime-fallback](./ARCHITECTURE.md#bundled-cdrca-runtime-fallback))
and installs it automatically whenever `npm install cdrca` produces a
copy missing the plugin-hook system — which, as of this CLI version, is
every copy from the currently-published npm package. You don't need to
do anything extra: `cdrca doctor` / `QuarkPatchOutcome::PluginSystemNotPresent`
only fire if that automatic fallback itself somehow fails (e.g. the
bundled runtime's own `npm install` for its express/prettier/vm
dependencies fails) — not as the expected steady state.

**The page-loading question is also resolved, not just documented as a gap.**
CDRCA's actual `Front-end/index.html` (the page the transpiled `JS_BLOCK`
code runs in via `eval()`) has a persistent `#quarkRoot` container —
unlike the 3D scene, which is torn down and recreated on every
`refreshPreview()`, this element is never removed, so Quark component
instances mounted into it survive re-evaluation — plus `quark-core.js`
and `quark-ui.js` always loaded, and `quark-components.js`/
`quark-templates.js` loaded only when a project's own `.cdrca` files
declare them via `@useLib` (see
[PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md)), so `Quark`/`Quark.UI` are
real, loaded objects by the time any `@id` directive's generated code
runs. One real limitation remains, inherent to CDRCA itself rather than
to Quark: there is no DOM-authoring primitive anywhere in the `.cdrca`
language, so a directive can only target an element that already
exists — which today means a developer creates it themselves via their
own `JS_BLOCK` (the same mechanism Quark's own directive compiles to),
appended into `#quarkRoot`. See the comment in `Front-end/index.html`
for the exact pattern.

## Directive syntax — unchanged from the original grammar

```
@<elementId> <preset>.<modifier>.<modifier>... = <value>
```

This is **exactly** the same grammar the original single-preset (`sidebar`
only) version of Quark used — `plugin.js`'s tokenizer logic has not changed
at all. What's new is entirely in how the runtime (`quark-core.js`)
*interprets* the modifier chain:

- `<elementId>` — must match the `id` of a real element in the page CDRCA
  renders into. Quark resolves it with `document.getElementById` at the
  point the generated code runs.
- `<preset>` — which registered **component** to apply (see
  [Component reference](#component-reference) below).
- `.<modifier>` chain — one or more dot-separated identifiers.
  - **If the component declares variants** (most components do — see below),
    the **first** identifier in the chain is treated as the **variant**
    name, and everything after it is a plain modifier.
  - **If the component declares no variants** (like `sidebar`, kept exactly
    as it always worked), every identifier in the chain is a plain modifier
    — nothing is special-cased. This is what makes `sidebar.closable.edgy`
    keep working byte-for-byte.
  - Unknown modifiers are skipped with a console warning, not a hard
    failure. An unrecognized variant token falls back to the component's
    default variant and the token itself is treated as an (also unknown,
    also warned) modifier.
- `= <value>` — optional. Sets the component instance's accent color (CSS
  custom property `--quark-accent`).

## Declaring which library bundles you use: `@useLib`

Quark ships more than just its `@id component.variant` engine — the
component library itself (`quark-components.js`) and the structural
scaffolding helpers (`quark-templates.js`) are separate, optional
bundles. A `.cdrca` file declares which ones it actually needs with:

```
@useLib quark.components
@useLib quark.templates
```

Only bundles you actually reference get loaded into the page — a file
that never calls `Quark.templates.scaffold(...)` doesn't need
`@useLib quark.templates` at all. See
[PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md) for the full design,
including why this has to be resolved statically (by the CLI scanning
your `.cdrca` source at `create`/`install` time) rather than at
runtime — the short version is that a file's entire generated output
runs inside one synchronous `eval()`, so there's no point mid-script to
pause and inject a new `<script>` tag.

`quark-core.js` (the engine) and `quark-ui.js` (the compatibility shim)
are always loaded regardless — they're Quark's required runtime, not
optional libraries, so they never need a `@useLib` line.

## Three separate concepts

| Concept | What it is | Example |
|---|---|---|
| **Target** | The existing HTML element being enhanced, by id. | `#mainNav` |
| **Component** | What the element semantically represents. | `navbar` |
| **Variant** | How the component looks. Picked by the first modifier token, when the component declares variants. | `navbar.glass` |
| **Modifier** | An opt-in extra — style, behavior, or both — stacked after the variant. | `navbar.glass.sticky` |

```
target  ->  component  ->  variant  ->  modifiers  ->  configuration
 #mainNav     navbar        glass        sticky          (resolved instance)
```

The parser only ever sees "an element id, then an identifier, then a
`.`-chain, then an optional value" — it has no concept of variant vs.
modifier. That distinction is made entirely at runtime by
`Quark.components.mount()`, which is *why* this could be added without
touching the parser or the grammar at all.

## Quark does not replace your HTML

This is the core design rule, unchanged and non-negotiable. If you write:

```html
<div id="sidebar">
  <a href="/home">Home</a>
  <a href="/settings">Settings</a>
</div>
```

Quark never requires `<QuarkSidebar>` and never replaces your children with
generated markup. Your HTML remains the content source. Quark provides
styling, structure enhancement, interaction, state, transitions,
accessibility improvements, and component-specific behavior *on top of* what
you wrote.

## Sub-parts: how components find their children

Components that have recognizable sub-elements (a navbar's brand vs. its nav
links; a card's header vs. body vs. footer) use one lightweight, consistent
convention — never fragile assumptions like "the third child is the nav":

```html
<div id="mainNav">
  <div data-quark-part="brand">My App</div>
  <nav data-quark-part="navigation">
    <a href="/">Home</a>
    <a href="/docs">Docs</a>
  </nav>
</div>
```

Resolution order for a part named `"brand"`:

1. `[data-quark-part="brand"]` — explicit, always wins.
2. `.brand` — a matching class name, so existing markup like the original
   navbar example (`<div class="brand">`) works with **zero changes**.
3. Absent — the component treats that part as optional and skips it.

A component's docs list which part names it looks for; none are required
unless the component explicitly warns about a missing one (dropdown,
popover, and tabs need their interactive parts to function at all).

## The variant system, and why it isn't duplicated component code

Variants are never separate, copy-pasted component implementations:

```js
// NOT this:
navbarModern();  navbarGlass();  navbarMinimal();  // hundreds of duplicated lines

// This — one shared base, small variant deltas:
register({
  name: "navbar",
  base(ctx) { /* structural CSS that EVERY navbar variant needs */ },
  variants: {
    modern: { css: `background: var(--quark-surface-light); box-shadow: var(--quark-shadow-sm);` },
    glass:  { css: `background: var(--quark-surface-glass); backdrop-filter: blur(12px);` },
  },
});
```

Every component's `base()` runs first (structure that's true regardless of
variant), then the chosen variant layers its own CSS/behavior on top. This
is what makes `navbar.modern` → `navbar.glass` a one-word change that
"meaningfully changes the component" per the architecture goal, without any
duplicated structural logic.

### Shared design tokens

Variants build on a small shared token set (`Quark.tokens`, injected once as
root CSS custom properties: `--quark-space-*`, `--quark-radius-*`,
`--quark-font-*`, `--quark-shadow-*`, `--quark-transition-*`,
`--quark-surface-*`, `--quark-border-*`). Components reference these rather
than hardcoding one-off values, so a future global re-theme is possible
without editing every component. This is intentionally a small, flat set —
not a full design-system framework.

## Modifiers

Modifiers stack after the variant, in the order written, and can be
style-only, behavioral, or both:

```
navbar.glass.sticky          -- variant "glass" + modifier "sticky" (style-only)
sidebar.closable.edgy        -- no variant (sidebar declares none) + two modifiers,
                                 "closable" is behavioral (adds a real close button)
card.elevated.interactive    -- variant "elevated" + modifier "interactive"
                                 (adds a real hover-lift behavior)
```

Common modifiers across components: `compact`, `dense`, `spacious`,
`rounded`, `sharp`, `pill`, `elevated`, `bordered`, `sticky`, `fixed`,
`full-width`, `centered`, `dismissible`, `interactive`.

## Component registry — adding a new component without touching the parser

`Quark.components` is the central registry:

```js
Quark.components.register(definition);
Quark.components.get(name);
Quark.components.mount(elementId, componentName, modifierTokens, value);
Quark.components.unmount(elementId);
Quark.components.list();
```

A definition looks like:

```js
Quark.components.register({
  name: "timeline",
  defaultVariant: "modern",     // used when the directive gives no variant token
  variants: {
    modern: { css: `...` },     // a plain CSS string...
    compact: (ctx) => { ... },  // ...or a function for anything CSS can't express
  },
  modifiers: {
    interactive: { css: `...`, behavior: (ctx) => { ... } },
  },
  parts: ["header", "entries"], // documented sub-part convention (optional)
  base(ctx) { /* structural setup that always runs */ },
  mount(ctx) { /* extra one-time mount logic, e.g. attaching listeners */ },
  unmount(ctx) { /* extra teardown, e.g. removing document-level listeners */ },
  docs: { description, expectedHtml, example },
});
```

`ctx` passed to every hook: `{ el, elementId, tokens, css(cssText, key),
value, variant, modifiers, part(name), addCleanup(fn) }`.

- `ctx.css(cssText, key)` scopes and injects CSS under `#elementId`
  automatically (or use `&` inside `cssText` for the root selector, same
  convention the original sidebar preset used).
- `ctx.part(name)` resolves a sub-part using the convention above.
- `ctx.addCleanup(fn)` registers teardown for anything a modifier or
  component appends to the DOM or attaches as a listener, so **unmounting
  and re-mounting are always safe** — no duplicated close buttons, no
  leaked document-level listeners, no piled-up `<style>` tags.

**A third-party developer adding a brand-new component or variant never
modifies `quark-core.js` or `plugin.js`.** They call
`Quark.components.register({...})` from any file loaded after
`quark-core.js` (their own project file, or a future ecosystem plugin) —
the parser and grammar are already generic enough to route any
`@id someComponent.someVariant` directive into that registry lookup.

## Templates — structural patterns, not hardcoded content

`Quark.templates` describes recommended sub-part *shapes* for a component
and can scaffold empty part containers — it never invents copy, links, or
data:

```js
Quark.templates.get("navbar", "logo-links-actions");
// -> { component: "navbar", name: "logo-links-actions",
//      parts: ["brand", "navigation", "actions"],
//      describe: "Logo, nav links, and right-aligned actions." }

Quark.templates.scaffold("navbar", "logo-links-actions", document.getElementById("mainNav"));
// creates empty [data-quark-part="..."] containers for any part that
// doesn't already exist — never touches a part that's already there.
```

This is optional. `Quark.components.mount()` never requires a template to
exist; templates are a convenience for starting a new element's structure,
not a rendering layer.

## Composing layouts

Multiple components combine by applying separate directives to separate
elements in the same page — there's no special "layout" directive:

```
@appSidebar sidebar.compact
@appNavbar navbar.minimal
@statsCard card.elevated
@statsCard2 card.elevated
```

A dashboard, an auth screen, or any other multi-component layout is just
several ordinary `@id component.variant` lines applied to elements you've
already arranged in your own HTML — matching the "HTML + CSS + Quark, not a
separate framework" design goal.

## Accessibility

Interactive components apply sensible defaults without blanket ARIA:
keyboard navigation and visible focus rings (`tabs`, `pagination`,
`button`), escape-to-close and focus trapping (`modal`, `dropdown`,
`popover`), semantic roles only where they add real information
(`role="dialog"`, `role="tablist"`/`role="tab"`, `role="progressbar"`,
`role="alert"`/`role="status"`), and `disabled` styling. All animated
components check `prefers-reduced-motion` and skip transitions/keyframes
when it's set.

## Responsive behavior

`navbar` hides its `navigation` part under a `max-width: 720px` media query
by default rather than assuming one fixed breakpoint is right for every
project's own responsive strategy — a project can override this in its own
CSS at any specificity it likes, since Quark's rules are namespaced and
never marked `!important`. `sidebar` is fixed/persistent by default and
becomes closable (with its own toggle, not just a CSS class) via the
`.closable` modifier — same behavior as always.

## Component reference

For every component: **target** = the element the directive points at,
**component** = the `<preset>` name, common **variants**, common
**modifiers**, expected HTML shape, and an example.

### Layout / navigation

#### `navbar`
- Variants: `modern` (default), `glass`, `minimal`, `floating`, `compact`,
  `enterprise`, `dark`
- Modifiers: `sticky`, `fixed`, `centered`, `full-width`, `bordered`,
  `elevated`
- Parts: `brand`, `navigation`, `actions`, `mobileMenu`
- Expected HTML: `<div id="mainNav"><div class="brand">...</div><nav>...</nav></div>`
- Example: `@mainNav navbar.glass.sticky`

#### `sidebar`
- No declared variants (preserves exact original behavior) — every token in
  the chain is a modifier.
- Modifiers: `edgy`, `rounded`, `compact`, `closable` (behavioral — real
  close button; sidebars are non-closable by default)
- Parts: `header`, `navigation`, `footer`
- Expected HTML: `<div id="sidebar"><div class="logo">...</div><div class="navigation">...</div></div>`
- Example: `@sidebar sidebar.closable.edgy = #2563eb`

#### `tabs`
- Variants: `modern` (default), `pill`, `minimal`
- Modifiers: `centered`, `full-width`
- Parts: `tablist`, `panels`
- Expected HTML: `<div id="tabs"><div class="tablist"><button>One</button><button>Two</button></div></div>`
- Example: `@tabs tabs.pill`

#### `breadcrumb`
- Variants: `modern` (default), `minimal`
- Expected HTML: `<div id="crumbs"><a href="/">Home</a><a href="/docs">Docs</a></div>`
- Example: `@crumbs breadcrumb.minimal`

#### `pagination`
- Variants: `modern` (default), `pill`, `minimal`
- Expected HTML: `<div id="pages"><button>Prev</button><button>1</button><button>Next</button></div>`
- Example: `@pages pagination.pill`

### Content

#### `card`
- Variants: `modern` (default), `elevated`, `flat`, `outlined`, `glass`, `soft`
- Modifiers: `bordered`, `rounded`, `sharp`, `compact`, `spacious`,
  `interactive` (behavioral — hover lift)
- Parts: `header`, `body`, `footer`
- Expected HTML: `<div id="profileCard"><h2>Profile</h2><p>...</p><button>Edit</button></div>`
- Example: `@profileCard card.elevated`

#### `badge`
- Variants: `solid` (default), `outlined`, `soft`
- Modifiers: `pill`, `dense`
- Example: `@statusBadge badge.outlined`

#### `avatar`
- Variants: `circle` (default), `rounded`, `sharp`
- Modifiers: `bordered`, `sm`, `lg`
- Example: `@userAvatar avatar.rounded`

#### `alert`
- Variants: `info` (default), `success`, `warning`, `danger`
- Modifiers: `dismissible` (behavioral), `bordered`
- Example: `@formAlert alert.success.dismissible`

#### `callout`
- Variants: `modern` (default), `soft`, `editorial`
- Example: `@tip callout.soft`

### Forms

#### `button`
- Variants: `primary` (default), `secondary`, `outlined`, `solid`, `soft`, `flat`
- Modifiers: `pill`, `sharp`, `compact`, `full-width`, `elevated`
- Example: `@loginButton button.outlined`

#### `input` / `textarea` / `select`
- Variants: `modern` (default), `minimal`, `soft`
- Modifiers: `bordered`, `rounded`, `full-width`
- Example: `@emailInput input.bordered.full-width`

#### `checkbox` / `radio`
- Variant: `modern` (default)
- Example: `@agree checkbox.modern`

#### `toggle`
- Variants: `modern` (default), `pill`
- Expected HTML: `<input id="darkMode" type="checkbox" />`
- Example: `@darkMode toggle.pill`

#### `form`
- Variants: `modern` (default), `compact`, `spacious`
- Parts: `fields`, `actions`
- Example: `@loginForm form.spacious`

### Overlays / interaction

#### `modal`
- Variants: `modern` (default), `glass`, `minimal`
- Modifiers: `rounded`, `sharp`
- Parts: `header`, `body`, `footer`
- Behavior: escape-to-close, focus trap, backdrop click-to-close, real
  open/close (`el.quarkOpen()` / `el.quarkClose()`)
- Expected HTML: `<div id="confirmModal" hidden><h2>Confirm</h2><p>...</p></div>`
- Example: `@confirmModal modal.glass`

#### `dropdown`
- Variants: `modern` (default), `minimal`
- Parts: `trigger` (required), `menu` (required)
- Behavior: click-to-open, click-outside-to-close, escape-to-close
- Expected HTML: `<div id="userMenu"><button class="trigger">Account</button><div class="menu">...</div></div>`
- Example: `@userMenu dropdown.modern`

#### `tooltip`
- Variants: `modern` (default), `dark`, `light`
- Requires a `data-tooltip="..."` attribute on the target element
- Expected HTML: `<button id="helpIcon" data-tooltip="More info">?</button>`
- Example: `@helpIcon tooltip.dark`

#### `popover`
- Variant: `modern` (default)
- Parts: `trigger` (required), `content` (required)
- Example: `@infoPop popover.modern`

#### `toast`
- Variants: `modern` (default), `success`, `danger`
- Modifiers: `dismissible`
- Behavior: entrance transition on mount
- Example: `@saveToast toast.success.dismissible`

#### `accordion`
- Variants: `modern` (default), `bordered`
- Expected HTML: `<div id="faq"><div class="item"><button class="header">Q1</button><div class="panel">A1</div></div></div>`
- Example: `@faq accordion.bordered`

### Status

#### `progress`
- Variants: `modern` (default), `pill`, `flat`
- Requires a `data-progress="0-100"` attribute
- Example: `@uploadBar progress.pill`

#### `loader`
- Variant: `spin` (default)
- Example: `@spinner loader.spin`

#### `skeleton`
- Variant: `modern` (default)
- Example: `@cardSkeleton skeleton.modern`

## One real limitation, not hidden

CDRCA only runs a plugin's `customRule` hook unconditionally for `.cdrca`
files that declare **no** `@syntaxPlugin` list at all
(`isHookAllowedForMeta` in CDRCA's `plugin.js` treats an empty list as
"allow everything," but a non-empty list becomes an explicit allowlist). So
`@id component.variant` directives work out of the box in ordinary files,
but a file that explicitly opts into other syntax plugins
(`@syntaxPlugin someOtherThing`) would also need to list `quark` to keep
using it. This hasn't been raised with Ayyan yet.

## Where the files live

Only `plugin.js` runs server-side — it's the only file CDRCA's own
`Back-end/Transpiler/plugin.js` ever `require()`s. Every other Quark
file (`quark-core.js`, `quark-ui.js`, and the library bundles) is
browser-only and lives exclusively under the project's `Front-end/`
copy, loaded via `<script>` tags into the actual page CDRCA's
`Front-end/index.js` `eval()`s generated code into.

| Path (relative to a project) | What | Staged when |
|---|---|---|
| `node_modules/cdrca/Back-end/Transpiler/Plugins/quark/plugin.js` | The transpiler hook — parses `@id ...` and `@useLib ...` into `JS_BLOCK` nodes. | Always |
| `node_modules/cdrca/Back-end/Transpiler/Plugins/plugins.json` | Merged-in `"quark"` entry (`uses: [["syntax","customRule"]]`, `permissions: []`). | Always (entry added once, never duplicated) |
| `node_modules/cdrca/Front-end/Transpiler-Plugins/quark/quark-core.js` | The component registry, design tokens, and mount/unmount engine. Loaded first. | Always |
| `.../quark/quark-ui.js` | The `Quark.UI.mount(...)` compatibility shim — the exact call shape `plugin.js`'s generated code invokes. Loaded last. | Always |
| `.../quark/quark-components.js` | The built-in component library. Loaded between `quark-core.js` and `quark-ui.js`. | Only if some `.cdrca` file in the project has `@useLib quark.components` |
| `.../quark/quark-templates.js` | Structural scaffolding helpers. Loaded between `quark-core.js` and `quark-ui.js`. | Only if some `.cdrca` file in the project has `@useLib quark.templates` |
| `node_modules/cdrca/Front-end/index.html` | Patched with a managed `<!-- QUARK:START -->...<!-- QUARK:END -->` block: a persistent `#quarkRoot` container plus whichever `<script>` tags apply per the row above. | Always re-patched (see below) |

All of this is (re-)written by `cli/src/quark_patch.rs` every time
`cdrca create app` or `cdrca install cdrca` runs — same idempotent,
loud-on-failure approach as the port patch (see
[ARCHITECTURE.md#quark-ui-directive-patching](./ARCHITECTURE.md#quark-ui-directive-patching)).
The backend plugin files and `quark-core.js`/`quark-ui.js` are always
refreshed to match whatever version shipped with your CLI. The
`index.html` block is fully replaced (not appended to) on every run —
so if you remove a `@useLib` line and re-run `cdrca install cdrca`,
the now-unused library's `<script>` tag is removed too, not left
behind. See [PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md) for the full
design behind why library selection works this way.
