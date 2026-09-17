# The `animations` plugin — syntax guide

This is a tutorial and syntax reference for the **`animations`** plugin:
the scene/prop/action grammar you write to declare what's on screen and
how it moves — `def PROP`, `def ACTION`, `use ... as`, `add new action`,
and the scene markers around all of it. If you're new to CDRCA entirely,
start here — this is the grammar the [README](../../README.md)'s own
quick example uses.

**What this page is, and isn't:** this documents the *syntax the
`animations` plugin recognizes* and how to use it effectively — not an
exhaustive catalog of every built-in prop/method CDRCA ships (`BouncingSphereProp`,
`RotatingCubeProp`, and friends). Those live in, and are documented by,
[the upstream CDRCA repo](https://github.com/ISLAH-org/CDRCA) — this repo
bundles and runs CDRCA, it doesn't own the language or its built-in object
library. What *is* this repo's own doing: `animations` used to be
hardcoded directly into the transpiler; it's now a real, separate plugin
(see [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md) if you're curious
how that works under the hood) that ships with every project automatically
— you don't install it, and nothing here requires you to think about it
as a plugin at all while you're just writing scenes.

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

## Bringing an object into your scene: `use ... as`

```
use <path.to.a.prop>(<constructor args>) as <localName>
```

`<path.to.a.prop>` is a dotted path into CDRCA's built-in object namespace
(or a `PROP` you defined yourself — see below). The parentheses take
whatever constructor arguments that prop expects — could be empty, could
be a color and a number, could be more.

```
use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1
use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0xff0000, 1) as cube
```

`as <localName>` is required — that's the name you refer to this instance
by everywhere else in the file. Hex color literals like `0xff0000` work
correctly as constructor arguments.

## Declaring an action: `add new action`

An action is a named, timed animation run. Declaring one doesn't say what
it *does* yet — just that it exists, and for how long:

```
add new action <name> <stayTime> <lerpTime>
```

```
add new action bounce1 2000 500
```

- `<name>` — how you'll refer to this action when you define what it does
  (`def ACTION`, below) and later when you trigger it.
- `<stayTime>` / `<lerpTime>` — timing values in milliseconds: how long the
  action holds its end state, and how long the transition into it takes.

## Defining what an action does: `def ACTION`

```
def ACTION <actionName> <propName> <methodName> <args>
```

```
def ACTION bounce1 ball1 modifyMesh ""
```

This says: when `bounce1` runs, call `modifyMesh` on `ball1` with the
given arguments. `<propName>` must be a name you already brought in with
`use ... as`. `<methodName>` and what arguments it takes depend on the
prop — again, that catalog is upstream, not this repo's to define.

You can chain more than one `propName.methodName(args)` pair after the
action name on the same definition if the action drives more than one
prop at once — separate each with a `.` the same way you'd chain a dotted
path.

## Defining your own prop: `def PROP`

```
def PROP <name> {
  <code>
}
```

```
def PROP GlowingOrb {
  // prop body
}
```

Everything between `{` and `}` is your prop's own code — this is the
escape hatch for when the built-in prop catalog doesn't have what you
need. Nesting braces inside the body is fine; the parser tracks depth so
your prop's own `{ ... }` blocks don't prematurely close the definition.

**`abstracts`** — a prop can extend another one:

```
def PROP GlowingOrb abstracts ExampleProps.SphereProp {
  // extra behavior on top of SphereProp
}
```

Use this when you want almost-but-not-quite an existing prop, rather than
writing one from scratch.

## Background and gradient: `BGcolor` / `gredientMap`

Two standalone assignment statements, both of the same shape:

```
BGcolor = <value>
gredientMap = <value>
```

```
BGcolor = 0x1a1a2e
gredientMap = someGradientExpression
```

(`gredientMap` is spelled exactly that way — not a typo you need to
correct in your own files, it's the actual keyword the plugin matches.)

## A complete example

```
!--- SCENE Main :: Bouncing balls demo ---

use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1
use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.RotatingCubeProp(0xff0000, 1) as cube

add new action bounce1 2000 500
add new action spin 1500 300

def ACTION bounce1 ball1 modifyMesh ""
def ACTION spin cube modifyMesh ""

!---END---
```

Read top to bottom: bring in a ball and a cube, declare two actions with
their own timing, then say what each action actually does. This is a real
example lifted from this repo's own integration test — it genuinely
transpiles and runs, not a hypothetical.

## Using this alongside Quark

Animation statements and Quark's `@directive` UI layer coexist freely in
the same file — they're two separate plugins registered on the same
underlying hook, and neither interferes with the other:

```
!--- SCENE Main :: Mixed animations + Quark test ---

use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1

add new action bounce1 2000 500

def ACTION bounce1 ball1 modifyMesh ""

@mySidebar sidebar.closable.edgy = open

!---END---
```

See [QUARK-SYNTAX.md](./QUARK-SYNTAX.md) for the `@directive` side of a
file like this.

## Quick reference

| Statement | Shape | Purpose |
|---|---|---|
| Scene markers | `!--- SCENE <name> :: <desc> ---` ... `!---END---` | Bounds your scene's statements |
| `use ... as` | `use <path>(<args>) as <name>` | Bring a prop instance into the scene under a local name |
| `add new action` | `add new action <name> <stayTime> <lerpTime>` | Declare a named, timed action |
| `def ACTION` | `def ACTION <action> <prop> <method> <args>` | Define what an action does |
| `def PROP` | `def PROP <name> { <code> }` | Define your own prop |
| `def PROP ... abstracts` | `def PROP <name> abstracts <other> { <code> }` | Extend an existing prop |
| `BGcolor` | `BGcolor = <value>` | Set the scene background |
| `gredientMap` | `gredientMap = <value>` | Set a gradient map |

For the full built-in object/method catalog and everything about how
CDRCA itself runs a scene once transpiled: [the upstream CDRCA
repo](https://github.com/ISLAH-org/CDRCA).
