# ember

A motion/effects system for [CDRCA](https://github.com/ISLAH-org/CDRCA) —
a real preset & easing registry, a genuine
`requestAnimationFrame`-driven interpolation engine, and stagger/chain
orchestration on top. A standalone plugin, independent of and not merged
into any other CDRCA project.

```
@heroCard fx slide-up smooth distance=40px duration=600ms
@ctaButton fx pulse subtle duration=900ms
```

A full runnable example: [examples/landing-hero.cdrca](./examples/landing-hero.cdrca).

## Why this, and why this shape

This plugin exists because of specific, direct feedback on an earlier one
(`campfire`, a dialogue system) built for this same language: it was too
thin — one small feature, no real internal architecture, nothing that
couldn't exist in any language with an event loop. The bar named
explicitly was Quark: "anything that can have a whole independent
architecture with its own libraries to add to it."

So this is built to that shape, deliberately:

- **A core engine with real registries** (`ember-core.js`) — not a
  convenience wrapper around one feature, an actual preset registry, an
  easing registry, and the interpolation loop that drives both. This is
  the architecture, the same relationship `quark-core.js` has to the rest
  of Quark.
- **Multiple official bundles that register INTO those registries**
  (`ember-easings.js`, `ember-presets.js`, `ember-sequences.js`) — none
  of them reach into each other directly. The same relationship
  `quark-components.js`/`quark-templates.js`/`quark-families.js` have to
  `quark-core.js`.
- **Genuinely open to third parties**, the same way, not just in
  principle: anyone can publish their own preset pack against
  `ember-core.js`'s registries with `providesFor: {"plugin": "ember",
  "library": "<theirs>"}` — see
  [Publishing your own preset pack](#publishing-your-own-preset-pack)
  below — indistinguishable from this plugin's own first-party bundles
  once installed.
- **Actually computational**, not just event sequencing — real
  interpolation math, real published easing-curve formulas, verified
  against known reference values, not approximated.

One thing this ISN'T: reaching deeper into CDRCA's own transpiler AST
than `campfire` did. That part turned out not to be the actual gap —
verified directly against CDRCA's real `Back-end/Transpiler/Parser.js`:
`PROP_USE`/`ACTION_USE`/`PROP_DEF`/`ACTION_DEF` are node types CDRCA's
own core transpiler has dedicated, hard-coded support for. A third-party
plugin can't introduce a new one without CDRCA's own core supporting it
— `JS_BLOCK` (the `customRule` hook) is the one integration surface any
plugin actually has, Quark included. Real scale comes from what's built
on top of that, not from a deeper hook.

## Syntax

```
@<elementId> fx <preset> [<modifier>...] [distance=<n>px] [duration=<ms>ms]
```

```
@heroCard fx bounce
@heroCard fx bounce elastic
@title fx shake strong duration=400ms
@box fx slide-up distance=40px duration=600ms
```

- `<elementId>` — a real DOM element's `id`.
- `<preset>` — the first word: which registered preset to run (see the
  built-in catalog below, or your own/a third party's).
- `<modifier>...` — zero or more, space-separated. The first modifier that
  names a registered **easing** wins (`elastic`, `bounce`, `back`,
  `smooth`, `linear`); anything else is left for the preset itself to
  interpret — most bundled presets recognize `subtle`/`strong` for
  intensity, and `spin` recognizes `double`.
- `distance=<n>px` / `duration=<ms>ms` — optional named options, passed
  straight through to the preset. `duration=` controls how long the
  animation runs (default 500ms) — recognized by the engine itself, not
  any individual preset.

## The built-in catalog

**Presets** (`ember.presets`): `bounce`, `shake`, `fadeIn`, `fadeOut`,
`slideUp`, `slideDown`, `spin`, `pulse`. Every one is a pure function of
`(easedProgress, modifiers, params)` — see `ember-presets.js`, each is a
few lines, genuinely readable as a template for your own.

**Easings** (`ember.easings`): `linear`, `smooth` (easeInOutCubic),
`back` (easeOutBack — genuinely overshoots past 1), `elastic`
(easeOutElastic), `bounce` (easeOutBounce). Standard published formulas,
not approximations — verified against known reference values in
`tests/easings.test.js`.

**Sequences** (`ember.sequences`):

```js
Ember.stagger(["card1", "card2", "card3"], "fadeIn", [], { delay: 80 });

