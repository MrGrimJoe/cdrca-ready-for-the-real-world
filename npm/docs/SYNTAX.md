# CDRCA syntax reference

This is the complete, authoritative syntax reference for CDRCA. **Every example on this page is
the syntax to write.** CDRCA has no existing users or projects, so there is no reason to ever write
anything else — this is not "the new syntax", it is simply *the* syntax.

> ⚠️ **One honest caveat, stated once, here, so it never needs repeating elsewhere.** The compiler
> currently accepts this syntax by rewriting it internally into an older, legacy statement form
> before parsing (see `docs/design/LANGUAGE-PLAN.md`'s top section for the full explanation). That
> older form still also compiles if hand-written directly — it is simply never shown here, never
> documented, and nobody should ever write it. Removing that old form from the parser entirely (so
> it becomes a compile error) is tracked as follow-up work, not yet done. Nothing in this document
> is affected by that; every statement below is real, tested, and works today.

Every example on this page is verified to compile — see `tools/docs-v2-check.js`.

## The whole language, at a glance

This is an overview, not one runnable file — it mixes several scenes' worth of statements and
references a file that doesn't exist here. Every piece of it is a real, individually-verified
example elsewhere on this page.

```syntax
// setup
require quark, ember, cdrca-reactive-state, animations, campfire
load quark.components
import "story.cdrca"

// state and reactive-state
state clicks = 0
computed label = clicks == 1 ? "1 click" : clicks + " clicks"
store cart persist=local ttl=1h = []
source main = firebase({ apiKey: "…" })
query users cache=60s depends=[searchText] = fetch("/api/users").then(r => r.json())

// animations
object cube = RotatingCube(#3b82f6, 1)
prop GlowingOrb abstracts=SphereProp { return 1; }
action spin stay=2000ms lerp=500ms { cube.modifyMesh("") }
scene.background = #0b1020
@page backdrop
@hero backdrop "hero-bg.cdrca"

// elements
@mainNav   navbar glass sticky full-width
@startBtn  button primary pill accent=#10b981
@count     bind.text = clicks
@startBtn  click => clicks += 1
@heroCard  fx slide-up smooth distance=40px duration=600ms

// dialogue
speaker aria name="Aria" color=#ffcc66
say aria "Sit, if you want." wait=2000ms

// settings
quark.family = soft
```

## Element rules — `@id ...`

```syntax
@id  component  [flags…]  [option=value…]
```

- `@id` is the id of an element in your HTML. Ids may contain hyphens (`@hero-card`).
- `component` is a component from Quark (27 of them: `navbar`, `button`, `card`, `modal`, …) or
  another plugin's own capability (`backdrop`, `fx`).
- **Flags** are plain words. The first one may be a *variant* (`primary`, `glass`, `soft`);
  every other flag is a *modifier* (`pill`, `sticky`, `full-width`). **Order does not matter.**
- **Options** are written `name=value` with **no spaces around `=`**.
- To use a component from a specific plugin explicitly: `@save quark.button primary`.

```txt
@nav       navbar glass sticky full-width
@b         button primary pill accent=#10b981
@card      card elevated family=soft
@hero-card card elevated
```

| Option | Value | Example |
|---|---|---|
| `accent` | a colour: `#rrggbb`, `rgb(…)`, a colour name | `accent=#10b981` |
| `family` | `structured`, `soft` or `bold` | `family=soft` |

`accent` and `family` cannot be combined on one element yet.

## Directives

| Write | Meaning |
|---|---|
| `require quark, ember` | Load plugins this file uses |
| `load quark.components` | Stage a library's `<script>` tag |
| `import "story.cdrca"` | Bring in another file's scenes |
| `js { … }` | An escape hatch for raw JavaScript |

**`import` paths are relative to the file that says `import`** (web-style, like a link):

| Written in `src/pages/main.cdrca` | Finds |
|---|---|
| `import "sibling.cdrca"` or `"./sibling.cdrca"` | `src/pages/sibling.cdrca` |
| `import "../shared/x.cdrca"` | `src/shared/x.cdrca` |
| `import "/top.cdrca"` | `top.cdrca` (project root) |

Each hop of a chain resolves against *its own* file, so an imported file can import others. A path
that climbs out of the project stops the build with the line and column.

## Errors

A mistake in a statement stops the build with the line, the column, and a suggestion:

```txt
line 3, column 19: unknown flag 'stickyy' for navbar — did you mean 'sticky'?
  variants: modern, glass, minimal, floating, compact, enterprise, dark  |  modifiers: sticky, fixed, centered, full-width, bordered, elevated
  3 | @nav navbar glass stickyy
    |                   ^^^^^^^
```

Other messages you may see: `unknown component '…' — did you mean '…'?` (with a hint to `require`
the plugin if it's from elsewhere), `unknown option '…' for …`, `write options without spaces:
accent=value`, `'#12' is not a colour`, `button has one variant, and you gave two: … and …`,
`'click' is an event, not a component`.

## State, computed, watch, bind, events (reactive-state)

These already read exactly like this — there is nothing older to compare them to.

```txt
state count = 0
computed doubled = count * 2
watch count => console.log(count)

@countText  bind.text = count
@card       bind.class.active = isActive
@box        bind.style.color = theme
@link       bind.attr.href = profileUrl
@saveBtn    bind.disabled = saving
@panel      bind.show = isOpen
@nameInput  bind.value = name           // two-way
@todoList   bind.list = todos using todoItem

@increment  click => count += 1
@form       submit => save()
```

Bind kinds: `text html value checked disabled show` plus `class.<name>` `style.<prop>`
`attr.<name>` `list`. Events: `click input change submit keydown keyup focus blur`.

## Reactive state: `store`, `query`, `source`

Three more primitives, for persistence and async data:

```syntax
store  <name> [persist=local|session|memory] [ttl=<duration>] = <expr>
source <name> = <expr>
query  <name> [from=<source>] [cache=<duration>] [depends=[<name>, …]] = <expr>
```

```txt
store cart persist=local ttl=1h = []
source main = firebase({ apiKey: "…" })
query users cache=60s depends=[searchText] = fetch("/api/users").then(r => r.json())
```

- Needs the matching library staged: `load cdrca-reactive-state.store` / `.query`.
- **Options go before `=`.**
- **Durations** (`ttl=`, `cache=`) take a bare number of milliseconds or a suffixed duration —
  `500ms`, `60s`, `5m`, `2h`, `1d` — both producing identical output.
- **`from=`** names an already-`source`-registered adapter. With it, `=` takes an **object** (the
  config that adapter's `get(config)` receives), not an expression:
  `query users from=main = { url: "/api/users" }`
- **The expression after `=` is passed through exactly as written** — it is not rewritten the way
  a `computed`/`bind` expression is. Reach a cell explicitly with `R.get(...)`:
  `query filteredUsers depends=[searchText] = fetchFiltered(R.get("searchText"))`
- **`from=` referencing an unregistered source throws immediately, at declaration.**

## Animations

```syntax
object <name> = <PropCtor>(<args>)
prop <Name> [abstracts=<Base>] { /* js */ }
action <name> stay=<duration> lerp=<duration> { <object>.<method>(<args>) … }
scene.background = <color>
scene.gradient = { data: […], width: N }
```

```txt
object cube = RotatingCube(#3b82f6, 1)
prop GlowingOrb abstracts=SphereProp { return 1; }
action spin stay=2000ms lerp=500ms { cube.modifyMesh("") }
scene.background = #0b1020
```

`object` resolves through a small built-in table (`RotatingCube`, `BouncingSphere`, …) to the real
runtime path. `action`'s body is "effects applied while this action's window is active" — not
sequential steps.

### Backdrop — an animation behind the page or an element

```txt
@page  backdrop                   // this file's own scene, behind the whole page
@hero  backdrop                   // this file's own scene, behind <div id="hero">
@page  backdrop "hero-bg.cdrca"   // hero-bg.cdrca's scene, behind the whole page
@hero  backdrop "hero-bg.cdrca"   // …behind #hero
```

`@page` is reserved for the whole page. The file after `backdrop` is a `.cdrca` file inside your
project, relative to the project root, compiled separately into its own program. Needs a project
that owns its page (`cdrca create app`) — see `docs/guides/PROJECT-LAYOUT.md`.

## Motion: `fx` (ember)

> ember is shipped as a separate, standalone plugin package — not part of this repo — so its
> examples aren't compiled by this repo's own doc checker. They're verified in that package's own
> test suite instead (`verification/ember-campfire.test.js`).

```syntax
@id fx <preset> [modifier…] [distance=<px>] [duration=<duration>]
```

```syntax
@heroCard  fx slide-up smooth distance=40px duration=600ms
@ctaButton fx pulse subtle duration=900ms
```

Presets: `bounce shake fade-in fade-out slide-up slide-down spin pulse`. The first word after `fx`
is always the preset. Modifiers include easings (`linear smooth back elastic bounce`) and
per-preset intensity words (`subtle strong double`).

## Dialogue: `speaker`, `say`, `choice` (campfire)

> campfire is also shipped as a separate, standalone plugin package — see the note above.

```syntax
speaker <id> name="<Display Name>" color=<color>
say <id> "<line>" [wait=<duration>]
choice <id> "<prompt>" {
  option "<label>" signal=<name>
  option "<label>" signal=<name>
}
```

```syntax
speaker aria name="Aria" color=#ffcc66
say aria "Didn't think anyone else knew this spot."
say aria "Well. Sit, if you want." wait=2000ms
choice aria "How do you answer?" {
  option "Thanks — mind if I stay?" signal=stayFriendly
  option "I was just leaving."       signal=leaveCold
}
```

`say`/`choice` run in source order (dialogue order is the meaning); everything else on this page
is unordered.

## Plugin settings

```txt
quark.family = soft
```

Only `quark.family` exists today (`structured`, `soft`, `bold`).

## A complete example

`src/main.cdrca`:
```syntax
require quark, ember, cdrca-reactive-state, animations
load quark.components
load ember.presets
load cdrca-reactive-state.store

quark.family = structured
store clicks persist=local = 0
computed label = clicks == 1 ? "1 click" : clicks + " clicks"

@page     backdrop "hero-bg.cdrca"
@mainNav  navbar glass sticky full-width
@hero     card elevated rounded
@startBtn button primary pill
@startBtn click => clicks += 1
@count    bind.text = label
@hero     fx slide-up smooth distance=40px duration=600ms
```

`src/hero-bg.cdrca`:
```syntax
require animations
object c1 = RotatingCube(#3b82f6, 1)
object c2 = RotatingCube(#10b981, 1)
action spin1 stay=2000ms lerp=500ms { c1.modifyMesh("") }
action spin2 stay=1500ms lerp=300ms { c2.modifyMesh("") }
scene.background = #0b1020
```
