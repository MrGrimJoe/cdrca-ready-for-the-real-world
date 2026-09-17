# The `cdrca` CLI — a walkthrough

This is the "learn it by doing" version of the CLI. For the full flag-by-flag
reference of every command, see [CLI-COMMANDS.md](../CLI-COMMANDS.md) — this
page instead walks through the paths you'll actually use, in the order
you'll actually use them, and explains *why* a step exists, not just what
flag triggers it.

If you haven't installed `cdrca` yet, see the main [README](../../README.md#install)
— installer, npm, or from source.

## 1. Your first project

```
cdrca create app my-first-project
cd my-first-project
cdrca run
```

`cdrca create app <name>` does more than make a folder. In order:

1. Scaffolds `cdrca.json`, a `.gitignore`, a default icon, and a starter
   `.cdrca` scene file.
2. Actually runs `npm install cdrca` inside the new project — the CDRCA
   language runtime itself is a real npm package, and your project gets its
   own local copy, not a shared global one.
3. Patches that local copy so this project has a stable local port.
4. Stages Quark (the built-in `@directive` UI layer — see
   [QUARK-SYNTAX.md](./QUARK-SYNTAX.md)) and the animations plugin (the
   scene/prop/action grammar — see [ANIMATIONS-SYNTAX.md](./ANIMATIONS-SYNTAX.md))
   into the project automatically. You don't install either by hand.

`cdrca run` then launches that project's server directly and prints the
port it picked. Leave it running and edit the `.cdrca` file in your editor
— re-run `cdrca run` after changes (there's no file-watcher yet).

**In VS Code instead:** `Ctrl+Shift+P` → **CDRCA: Create New Project**
does the same scaffolding with a folder picker, then the ▶ run button in
the editor toolbar does what `cdrca run` does, plus a live preview panel.

## 2. Adding packages, plugins, and libraries

Three different `type`s exist, and `cdrca install` treats each differently
— see [MANIFEST-SPEC.md](../MANIFEST-SPEC.md#package-types) for the formal
definitions. The short version, from the install side:

```
cdrca install <name>              # latest version
cdrca install <name>@<version>    # pinned version
```

- **A package** (`type: "package"`) is `.cdrca` source you `add import` in
  your own file. Installing it drops its source into
  `cdrca_packages/<name>/`.
- **A plugin** (`type: "plugin"`) hooks into the transpiler — new statement
  syntax, mostly. Before it installs anything, the CLI shows you exactly
  what it's asking for and makes you confirm:

  ```
  'mathcore@3.1.0' is a PLUGIN. It requests:

  Permissions:
    - FileRead: Sandboxed file read access

  Allowed transpiler hooks (uses):
    - syntax.customRule :: myTokenizerHook

  Install this plugin with the permissions above? [y/N]
  ```

  This isn't a formality — read it. See
  [PLUGIN-PERMISSIONS.md](../PLUGIN-PERMISSIONS.md) for what each
  permission actually grants, especially the `[ELEVATED]` ones.
- **A library** (`type: "library"`) extends a plugin's optional bundle
  surface (Quark's or animations' or a third-party plugin's) without that
  plugin's author needing to know it exists. See
  [PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md#publishing-a-library-for-someone-elses-plugin).

Every install also re-scans your project's `.cdrca` files for `@useLib`
lines and re-patches the page accordingly — so installing a library after
you've already written the `@useLib` line for it is the normal order, not
a problem.

Day to day, you'll mostly use:

```
cdrca search <query>       # find something in the registry
cdrca info <package>       # read its manifest before installing
cdrca update               # update everything in this project
cdrca update <package>     # update just one
cdrca remove <package>     # take it back out
cdrca list                 # what's installed, system-wide
cdrca outdated             # what's behind the registry's latest
```

## 3. Publishing your own package

```
cdrca login
cdrca publish
```

`cdrca login` opens a browser for GitHub OAuth and stores the resulting
token locally (Windows Credential Manager on Windows; a plaintext file
under your XDG config dir on Linux — see
[CLI-COMMANDS.md](../CLI-COMMANDS.md#cdrca-login) for why the two differ).
You only need this for `login`/`publish` — everything else works without
being logged in.

`cdrca publish` validates your `cdrca.json` first (valid semver, `entry`
file actually exists, sane `type`-specific fields) and only then sends it
to the registry. If validation fails, fix what it prints and run it again
— nothing partial gets published.

**Making a plugin or library to publish:**

```
cdrca create plugin mathcore
cdrca create plugin mathcore --library icons
```

Scaffolds a starter `plugin.js` with the registration boilerplate already
correct, plus (with `--library`) a stub optional bundle. This doesn't
install anything or start a runtime — a plugin has no `cdrca run` of its
own. Test it against a real app project before publishing; see
[PLUGIN-DEVELOPMENT.md](./PLUGIN-DEVELOPMENT.md) for the full walkthrough,
from scaffold to a real `@useLib`-able library.

## 4. Building a distributable app

```
cdrca build app
```

Packages the current project into a Windows `.exe` via Tauri — generates
`tauri.conf.json` from your `cdrca.json` automatically (title, icon, port),
so you never hand-write Tauri config. Output lands under
`target/release/bundle/`.

**This one command is Windows-only**, deliberately — see the main
[README's Platform support section](../../README.md#platform-support) for
why. Everything else in this guide works identically on Linux.

## 5. When something's wrong

```
cdrca doctor
```

Run this first, before anything else, whenever a command misbehaves. It's
read-only — checks your CLI version, Rust toolchain, Tauri CLI, login
status, registry reachability, and local package-store health (including
leftover temp dirs from an interrupted install), and reports on your
current project's port/patch state if you run it inside one. It never
modifies anything, and every check is independent, so one failure never
hides the rest.

## Command index

| You want to... | Run |
|---|---|
| Start a brand-new project | `cdrca create app <name>` |
| Run the project you're in | `cdrca run` |
| Add something from the registry | `cdrca install <name>` |
| See what a package actually contains before installing | `cdrca info <name>` |
| Find something | `cdrca search <query>` |
| Update everything | `cdrca update` |
| Start a new plugin/library to publish | `cdrca create plugin <name> [--library <n>]` |
| Publish what you're standing in | `cdrca publish` (needs `cdrca login` first) |
| Package a Windows build | `cdrca build app` |
| Figure out why something's broken | `cdrca doctor` |

Full flags and edge cases for every one of these: [CLI-COMMANDS.md](../CLI-COMMANDS.md).
