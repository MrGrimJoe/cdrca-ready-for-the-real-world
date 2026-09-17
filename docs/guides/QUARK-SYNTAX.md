# Quark — syntax guide

Quark is the built-in `@directive` UI component layer: one line applies a
whole prebuilt, styled component to a real HTML element, instead of you
hand-coding the CSS and behavior yourself.

```
@mainNav navbar.glass
@sidePanel sidebar.closable.edgy = #2563eb
@profileCard card.elevated
```

Change one word and the visual treatment changes completely, no HTML
rewrite needed:

```
@mainNav navbar.modern
@mainNav navbar.glass
@mainNav navbar.floating
```

Quark ships with every project automatically — `cdrca create app` and
`cdrca install cdrca` both stage it for you. You never install it
separately and there's no permission prompt for it.

**This page is the tutorial and syntax reference** — how to use Quark
effectively, and the full list of what's available. For how the
component registry, token system, and directive parsing actually work
under the hood, see [QUARK.md](../QUARK.md) instead — you don't need any
of that to use Quark day to day.

## The directive, piece by piece

```
@<elementId> <component>.<modifier>.<modifier>... = <value>
```

```
@profileCard card.elevated.bordered = #10b981
 └────┬────┘  └─┬─┘  └──┬──┘  └─┬──┘   └───┬──┘
   elementId component variant modifier   value
```

- **`<elementId>`** — must match the real `id` of an element in your page.
  Quark finds it with `document.getElementById` when the directive runs.
- **`<component>`** — which built-in component to apply. See the full
  list below.
- **`.<modifier>` chain** — one or more dot-separated words after the
  component name.
  - Most components declare a set of **variants** (different overall
    looks — `elevated`, `glass`, `outlined`, etc.). When they do, the
    **first** word in the chain is the variant, and everything after it
    is a plain modifier (a smaller tweak — `bordered`, `pill`, `compact`).
  - A few components (like `sidebar`) declare no variants at all — every
    word in the chain is just a modifier, nothing is treated specially.
  - Get a word wrong? You get a console warning, not a crash — an unknown
    variant falls back to the component's default, an unknown modifier is
    just skipped.
- **`= <value>`** — optional. A plain color (hex, named, `rgb(...)`, ...)
  sets that one instance's accent color. `= family:<name>` instead applies
  a whole design family scoped to just this element — see
  [Design families](#design-families) below.

## Which library bundles you need: `@useLib`

Quark's component library, template helpers, and design families are
separate, optional bundles — only what you actually reference gets loaded
onto the page. Declare what you use, once per file, anywhere before you
use it:

```
@useLib quark.components
@useLib quark.templates
@useLib quark.families
```

| If your file uses... | Add |
|---|---|
| Any `@id component.variant` directive | `@useLib quark.components` |
| `Quark.templates.scaffold(...)` | `@useLib quark.templates` |
| `Quark.families.setRoot(...)` or `= family:<name>` | `@useLib quark.families` |

Most files that use components at all just need the first line. You don't
need to declare the engine itself (`quark-core.js`) or the compatibility
shim (`quark-ui.js`) — those load unconditionally. After adding a new
`@useLib` line, re-run `cdrca install cdrca` (or `cdrca create app` picks
it up automatically on a fresh project) so the CLI re-scans your source
and updates which `<script>` tags get written into the page.

## Design families

A family is a coordinated, named set of design-token values — think "pick
an aesthetic," not "pick a color." Three ship today:

| Family | Aesthetic | Feels like |
|---|---|---|
| `structured` | Dark-first, sharp corners, tight spacing, flat hairline shadows | Linear / Vercel / Raycast |
| `soft` | Light-first, generous rounded corners, soft diffuse shadows, roomy spacing | Stripe / Notion |
| `bold` | Heavier type, higher contrast, bigger touch targets, assertive fills | Attio / Arc |

**Whole app**, from a `js { ... }` block or your own app code:

```js
Quark.families.setRoot("structured");
```

**Just one component**, right from a directive — everything else on the
page keeps whatever it already had:

```
@myButton button.primary = family:soft
```

This is how you get a hybrid look — "a soft button in an otherwise
structured app" — for free, no extra mechanism. A plain color value
(`= #2563eb`) still works exactly as it always did; `family:` is only
recognized as a literal prefix.

`Quark.families.list()` gives you all three with a one-line description
of each, if you want to build a picker rather than hardcoding a name.

## Composing a layout

Quark components don't replace your HTML — you write the structure, Quark
styles and enhances it. A typical page combines several components under
their own ids:

```
@mainNav navbar.glass.sticky
@sidePanel sidebar.closable.edgy = family:structured
@profileCard card.elevated
@editButton button.outlined
@confirmModal modal.glass
```

Each directive is independent — order in the file doesn't matter, and a
component with declared "parts" (like `navbar`'s `brand`/`navigation`)
looks for child elements with matching class names inside the target
element automatically; you don't wire that up by hand.

## Accessibility notes worth knowing

- Every family's accent color clears at least a 3:1 contrast ratio as a
  white-text button background (the WCAG threshold for large text / UI
  components), and where accent color is used as *text* (outlined/soft/
  flat buttons, the active tab label), it clears the stricter 4.5:1
  normal-text threshold too — verified with a real contrast audit, not
  eyeballed.
- Interactive components (`modal`, `dropdown`, `accordion`, `tooltip`)
  come with real keyboard/focus behavior out of the box — escape-to-close,
  focus traps, click-outside-to-close — so you don't have to reimplement
  it per component.

## Component reference

For every component: **variants** (the first modifier-chain word, where
the component declares any), common **modifiers**, the HTML shape Quark
expects to find, and a real example.

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
- No declared variants — every token in the chain is a modifier.
- Modifiers: `edgy`, `rounded`, `compact`, `closable` (behavioral — adds a
  real close button; sidebars are non-closable by default)
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

## Using Quark alongside the animations plugin

Both are independent plugins on the same underlying hook, so they coexist
freely in one file:

```
!--- SCENE Main :: Mixed animations + Quark test ---

use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1

add new action bounce1 2000 500

def ACTION bounce1 ball1 modifyMesh ""

@mySidebar sidebar.closable.edgy = open

!---END---
```

See [ANIMATIONS-SYNTAX.md](./ANIMATIONS-SYNTAX.md) for the scene/prop/
action side of a file like this.

## Where to go next

- **How Quark actually works** — the component registry, the token
  system, how a directive becomes real code: [QUARK.md](../QUARK.md).
- **Adding your own component library**, or extending Quark from outside
  this repo: [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md).
- **The `@useLib` mechanism in full depth**, including why it has to
  resolve statically: [PLUGIN-LIBRARIES.md](../PLUGIN-LIBRARIES.md).
