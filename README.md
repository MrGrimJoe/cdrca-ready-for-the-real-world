# CDRCA Tooling

A package ecosystem and native-app tooling suite for
[CDRCA](https://github.com/ISLAH-org/CDRCA), Muhammad Ayyan's
JavaScript-based animation DSL. This repo is the tooling layer — the CLI,
package manager, Windows and Linux installers, and VS Code extension —
**not the CDRCA language itself.** The language's own source, transpiler,
and authoritative syntax docs live in
[Ayyan's upstream repo](https://github.com/ISLAH-org/CDRCA); this repo
never modifies that source, it only installs and runs a local copy of it.

## What is CDRCA?

CDRCA is a small DSL for describing animation scenes: you declare a
scene, bring in objects, and drive them with actions. A CDRCA source file
(`.cdrca`) scaffolded by this tooling looks like this:

```
!--- SCENE Main :: Bouncing balls demo ---
use ObjectAnimationSystem_INS.CORE_3d_PROPSsceneSYS.exampleProps.BouncingSphereProp() as ball1
add new action bounce1 2000 500
def ACTION bounce1 ball1 modifyMesh ""
!---END---
```

A few things you can see directly from that example and from the
language's own syntax grammar (`extension/syntaxes/cdrca.tmLanguage.json`):

- A scene is bounded by a `!--- ... ---` / `!---END---` marker pair.
- `use <path> as <name>` pulls in an object (here, a prop from CDRCA's
  built-in animation-system namespace) under a local alias.
- `add new action <name> <args...>` declares an action; `def ACTION
  <name> <target> <verb> <args>` defines what it actually does.
- CDRCA also has a plugin system with its own DSL syntax —
  `@requires`, `@syntaxPlugin` directives, and inline
  `plugin <name> scope <scope> trusted <bool> { ... }` blocks — for
  hooking into the transpiler pipeline. See
  [docs/PLUGIN-PERMISSIONS.md](./docs/PLUGIN-PERMISSIONS.md) for what a
  plugin is allowed to do and how the CLI surfaces that to you.
- This tooling also ships **Quark**, a built-in library of prebuilt UI
  components applied with a one-line directive —
  `@sidebar sidebar.closable.edgy = value` — instead of hand-coding the
  component. Every `cdrca create app` / `cdrca install cdrca` stages it
  into your project automatically. See [docs/QUARK.md](./docs/QUARK.md)
  — including an important current caveat about what's actually active
  yet.
- **`cdrca-reactive-state`** — a small ecosystem plugin (not built-in
  like Quark; `cdrca install cdrca-reactive-state` to add it to a
  project) that adds reactive state + DOM data-binding: `state count = 0`,
  `@countText bind.text = count`, `@increment click => count += 1`. See
  [docs/REACTIVE-STATE.md](./docs/REACTIVE-STATE.md), and
  [`plugins/cdrca-reactive-state/`](./plugins/cdrca-reactive-state) for
  the plugin's own source, tests, and a runnable todo-app example.
- **`@useLib <plugin>.<library>`** — how a `.cdrca` file opts into one
  specific optional bundle from a plugin (e.g. `@useLib
  quark.components`) instead of every plugin shipping everything it has
  onto every page. This isn't Quark-specific: a `type: "library"`
  package can extend *any* plugin's library surface — including a
  plugin it didn't ship with and whose author didn't have to do
  anything — via a `providesFor` manifest field. `cdrca create plugin
  <name> --library <libraryName>` scaffolds a plugin with a starter
  library bundle already wired up. See
  [docs/PLUGIN-LIBRARIES.md](./docs/PLUGIN-LIBRARIES.md) for the full
  mechanism, including why it has to resolve statically rather than at
  runtime.
- **Package types beyond apps and plugins.** `cdrca.json`'s `type` field
  is one of `app`, `plugin`, `library` (above), or `package` — a
  reusable `.cdrca` source library another project can `add import`.
  `cdrca install <a package>` stages its source into
  `cdrca_packages/<name>/` at your project root (mirroring how
  `node_modules/<name>/` works for npm). **Current caveat:** the files
  really do land there, but whether CDRCA's own `add import` statement
  resolves paths against that directory automatically isn't yet
  confirmed end-to-end — see
  [docs/ARCHITECTURE.md#community-plugins--libraries-staging-every-package-type-and-generalizing-beyond-quark](./docs/ARCHITECTURE.md#community-plugins--libraries-staging-every-package-type-and-generalizing-beyond-quark)
  for exactly what's verified and what isn't.

This repo's job is everything *around* that language: scaffolding
projects, installing packages/plugins written in it, running them, and
building them into distributable apps. For the language's full syntax
reference and runtime behavior, see the
[upstream CDRCA repo](https://github.com/ISLAH-org/CDRCA) — this repo
intentionally doesn't duplicate that documentation.

## What's in here

- **`cli/`** — the `cdrca` CLI: a fully custom, GitHub-backed package
  manager (search/install/publish/update packages, plugins, and apps),
  plus project scaffolding and a Tauri-based build pipeline that turns a
  CDRCA project into a distributable Windows `.exe`.
- **`extension/`** — a VS Code extension: syntax highlighting, a
  "Create New Project" command, and a run button. Bundled into the
  installer below rather than published to the Marketplace separately —
  **don't look for this on the VS Code Marketplace, it isn't there.**
- **`installer/`** — two separate installers, built by two separate CI
  jobs: a Windows installer (Inno Setup, `cdrca-installer.iss`) that
  bundles the CLI, a silent Rust toolchain install (so `cdrca build
  app` works immediately, zero extra setup), the CDRCA branding/icons,
  and optionally the VS Code extension; and a Linux installer
  (`installer/linux/install.sh`), a plain shell script + tarball that
  puts the CLI on `PATH` and optionally installs the same VS Code
  extension. See [Platform support](#platform-support) below for what
  differs between the two.
- **`docs/`** — architecture, manifest spec, CLI reference, plugin
  security model, licensing notes, and contributor notes. See
  [Documentation](#documentation) below.

## Platform support

**Windows and Linux**, both built and released by CI
(`.github/workflows/release.yml` runs `build-windows-installer` and
`build-linux-installer` as two independent jobs on every tagged
release). The CLI's own commands — `create`, `install`, `run`,
`publish`, `doctor` — work the same way on both. A few things genuinely
differ by platform, not as oversights but as real, documented scope
decisions:

- **`cdrca build app` (packaging a project into a distributable app via
  Tauri) is Windows-only.** This is the one deliberately Windows-only
  piece of functionality, not a build limitation — see
  [docs/ARCHITECTURE.md#building-on-linux-and-what-actually-ships-there](./docs/ARCHITECTURE.md#building-on-linux-and-what-actually-ships-there).
- **`cdrca login`'s token storage differs.** On Windows it's the real
  Windows Credential Manager (`cli/src/auth.rs`). On Linux — including
  the actual shipped release binary, not just local dev builds — it
  falls back to a plaintext file under your XDG config dir, since that
  fallback is compiled in for any non-Windows target. This only affects
  `cdrca login`/`cdrca publish`; every other command needs no token.
- **PATH setup differs by installer**, matching each platform's
  convention: the Windows installer writes the Windows-specific
  `HKCU\Environment` registry key; the Linux installer
  (`installer/linux/install.sh`) appends an `export PATH=...` line to
  your shell rc file (`.bashrc`/`.zshrc`/`.profile`) instead.
- **The Windows installer bundles a silent Rust toolchain install**
  (so `cdrca build app` works immediately with zero setup); the Linux
  installer doesn't, since there's nothing on Linux that currently
  needs a local Rust toolchain to work right away.

See [docs/CONTRIBUTING.md#building-locally](./docs/CONTRIBUTING.md#building-locally)
for building either installer from source, including on a platform
other than the one you're targeting.

## Install

**Option A — download an installer** (recommended): grab the latest
release for your platform from this repo's
[Releases](../../releases) page.

- **Windows:** `cdrca-installer.exe` — installs the `cdrca` CLI to
  PATH, silently sets up a Rust toolchain, registers CDRCA's own icon
  for `.cdrca` files in Explorer, and — if VS Code is detected on your
  machine — offers to install the VS Code extension too (you can still
  opt in manually later if VS Code isn't installed yet).
- **Linux:** `cdrca-installer-linux.tar.gz` — extract it and run
  `./install.sh`. Puts `cdrca` on PATH (`~/.local/bin` by default,
  adding it to your shell rc file if it isn't there already) and, if
  `code` is on PATH, offers to install the VS Code extension the same
  way. See [Platform support](#platform-support) above for what's
  different from the Windows installer.

**Option B — install via npm:** `npm install -g cdrca12` works on both
platforms — it downloads the same prebuilt binary from the same
release. See [npm/README.md](./npm/README.md).

**Option C — build from source:** see
[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md#building-locally).

## Quick start

```
cdrca create app my-first-project
cd my-first-project
cdrca run              # launches it directly
cdrca build app         # packages it into a distributable .exe
```

Or from VS Code: `Ctrl+Shift+P` → **CDRCA: Create New Project** (folder
picker, then a name prompt — this path is independent of the terminal
one above), then use the ▶ run button in the editor toolbar on any
`.cdrca` file.

## CLI commands, at a glance

Full details, flags, and examples for every command are in
[docs/CLI-COMMANDS.md](./docs/CLI-COMMANDS.md) — this is just a map so
you know what exists.

| Command | What it does |
|---|---|
| `cdrca login` / `cdrca logout` | GitHub OAuth login to the registry; clears the stored token. |
| `cdrca search <query>` | Searches the registry for packages/plugins/apps. |
| `cdrca info <package>` | Shows manifest details for a registry package. |
| `cdrca install <package>[@version]` | Installs a package, plugin, or library from the registry (or `cdrca` itself via npm — see [Install](#install) above). |
| `cdrca update [package]` | Updates one package, or everything in the lockfile. |
| `cdrca remove <package>` | Removes a package from the local store and lockfile. |
| `cdrca list` | Lists everything installed in the local package store. |
| `cdrca outdated` | Compares your lockfile against the registry's latest versions. |
| `cdrca publish` | Validates and publishes the current project's package to the registry. |
| `cdrca create app <name>` | Scaffolds a new CDRCA app project, end to end. |
| `cdrca create plugin <name> [--library <libraryName>]` | Scaffolds a new transpiler plugin package, optionally with a starter [`@useLib`](./docs/PLUGIN-LIBRARIES.md) bundle. |
| `cdrca run` | Runs the current project's CDRCA server directly. |
| `cdrca build app` | Packages the current project into a distributable Windows `.exe`. |
| `cdrca doctor` | Diagnoses your local toolchain, login, registry, and store setup. |

## VS Code extension, at a glance

Full details in [extension/README.md](./extension/README.md).

- **Syntax highlighting** for `.cdrca` files.
- **`CDRCA: Create New Project`** command (Command Palette) — folder
  picker, name prompt, scaffolds via the CLI, opens the result.
- **Run button** (▶) in the editor toolbar for any open `.cdrca` file —
  runs the project, health-checks the port, opens a live preview panel
  beside your editor. A stop button (■) tears it down.
- Requires the `cdrca` CLI already on PATH, and only activates inside an
  actual CDRCA project or when a `.cdrca` file is open.
- Optional **CDRCA Icons** file icon theme for branded `.cdrca` icons in
  the Explorer — opt-in via *Preferences: File Icon Theme*, since it
  replaces rather than layers onto your existing icon theme.
- Not on the VS Code Marketplace — install it via the main installer, or
  package it yourself from `extension/` (see its README).

## What to expect (project status)

This is a working but early-stage tooling project, with a few things
worth knowing before you dig in:

- **The registry OAuth contract is unconfirmed.** `cdrca login`'s exact
  callback param names/shape are documented as an assumption pending
  sign-off from whoever maintains the registry site — see
  `cli/OAUTH-CONTRACT-TODO.md`.
- **No server-ready signal from CDRCA itself yet.** `cdrca run`'s
  Tauri build config and the VS Code run button both currently poll the
  port until it accepts a connection, rather than waiting for a real
  "ready" event — see
  [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#the-remaining-open-gap-server-ready-signaling).
- **`.cdrca` files get a real icon in Explorer, and now an optional
  branded one in VS Code too**, via the extension's opt-in **CDRCA
  Icons** file icon theme — see
  [extension/README.md#file-icons](./extension/README.md#file-icons)
  for why it's a separate theme you switch to rather than something
  blended into your existing one.
- **The manifest-level plugin permission model (`uses`) and CDRCA's
  in-DSL plugin syntax haven't been fully reconciled** — see
  [docs/PLUGIN-PERMISSIONS.md](./docs/PLUGIN-PERMISSIONS.md).
- **Quark (the built-in UI component directive layer) works out of the
  box** — `cdrca create app` / `cdrca install cdrca` automatically falls
  back to this CLI's own bundled, fixed copy of CDRCA whenever the
  published npm package is missing the plugin-hook system Quark depends
  on (verified directly: the published package doesn't have it yet).
  See [docs/QUARK.md](./docs/QUARK.md) and
  [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#bundled-cdrca-runtime-fallback)
  for the full story, including one real bug this bundled copy also
  fixes in CDRCA itself (not just Quark).

None of these block normal use of `cdrca create app` / `run` / `build
app` day to day — they're the honest list of what's still settling. Run
`cdrca doctor` any time to check your own setup against the things that
can actually go wrong locally (toolchain, login, registry reachability,
local store health).

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how the CLI, registry
  API, local package store, and installer fit together; the GitHub-backed
  install model; the local port-patching mechanism and why it exists.
- [docs/MANIFEST-SPEC.md](./docs/MANIFEST-SPEC.md) — the full
  `cdrca.json` contract, every field explained.
- [docs/CLI-COMMANDS.md](./docs/CLI-COMMANDS.md) — every `cdrca`
  subcommand, with examples.
- [docs/PLUGIN-PERMISSIONS.md](./docs/PLUGIN-PERMISSIONS.md) — the
  permissions/`uses` model for plugin-type packages.
- [docs/QUARK.md](./docs/QUARK.md) — the built-in `@directive` UI component layer:
  syntax, presets/modifiers, how it's wired in, and its current
  not-active-yet status.
- [docs/PLUGIN-LIBRARIES.md](./docs/PLUGIN-LIBRARIES.md) — the
  `@useLib` directive: how a `.cdrca` file opts into a plugin's optional
  library bundles, and how a `type: "library"` package can extend a
  plugin it wasn't published with.
- [docs/REACTIVE-STATE.md](./docs/REACTIVE-STATE.md) — the
  `cdrca-reactive-state` plugin's syntax and internals, plus the real
  bugs in CDRCA's own transpiler this repo found (and patched around)
  while building it.
- [docs/LICENSING.md](./docs/LICENSING.md) — this repo's license status,
  and a note on IOSLF, a broader license framework separately published
  by CDRCA's creator.
- [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) — building from source,
  repo layout, open items.
- [extension/README.md](./extension/README.md) — what the VS Code
  extension does and its requirements.

## License

Licensed under the **MrMIB License v1.0** — see
[LICENSE.md](./LICENSE.md) for the full text. Short version: free to use
and run, including commercially, with credit to MrMIB; no forking or
derivative works without explicit permission; the software itself can't
be resold or repackaged. This covers the tooling in this repo only — the
CDRCA language itself is licensed separately, on its own terms, in
[Ayyan's upstream repo](https://github.com/ISLAH-org/CDRCA). See also
[docs/LICENSING.md](./docs/LICENSING.md) for that distinction and a note
on IOSLF, a broader license framework separately published by CDRCA's
creator.
