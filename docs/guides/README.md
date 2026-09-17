# Guides

Tutorials and syntax references, kept separate from the internals docs —
start here if you're learning this tooling for the first time. If you
want to know *how* something works rather than *how to use* it, each
guide below links out to the matching internals doc at the point where
that split happens.

| Guide | For |
|---|---|
| [CLI-GUIDE.md](./CLI-GUIDE.md) | Walking through `cdrca` command by command — creating a project, installing packages, publishing your own |
| [ANIMATIONS-SYNTAX.md](./ANIMATIONS-SYNTAX.md) | The `animations` plugin's scene/prop/action grammar — `def PROP`, `def ACTION`, `use ... as`, and the rest |
| [QUARK-SYNTAX.md](./QUARK-SYNTAX.md) | The `quark` plugin's `@directive` syntax, design families, and the full component reference |
| [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md) | Building your own plugin or library — including publishing a library for someone else's plugin |

## New here? Read in this order

1. [CLI-GUIDE.md](./CLI-GUIDE.md), section 1 — get a project running.
2. [ANIMATIONS-SYNTAX.md](./ANIMATIONS-SYNTAX.md) — what actually goes in
   the `.cdrca` file you just created.
3. [QUARK-SYNTAX.md](./QUARK-SYNTAX.md) — once you want real UI, not just
   a scene.
4. [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md) — only once you want
   to extend the tooling itself, not just use it.

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
