# Guides

Tutorials and syntax references, kept separate from the internals docs —
start here if you're learning this tooling for the first time. If you
want to know *how* something works rather than *how to use* it, each
guide below links out to the matching internals doc at the point where
that split happens.

| Guide | For |
|---|---|
| [CLI-GUIDE.md](./CLI-GUIDE.md) | Walking through `cdrca` command by command — creating a project, installing packages, publishing your own |
| [ANIMATIONS-SYNTAX.md](./ANIMATIONS-SYNTAX.md) | The `animations` plugin's scene/prop/action grammar — `def PROP`, `def ACTION`, `use ... as`, `background` (whole page or one element), and the rest |
| [PROJECT-LAYOUT.md](./PROJECT-LAYOUT.md) | A project's own web page: `cdrca.json`'s `html`/`pages` fields, what `cdrca run` serves, where scripts are injected, and `import`/`background` path rules |
| [SYNTAX.md](../SYNTAX.md) | The new cleaner syntax — `require`, `load`, `import`, `js { }` and Quark element rules with flags (`@nav navbar glass sticky`), what works today, and how errors read |
| [QUARK-SYNTAX.md](./QUARK-SYNTAX.md) | The `quark` plugin's `@directive` syntax, design families, and the full component reference |
| [../REACTIVE-STATE.md](../REACTIVE-STATE.md) | `cdrca-reactive-state`'s state/bindings/events, plus `store`/`query` for persistence and async data |
| [../../plugins/ember/README.md](../../plugins/ember/README.md) | `ember`'s motion/effects system — `fx` directives, the preset/easing registries, stagger and chain orchestration |
| [../../plugins/campfire/README.md](../../plugins/campfire/README.md) | `campfire`'s branching dialogue system — `speaker`, `say`, `choice`/`option`, typewriter timing |
| [SYNTAX-STYLE-GUIDE.md](./SYNTAX-STYLE-GUIDE.md) | The rule new statements should follow, so the language doesn't keep drifting in three directions at once |
| [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md) | Building your own plugin or library — including publishing a library for someone else's plugin |

## New here? Read in this order

1. [CLI-GUIDE.md](./CLI-GUIDE.md), section 1 — get a project running.
2. [ANIMATIONS-SYNTAX.md](./ANIMATIONS-SYNTAX.md) — what actually goes in
   the `.cdrca` file you just created.
3. [QUARK-SYNTAX.md](./QUARK-SYNTAX.md) — once you want real UI, not just
   a scene.
4. [../REACTIVE-STATE.md](../REACTIVE-STATE.md) — once you want state,
   data binding, or async data (fetch/cache/Firebase-style sources).
5. [../../plugins/ember/README.md](../../plugins/ember/README.md) —
   once you want real motion (slide/fade/scale presets, easing, stagger
   across a list) instead of hand-rolled CSS transitions.
6. [../../plugins/campfire/README.md](../../plugins/campfire/README.md) —
   once your project needs a character to talk, or a player to make a
   choice that branches the story.
7. [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md) — only once you want
   to extend the tooling itself, not just use it. Read
   [SYNTAX-STYLE-GUIDE.md](./SYNTAX-STYLE-GUIDE.md) first if what you're
   building adds new `.cdrca` syntax of its own.

## Internals (how it works, not how to use it)

- [../ARCHITECTURE.md](../ARCHITECTURE.md) — how this repo's pieces fit
  together
- [../QUARK.md](../QUARK.md) — Quark's component registry and token
  system mechanics
- [../MANIFEST-SPEC.md](../MANIFEST-SPEC.md) — every `cdrca.json` field,
  formally
- [../PLUGIN-LIBRARIES.md](../PLUGIN-LIBRARIES.md) — the full `@useLib`
  resolution design
- [../PLUGIN-PERMISSIONS.md](../PLUGIN-PERMISSIONS.md) — what each
  permission actually grants
- [../CLI-COMMANDS.md](../CLI-COMMANDS.md) — every CLI flag, exhaustively
