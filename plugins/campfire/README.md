# campfire

Branching dialogue and narrative for [CDRCA](https://github.com/ISLAH-org/CDRCA) —
speakers, typewriter lines, and choices. A standalone plugin, independent
of and not merged into any other CDRCA project — see
[Building it, and adding it to a project](#building-it-and-adding-it-to-a-project)
below for how to try it against your own app.

```
speaker aria name="Aria" color=#ffcc66

say aria "Didn't think anyone else knew this spot."
say aria "Well. Sit, if you want." wait=2000ms

choice aria "How do you answer?" {
  option "Thanks — mind if I stay a while?" signal=stayFriendly
  option "I was just leaving, actually." signal=leaveCold
}
```

A full runnable scene: [examples/by-the-lake.cdrca](./examples/by-the-lake.cdrca).

## Why this exists

Nothing else in the CDRCA ecosystem does narrative. Quark is UI
components, `animations` is 3D scene/prop timelines, `cdrca-reactive-state`
is data binding — none of them give you a way to say "a character speaks,
the player picks a response, the story branches." campfire is that: the
one thing genuinely missing that gives the language some actual
storytelling charm, not another spin on UI or state.

## Syntax

### Declaring a speaker

```
speaker <id> name="<Display Name>" color=<#RRGGBB>
```

```
speaker aria name="Aria" color=#ffcc66
```

Declare each speaker once, near the top of your scene. `<id>` is how you
refer to them in every `say`/`choice` below. Color is a `#RRGGBB` hex
value, the same format Quark's `accent=`/`family=` options and the
`animations` plugin's color values use, so you're not learning a second
color format for this one plugin.

### A line of dialogue

```
say <speakerId> "<line>"
say <speakerId> "<line>" wait=<ms>ms
```

```
say aria "Didn't think anyone else knew this spot."
say aria "Well. Sit, if you want." wait=2000ms
```

Without `wait`, a line holds until the reader advances it themselves
(click, space, or enter, with the default UI — see below). With `wait`,
it advances itself after that many milliseconds — useful for a beat that
shouldn't wait on input, like a narrator's aside.

### A choice

```
choice <speakerId> "<prompt>" {
  option "<label>" signal=<signalName>
  option "<label>" signal=<signalName>
}
```

```
choice aria "How do you answer?" {
  option "Thanks — mind if I stay a while?" signal=stayFriendly
  option "I was just leaving, actually." signal=leaveCold
}
```

Needs at least one `option`, and the block is closed with `}`. Each
option fires a named **signal** when picked — your own app code reacts to
it:

```js
Campfire.onSignal("stayFriendly", () => {
  // branch your scene however you want from here — another say/choice
  // sequence, a Quark UI change, an animations action, anything
});
```

There's no `goto`/`label` control flow in this version — a signal handler
is where you decide what happens next, in plain JS. That's a deliberate
scope choice, not an oversight: see
[Where this could go next](#where-this-could-go-next).

## The two bundles, and why they're split

```
load campfire.core     # the dialogue engine — always add this
load campfire.ui       # the default typewriter dialogue box — optional
```

- **`campfire.core`** (`campfire-core.js`) is the actual engine: the
  speaker registry, the sequencing queue, `advance()`/`resolveChoice()`.
  It has **zero DOM dependency** — pure logic and an event bus. Every
  `.cdrca` file using campfire needs this one.
- **`campfire.ui`** (`campfire-ui.js`) is a default visual layer built
  entirely on `core`'s own public events — a fireside-styled dialogue box
  with a typewriter reveal and animated choice buttons. It's the "charm,"
  and it's completely optional.

This split is the point, not just tidiness: **you can write your own UI**
against `campfire.core` without touching this plugin's own code at all —
a different look, a different framework, or something that isn't visual
at all (a screen-reader-first experience, a playthrough logger). Every
UI, including this plugin's own default one, is just a listener on the
same small event surface:

```js
Campfire.on("speaker", ({ id, name, color }) => { ... });
Campfire.on("line", ({ speaker, text, wait }) => { ... });     // wait: number | null
Campfire.on("choice", ({ speaker, prompt, options }) => { ... }); // options: [{label, signal}]
Campfire.on("choice-resolved", ({ signal }) => { ... });
Campfire.onSignal("<signal>", () => { ... });                  // sugar for one specific signal

Campfire.advance();            // call when the reader wants to move past a no-wait line
Campfire.resolveChoice(signal); // call when the reader picks an option
Campfire.isWaitingForAdvance;   // read-only, for a UI that doesn't want its own bookkeeping
Campfire.isWaitingForChoice;
Campfire.reset();               // clears the queue (not defined speakers) — for restarts/tests
```

campfire-ui.js itself is a real, worked example of this — read it as a
template for your own alternate UI, not as anything privileged.

**Publishing your own UI for others to use:** this works the same way
any third-party library works for any CDRCA plugin —

```json
{ "type": "library", "providesFor": { "plugin": "campfire", "library": "your-ui-name" } }
```

— and from then on, anyone's `load campfire.your-ui-name` resolves to
your package, without this plugin's author needing to release anything.
See `PLUGIN-DEVELOPMENT.md` in the `cdrca-ready-for-the-real-world` repo
for the full mechanism.

## Building it, and adding it to a project

This plugin was scaffolded and validated using
[`cdrca-ready-for-the-real-world`](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world)
as a *tool* — its documented plugin-hook contract, its real Quark/
`cdrca-reactive-state` reference implementations, and the real `cdrca`
tokenizer (as a devDependency, the same way `cdrca-reactive-state`'s own
tests use it) — but it is **not part of that repo**, isn't added to it,
and doesn't depend on it at runtime. It's a standalone package.

To try it against a real app:

```
cdrca create app my-story
cd my-story
```

Then point that project's local package resolution at this directory
(before this is ever published to a registry, that means wiring your
local store/lock file manually — the same "test against a host app"
step any new CDRCA plugin goes through) and add:

```
load campfire.core
load campfire.ui
```

to a `.cdrca` file, along with some `speaker`/`say`/`choice`
statements, then `cdrca run`.

## What's actually verified, and what needs your own environment

Everything below this plugin's own boundary is genuinely tested, not
assumed:

- **Every statement's parsing** — `speaker`, `say`, `choice` — is
  tested against the **real CDRCA tokenizer** (`npm install cdrca`,
  `Back-end/Transpiler/Tokenizer.js`), the same way `cdrca-reactive-state`
  tests itself, including two real tokenizer quirks this plugin has to
  work around and that its tests pin as regressions: `0xRRGGBB` color
  literals split into two tokens (`"0"` + `"xffcc00"`), and single-
  character identifiers get their `.type` silently corrupted to whatever
  token follows them (confirmed directly, not just assumed from
  Quark's/reactive-state's own comments about it).
- **The full example file** (`examples/by-the-lake.cdrca`) is tokenized,
  compiled statement-by-statement through this plugin's real
  `customRule` dispatcher, and the resulting generated JS is actually
  `eval`'d against the real `campfire-core.js` runtime — proving the
  whole pipeline, not just that each piece looks plausible on its own.
- **`campfire-core.js`** (the engine) is tested standalone in plain Node
  — sequencing, `wait`-driven auto-advance, `resolveChoice`/`onSignal`,
  `reset()` — using fake deterministic timers, no real delays.
- **`campfire-ui.js`** (the default UI) is tested with jsdom — mounting,
  a `line` event actually updating the DOM, a `choice` event rendering
  real buttons, and a real click resolving the correct signal.

Run all of it yourself:

```
npm install
npm test
```

(`npm test` runs `plugin.test.js` and `core.test.js` unconditionally; run
`npm install jsdom` first if you also want `ui.test.js` — it prints
`SKIPPED` and exits cleanly otherwise, rather than failing.)

**What isn't verified, and can't be from here:** a true multi-plugin
integration run through CDRCA's actual `Parser.js`/`FullTranspiler.js` —
confirming `campfire` and `animations` (or Quark) genuinely coexist
inside one real transpile, the way `plugin-architecture.test.js` proves
for `animations` + Quark in the tooling repo. That needs your own CDRCA
checkout with the plugin-hook system
(`Back-end/Transpiler/plugin.js`) — the currently-published `cdrca` npm
package (the one these tests install as a devDependency, for its
tokenizer) doesn't include it yet, which is exactly why
`cdrca-reactive-state`'s own `integration.test.js` in the tooling repo is
gated behind a `CDRCA_RUNTIME_PATH` environment variable rather than
running by default. Not a gap specific to this plugin — the same one
every plugin in this ecosystem currently has.

## Before you publish this

- [ ] Fill in `author` in `cdrca.json` (left blank — not guessed)
- [ ] Add a real `icon.png` (none is bundled here — a scaffolded plugin
      from `cdrca create plugin` normally gets a default CDRCA logo
      copied in automatically; this one didn't go through that path)
- [ ] Decide on a real `repository` URL once this has one
- [ ] Read through `Campfire.onSignal`'s usage in your own app code once
      you've written a real branching scene — signals are deliberately
      unopinionated about what happens after a choice, by design

## Where this could go next

Deliberately out of scope for this first version, and exactly the kind
of thing someone else could build as their own library (see
[the section above](#the-two-bundles-and-why-theyre-split)) rather than
needing to touch `plugin.js` itself:

- **`goto`/`label`** for branching without hand-written signal handlers —
  a real DSL feature, not just sugar, and a bigger parsing surface that
  deserved its own deliberate scope rather than being rushed into v0.1.
- **Portraits** — an optional `portrait="<url>"` field on `speaker`,
  rendered by a UI that wants one (campfire-ui.js doesn't yet).
- **Save/resume** — `campfire-core.js`'s queue is deliberately simple
  in-memory state right now; serializing "where the reader currently is"
  is a natural next step once there's a real save-system convention to
  hook into.
