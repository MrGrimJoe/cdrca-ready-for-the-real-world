# The `animations` plugin — syntax guide

This is a tutorial and syntax reference for the **`animations`** plugin:
the scene/prop/action grammar you write to declare what's on screen and
how it moves — `object`, `action`, `prop`, `scene.background`, and the
scene markers around all of it. If you're new to CDRCA entirely, start
here — this is the grammar the [README](../../README.md)'s own quick
example uses.

**What this page is, and isn't:** this documents the *syntax the
`animations` plugin recognizes* and how to use it effectively — not an
exhaustive catalog of every built-in prop/method CDRCA ships
(`BouncingSphere`, `RotatingCube`, and friends). Those live in, and are
documented by, [the upstream CDRCA repo](https://github.com/ISLAH-org/CDRCA)
— this repo bundles and runs CDRCA, it doesn't own the language or its
built-in object library. What *is* this repo's own doing: `animations`
used to be hardcoded directly into the transpiler; it's now a real,
separate plugin (see [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md) if
you're curious how that works under the hood) that ships with every
project automatically — you don't install it, and nothing here requires
you to think about it as a plugin at all while you're just writing
scenes.

## The shape of a file

Every `.cdrca` file's animation content lives inside a scene block:

```
!--- SCENE Main :: Bouncing balls demo ---

...your statements here...

!---END---
```

- `!--- SCENE <name> :: <description> ---` opens a scene. The name and
  description are free text — they don't affect behavior, they're for you.
- `!---END---` closes it.
- `//` starts a line comment.

Everything below happens *inside* that block.

## Bringing an object into your scene: `object`

```
object <name> = <Prop>(<constructor args>)
```

`<Prop>` is one of CDRCA's built-in prop names (or a `prop` you defined
yourself — see below). The parentheses take whatever constructor
arguments that prop expects — could be empty, could be a color and a
number, could be more.

```
object ball1 = BouncingSphere()
object cube = RotatingCube(0xff0000, 1)
```

`<name>` is required — that's the name you refer to this instance by
everywhere else in the file. Hex color literals like `0xff0000` work
correctly as constructor arguments.

## Declaring what an action does: `action`

An action is a named, timed animation run — one statement declares its
timing and its body together:

```
action <name> stay=<ms>ms lerp=<ms>ms {
  <objectName>.<methodName>(<args>)
}
```

```
action bounce1 stay=2000ms lerp=500ms {
  ball1.modifyMesh("")
}
```

- `<name>` — how you'll refer to this action when you trigger it.
- `stay=`/`lerp=` — timing values in milliseconds: how long the action
  holds its end state, and how long the transition into it takes.
- The body says what the action does when it runs. `<objectName>` must
  be a name you already brought in with `object`. `<methodName>` and
  what arguments it takes depend on the prop — again, that catalog is
  upstream, not this repo's to define.

You can put more than one `object.method(args)` statement in the body,
each on its own line or separated by `;`, if the action drives more than
one object at once.

## Defining your own prop: `prop`

```
prop <name> {
  <code>
}
```

```
prop GlowingOrb {
  // prop body
}
```

Everything between `{` and `}` is your prop's own code — this is the
escape hatch for when the built-in prop catalog doesn't have what you
need. Nesting braces inside the body is fine; the parser tracks depth so
your prop's own `{ ... }` blocks don't prematurely close the definition.

**`abstracts`** — a prop can extend another one:

```
prop GlowingOrb abstracts=ExampleProps.SphereProp {
  // extra behavior on top of SphereProp
}
```

Use this when you want almost-but-not-quite an existing prop, rather than
writing one from scratch.

## Background and gradient: `scene.background` / `scene.gradient`

Two standalone assignment statements, both of the same shape:

```
scene.background = <value>
scene.gradient = <value>
```

```
scene.background = #1a1a2e
scene.gradient = someGradientExpression
```

`scene.background` takes a `#rrggbb`/`#rgb` color. `scene.gradient` is
unevaluated — it's spliced straight into the compiled output, so it can
be any JS expression your gradient helper expects.

> **Known limit.** Neither statement currently changes the compiled output — this is true of the
> original transpiler as well, not something introduced here. They parse without error and don't
> break anything else in the file; they just don't yet do anything visible. Filed for a later fix.

## Putting an animation behind the page or an element: `backdrop`

```
@page backdrop                              // whole page, THIS file's scene
@heroSection backdrop                       // that element, THIS file's scene
@page backdrop "bg.cdrca"                   // whole page, bg.cdrca's scene
@heroSection backdrop "bg.cdrca"            // that element, bg.cdrca's scene
```

`backdrop` puts an animation **behind** your content — either the whole
page (`@page`, reserved for exactly this) or one element by its id, the
same `@elementId` targeting Quark's directives use. It's an element rule,
like any Quark `@id` statement.

> **Status.** All four forms work end to end in a project with its own page
> (`cdrca create app`, or `html`/`pages` in `cdrca.json` — see
> [PROJECT-LAYOUT.md](./PROJECT-LAYOUT.md)). Without a project page — a bare
> `transpile()` call, or the original preview server — the two forms
> **without a file** still work; the two **with a file** compile but have
> nothing to load the other file from.

### This file's own scene — works today

```
!--- SCENE Main :: hero ---
object cube = RotatingCube(0x3b82f6, 1)
@page backdrop
!---END---
```

Your scene is drawn behind the page instead of into the preview canvas.
`@heroSection backdrop` does the same behind `<div id="heroSection">`.

### Another file's scene — a file path

The file is a **`.cdrca` file inside your project**, relative to the project
root (the same base as `entry` in `cdrca.json`) — not a URL, not an absolute
path, not `..`, and not a JavaScript file. That lets you build a background
from scratch in one file and use it from another file where you are also
working with Quark, keeping one main file that pulls the others together:

```
@heroSection backdrop "src/backgrounds/stars.cdrca"
```

A `.js` path (the form an earlier version documented) is a compile-time
error that says so.

The path is read relative to the **project folder** (the same base as `entry`), not to the
file that says `backdrop` — unlike `import`, which is file-relative (see
[SYNTAX.md](../SYNTAX.md#imports)). The browser loads it as
`/__cdrca/bg/<path>.js`, an ES module compiled from that file, run in its own
scope — so two backgrounds can reuse the same variable names without clashing.

### How the canvas is placed

**Whole page:** a canvas is inserted as the first child of `<body>`, with
`position: fixed; inset: 0; width: 100%; height: 100%; z-index: -1;
pointer-events: none`. It stays put while the page scrolls.

**One element:** the element becomes the positioning context — it gets
`position: relative` **only if** it doesn't already have a real position (a
`sticky`, `absolute` or `fixed` element you set up yourself is left alone) —
and a canvas is inserted as its first child, absolutely positioned at 100% by
100%. It scrolls, resizes and clips with the element using plain CSS.

**Both** make the target its own stacking context (`isolation: isolate`).
That is what keeps the canvas *above* the element's own background colour but
*below* its content. Without it, any element with a background would hide its
animation completely.

**Resizing:** the drawing surface follows the window (page) or the element
itself (a `ResizeObserver`, so it also reacts to an element that changes size
while the window doesn't).

### Things to know

- The target element must exist when the script runs. Load your script at the
  end of `<body>` or with `defer`. If it can't be found you get a console
  warning naming the id — the scene doesn't crash.
- An opaque wrapper you put around your content (a `<div>` with a solid
  background, say) will cover a page background. That is your CSS, not the
  animation.
- The runtime for this (`animations-backdrop.js`) is loaded on every page
  automatically. **You do not need `load animations.backdrop`.**

### Errors you may see

```
animations: 'background hero banner' — 'hero banner' is not a valid element id. Use the id of the element, e.g. 'background heroSection' (no spaces or quotes).
animations: expected a quoted .cdrca file path after 'background hero from', e.g. 'background hero from "bg.cdrca"'
animations: 'a.js' — 'from' takes a .cdrca file (a background is another CDRCA scene); got a file that doesn't end in .cdrca
animations: '../x.cdrca' — a background file must be inside this project ('..' is not allowed)
```

## A complete example

```
!--- SCENE Main :: Bouncing balls demo ---

object ball1 = BouncingSphere()
object cube = RotatingCube(0xff0000, 1)

action bounce1 stay=2000ms lerp=500ms {
  ball1.modifyMesh("")
}
action spin stay=1500ms lerp=300ms {
  cube.modifyMesh("")
}

!---END---
```

Read top to bottom: bring in a ball and a cube, then declare two actions,
each with its own timing and its own body. This is a real example lifted
from this repo's own integration test — it genuinely transpiles and runs,
not a hypothetical.

## Using this alongside Quark

Animation statements and Quark's `@directive` UI layer coexist freely in
the same file — they're two separate plugins registered on the same
underlying hook, and neither interferes with the other:

```
!--- SCENE Main :: Mixed animations + Quark test ---

object ball1 = BouncingSphere()

action bounce1 stay=2000ms lerp=500ms {
  ball1.modifyMesh("")
}

@mySidebar sidebar closable edgy accent=open

!---END---
```

See [QUARK-SYNTAX.md](./QUARK-SYNTAX.md) for the `@directive` side of a
file like this.

## Quick reference

| Statement | Shape | Purpose |
|---|---|---|
| Scene markers | `!--- SCENE <name> :: <desc> ---` ... `!---END---` | Bounds your scene's statements |
| `object` | `object <name> = <Prop>(<args>)` | Bring a prop instance into the scene under a local name |
| `action` | `action <name> stay=<ms>ms lerp=<ms>ms { <object>.<method>(<args>) }` | Declare a named, timed action and what it does |
| `prop` | `prop <name> { <code> }` | Define your own prop |
| `prop ... abstracts` | `prop <name> abstracts=<other> { <code> }` | Extend an existing prop |
| `scene.background` | `scene.background = <value>` | Set the scene background |
| `scene.gradient` | `scene.gradient = <value>` | Set a gradient map |
| `backdrop` | `@page backdrop ["<file>.cdrca"]` / `@<id> backdrop ["<file>.cdrca"]` | Put an animation behind the whole page or one element (the file forms need the project server) |

For the full built-in object/method catalog and everything about how
CDRCA itself runs a scene once transpiled: [the upstream CDRCA
repo](https://github.com/ISLAH-org/CDRCA).