Ember.chain("hero", [
  { preset: "slideUp" },
  { preset: "pulse", modifiers: ["strong"] },
]);
```

Both return a Promise — they're plain composition on top of `Ember.play()`
returning one too, nothing special-cased.

## `load`

```
load ember.core        # the engine — always add this
load ember.easings      # optional — the curve library
load ember.presets      # optional — the built-in preset catalog
load ember.sequences    # optional — stagger()/chain()
```

Note what this plugin's own `plugin.js` does **not** do: recognize
`load`/`@useLib` itself. Unlike Quark's `plugin.js`, which parses `@useLib
quark.<n>` into a `Quark.__declareLib(...)` call intended for a page-side
loader (`quark-loader.js`) — which, on inspection, doesn't actually exist
anywhere in this ecosystem yet. `load` resolution for any plugin —
confirmed directly by reading `plugin_frontend_patch.rs`, and already
proven working for `animations`, which also ships zero `load` handling
of its own — happens generically at the CLI's build-time file-staging
level. This plugin follows that simpler, already-functional pattern
rather than replicating a mechanism that appears unfinished even in its
own origin.

## Publishing your own preset pack

This works exactly the way any third-party CDRCA library works — see
`PLUGIN-DEVELOPMENT.md` in `cdrca-ready-for-the-real-world` for the full
mechanism — applied here:

```json
{ "type": "library", "providesFor": { "plugin": "ember", "library": "cinematic" } }
```

```js
(function (global) {
  const Ember = global.Ember;
  if (!Ember) { console.error("must load ember.core first"); return; }
  Ember.registerPreset("dolly", (t, modifiers, params) => ({ ... }));
  Ember.registerEasing("filmic", (t) => { ... });
})(typeof window !== "undefined" ? window : this);
```

From then on, `load ember.cinematic` resolves to that package, and
`@heroCard fx dolly` just works — without this plugin's author ever
knowing that preset pack exists. There's no separate "official"
registration path; a third-party bundle registers into the exact same
`Ember.registerPreset`/`Ember.registerEasing` any of this plugin's own
bundles use.

## Building it, and adding it to a project

Scaffolded and validated using
[`cdrca-ready-for-the-real-world`](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world)
as a *tool* — its documented plugin-hook contract, Quark/
`cdrca-reactive-state`'s real source as reference implementations, and the
real `cdrca` tokenizer (as a devDependency) — but it's not part of that
repo and doesn't depend on it at runtime.

```
cdrca create app my-app
cd my-app
```

Point that project's local package resolution at this directory (the
same "test against a host app" step any new CDRCA plugin goes through
before publishing), add `load ember.core` / `.presets` / `.easings` to
a `.cdrca` file along with some `@id fx` statements, then `cdrca run`.

## What's actually verified

- **Every statement's parsing** tested against the **real CDRCA
  tokenizer** (`npm install cdrca`), the same way `cdrca-reactive-state`
  tests itself — including a real regression the previous plugin in this
  series (`campfire`) also had to work around: `0xRRGGBB`-style literals
  and single-character identifiers don't tokenize the way you'd guess.
- **Every easing formula** checked against known reference values (t=0/
  t=1 boundary for all five, a known midpoint for `smooth`/`elastic`, and
  that `back` genuinely overshoots past 1.0 — the actual defining
  property of that curve).
- **Every preset** tested as the pure function it is — exact values at
  known progress points, and that modifiers (`strong`, `double`, custom
  `distance`) really do change the output, not just get accepted and
  ignored.
- **The interpolation engine itself** tested with an injectable fake
  clock (`Ember._clock`) — frame-by-frame progress, easing actually
  changing which value gets applied (not just which name gets logged),
  and `resolveEasing()`'s fallback behavior.
- **stagger()/chain() orchestration** tested against that same fake
  clock — genuinely non-trivial to get right (two real bugs were caught
  and fixed while writing these specific tests: an unbounded settle loop
  that could hang on an unfinished animation's self-rescheduled frame,
  and a premature timing assertion that checked a Promise's `.then()`
  side effect before the microtask queue had actually run it — both are
  now documented in the test file's own comments, not just silently
  fixed).
- **The full pipeline** — tokenize → compile through `plugin.js` → `eval`
  the generated code against the real engine — run against a real jsdom
  document (`runScripts: "dangerously"`, required for `window.eval` to
  share the same realm as host-assigned globals — confirmed directly,
  the first attempt at this test failed without it), confirming actual
  computed styles land where the math says they should, not just that
  each piece looks plausible alone.

Run all of it:

```
npm install
npm test
```

(`npm install jsdom` first if you want `tests/dom.test.js` too — it
prints `SKIPPED` and exits cleanly otherwise.)

**What isn't verified, and can't be from here:** a true multi-plugin
transpile through CDRCA's actual `Parser.js`/`FullTranspiler.js` — same
honest gap `campfire` and `cdrca-reactive-state`'s own
`integration.test.js` have, for the same reason (the currently-published
`cdrca` npm package doesn't include the plugin-hook system yet). Not
specific to this plugin.

## Before you publish this

- [ ] Fill in `author` in `cdrca.json` (left blank, not guessed)
- [ ] Add a real `icon.png` (none bundled — same gap `campfire` had)
- [ ] Decide on a real `repository` URL

## Where this could go next

- **More presets/easings** — the exact kind of thing a third-party
  library is for (see above), rather than this plugin's own scope
  growing without bound.
- **CSS custom-property targets** — presets currently write directly to
  `el.style[prop]`; animating a CSS variable instead (`--progress`) would
  let a stylesheet drive the actual visual, with `ember-core.js` only
  supplying the number.
- **Cancellation** — `Ember.play()` has no way to stop an in-flight
  animation early right now; a real use case (a hover-cancel-on-mouseleave
  pattern) would want one.
