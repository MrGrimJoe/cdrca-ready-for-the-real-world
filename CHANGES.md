## 0.2.8 — plugin core-library auto-include, reactive-state expression-compiler fixes

- A plugin's declared `core` library (e.g. `ember-core.js`) is now auto-included and ordered
  first even when only a different library is explicitly `load`ed — previously `load
  ember.presets` alone staged `ember-presets.js` by itself, which refuses to run without
  `ember-core.js` already loaded. Caught by actually running a page, not by compiling source.
- cdrca-reactive-state's expression compiler: `R` (the runtime alias itself) and reserved-word
  operators (`new`, `typeof`, `instanceof`, `in`, `void`, `delete`) no longer get mis-rewritten as
  state reads; multi-character operators (`===`, `&&`, `=>`, etc.) are now tokenized as single
  units instead of being split with a space injected mid-operator; `bind.list` gained an optional
  `.property` suffix (`bind.list = users.data`).
- New test coverage: `quark/tests/` (11 tests), more of grammar's `animations-v2.test.js`, and
  `tools/docs-reactive-state-check.js` (verifies every example in `docs/REACTIVE-STATE.md` actually
  runs — wired into `verify-all.sh`).

# What's in this zip

This zip contains three finished, verified phases of the syntax-and-project work described in
`docs/design/LANGUAGE-PLAN.md`. Read that file first — it has the full plan, what's done, what
isn't, and the decisions already made. This file is the practical merge/handoff summary.

A separate line of work (`cdrca build web`, `build app --target exe|pwa`) is being done in another
session. Nothing here touches `build.rs`. `create.rs`, `run.rs` and `main.rs` are touched, but only
to add new module registrations and a page-ownership check — see below for exactly what.

**Before doing anything else: run `./tools/verify-all.sh`.** One command, 12 steps (Rust, vocabulary
drift, grammar, animations back- and front-end, the runtime, background end to end, the project
server, reactive-state, the legacy corpus, the v2 guide examples). Prerequisites are listed at the
top of the script. Without `jsdom` the DOM-based test files print `SKIPPED` and the script says so
in each step's line — that's a weaker check, not a failure.

## README — this is not the ISLAH-org CDRCA

The README now opens by saying this is a different language and toolchain from Muhammad Ayyan's
ISLAH-org CDRCA, that it only relies on a version of the original compiler and parser, and that
Ayyan is credited for that starting point. The pointer to the upstream repo for syntax docs is
replaced with this repo's own. **Still to review:** `LICENSE.md`, `docs/LICENSING.md` and the license
paragraph near the end of the README still say the language is licensed separately by Ayyan
upstream; those are your call, so they are untouched.

## Installers — one workflow, one artifact, the logo everywhere

**One workflow builds every installer.** New `.github/workflows/installers.yml` (runs on a `v*` tag
or manually) calls `release.yml` (Windows) and `linux-installer.yml` (Linux) and gathers the results
into a single artifact, `cdrca-installers-all`: `cdrca-installer.exe`, `cdrca-win32-x64.exe`, the
`.deb`, the `.rpm`, `cdrca-installer-linux.tar.gz`, `cdrca-linux-x64`, and one `SHA256SUMS` covering
all of them. It fails if any of them is missing. On a tag the same set is attached to the release.
`release.yml` and `linux-installer.yml` no longer publish anything themselves and no longer trigger
on tag pushes (that would have attached everything twice); they still run on manual dispatch, and
the Linux one still runs on pull requests. `release.yml` also always uploads `cdrca-win32-x64.exe`
now (it was tag-only) and checks the tag against the `cli/Cargo.toml` version, as the Linux
workflow already did.

**The Windows installer said 0.1.0.** `cdrca-installer.iss` hard-coded it while the CLI is 0.2.6.
The workflow now passes the real version (`/DMyAppVersion`), and the installer's file properties
carry it (`VersionInfoVersion`).

**The logo, inside and on the installers.**
- Windows: unchanged, it already had the logo as the installer's own icon, the wizard banners, the
  Start Menu shortcut, and the `.cdrca` file icon.
- Linux (new): the `.deb`, `.rpm` and tarball now install the logo too — a launcher icon, a "CDRCA"
  applications-menu entry, and an icon for `.cdrca` files (MIME type `text/x-cdrca`). New files under
  `installer/linux/`: `icons/` (48/64/128/256 px, cut from the one real logo by `make-icons.py`),
  `cdrca.desktop`, `cdrca-mime.xml`, `postremove.sh`. `postinstall.sh` refreshes the desktop caches
  and never fails an install. The tarball's `install.sh` does the same per user under
  `~/.local/share`. The CI smoke tests check the icons, launcher and file type after install and
  that they are gone after removal.
- The VS Code extension (bundled in every installer) now has the logo as its icon
  (`extension/icons/cdrca-logo.png`, `"icon"` in `extension/package.json`).

Verified here: the CLI built, `nfpm` built the `.deb` and `.rpm`, the `.deb` installed, put the icons,
launcher and file type in place, passed `desktop-file-validate`, and removed cleanly; `install.sh` ran
in a throwaway home; a real `.vsix` packaged with the icon; all four workflows pass `actionlint`.
**Not run here:** the Inno Setup compile and the Windows job (no Windows), and the `.rpm` install
(no `rpm`/`dnf`) — the first tag run is their first real test. The license shown in the `.deb`/`.rpm`
metadata (`IOSL`, in `nfpm.yaml` and `cli/Cargo.toml`) still disagrees with `LICENSE.md` (MrMIB
License v1.0); left as is, since the CLI's own manifest check expects `IOSL`.

## Fix — ember, campfire and reactive-state browser scripts are now bundled

`cdrca_bundle.rs` only wrote each of these plugins' `plugin.js`, so their statements compiled but
`Ember`, `Campfire` and `CDRCA.reactive` never existed on a served page. `BUNDLED_FILES` now also
carries each plugin's `cdrca.json` and library files under `Plugins/<name>/`, which is where
`plugin_frontend_patch.rs` already looks when it resolves `load <plugin>.<library>`.
`cdrca-reactive-state` gained a `core` library (`runtime.js`) so it loads before `store`/`query`.
Use `load ember.core`, `load campfire.core`, `load cdrca-reactive-state.core`. New test:
`every_declared_library_is_bundled`. Not compiled here (no Rust toolchain): run `cargo test` or CI.

## 0.2.6 — npm package carries all docs; version bump

`cli/Cargo.toml`, `cli/Cargo.lock` and `npm/package.json` are now 0.2.6 (the npm postinstall
downloads the release binary for its own exact version, so tag the release `v0.2.6`).
`npm/docs/` now contains every guide, reference doc, plugin README and example (26 files),
and `cdrca12 docs` reads them from disk instead of fetching from GitHub (`--online` still does).
Run `node tools/sync-npm-docs.js` before `npm publish`; `--check` fails if it has drifted.

## Phase 1 — the v2 statement grammar

A built-in plugin (`Plugins/grammar/`) rewrites a cleaner syntax into the existing statements
before parsing, so nothing downstream has to change:

```txt
require quark
load quark.components
@mainNav  navbar glass sticky full-width
@startBtn button primary pill accent=#10b981
js { window.ready = true; }
```

Available now: `require`, `load`, `import`, `js { }`, and flag-and-option element rules for all 27
Quark components. Reactive-state, ember, campfire and the rest of animations keep their existing
syntax until later phases. Full details, the exact rewrite rules, every error message, and how it's
verified: `docs/guides/V2-SYNTAX.md` and `docs/design/LANGUAGE-PLAN.md` section 11b.

## Phase 2 — a project owns its page

`cdrca create app` now scaffolds a real page (`public/index.html`) alongside the `.cdrca` source,
and `cdrca run` serves it: your HTML, CDRCA's runtime scripts added automatically, and your
`.cdrca` files compiled on request so a browser refresh always shows your latest edit. Full guide:
`docs/guides/PROJECT-LAYOUT.md`.

- **`cdrca.json` gains two optional, project-local fields** — `html` (one page) and `pages`
  (several, each with its own optional program). Neither is part of the registry contract; a test
  (`project_layout.rs`) pins that `cdrca publish` never sends them.
- **A project without either field is untouched** — `cdrca run` starts the exact same preview
  server it always has.
- **`background … from "file.cdrca"`** (phase 1's interim animations verb) now works end to end:
  the other file is served as a compiled ES module at `/__cdrca/bg/<path>.js`.
- **`import "…"` is now web-style**: relative to the file that says `import`, not the project root.
  It compiles to `@AddImport` rather than legacy `@IMPORT`, because a header-position `@IMPORT`
  silently drops anything past the first hop of a chain — `@AddImport` doesn't. Legacy `@IMPORT` is
  unchanged.

## Phase 3 — reactive-state statements

Turned out much smaller than planned: `state`, `computed`, `watch`, `bind` and events **already
used exactly the syntax the plan proposed** (`state x = 0`, `@id bind.text = x`,
`@id click => x += 1`), so there was nothing to add for them. The real gap was three primitives
that exist today only as JS calls:

```txt
store  cart persist=local ttl=1h = []
source main = firebase({ apiKey: "…" })
query  users from=main cache=60s depends=[searchText] = fetch("/api/users").then(r => r.json())
```

- **These compile to a side-effecting `JS { }` block, not `state name = ...`.** `R.store()` and
  `R.query()` call `R.define()` internally, so wrapping them in a `state` declaration would
  double-define the cell (a real bug caught before shipping — see `LANGUAGE-PLAN.md` section 11d
  for the two other bugs found the same way: an emitted-lowercase-`js` typo, and a fetcher
  expression that needed wrapping in a thunk).
- **`store`/`query`/`source` do NOT rewrite bare identifiers to `R.val(...)`** the way `computed`/
  `bind` expressions do — that machinery is private to reactive-state's own plugin and operates on
  already-tokenized input the grammar plugin never sees. Reach a cell explicitly with `R.get(...)`,
  matching `docs/REACTIVE-STATE.md`'s own documented convention. Called out explicitly in
  `docs/guides/V2-SYNTAX.md` so it isn't a surprise.
- Durations (`ttl=`, `cache=`) accept a bare number of ms or a suffixed unit (`1h`, `60s`, `500ms`),
  producing identical output either way.

## Files changed or added, by area

**New Rust modules** (registered in `main.rs`): `project_layout.rs` (reads/validates `html`/
`pages`), `project_server.rs` (installs the server), plus `Plugins/grammar/plugin.js` (JS, bundled
via `cdrca_bundle.rs`).

**Touched:**

| File | Change |
|---|---|
| `cli/src/cdrca_bundle.rs` | +1 bundled file (`grammar/plugin.js`) beyond phase 1's `animations/plugin.js`; +4 completeness tests (a registered-but-unbundled plugin, a page `<script>` tag by exact case, or a relative `require` now fails the build) |
| `cli/src/commands/create.rs` | scaffolds `public/index.html` from `templates/starter.html` and adds `html` to `cdrca.json` |
| `cli/src/commands/run.rs` | starts the project server when `ProjectLayout::owns_page()`; otherwise unchanged |
| `cli/src/quark_libscan.rs` | also recognises `load <plugin>.<lib>` (the v2 spelling of `@useLib`) |
| `cli/src/quark_patch.rs` | +1 test: the two on-disk copies of every Quark file must be byte-identical (a real drift was caught and fixed by this) |
| `cli/src/fulltranspiler_patch.rs` | recognises the bundled runtime's dedicated JS_BLOCK emission slot |
| `templates/cdrca-runtime/Back-end/Transpiler/FullTranspiler.js` | `@IMPORT`/`@AddImport` circular-JSON crash fixed; JS blocks no longer emitted twice; `currentFile` threaded through so a plugin's `before parse` hook knows which project file it's looking at |
| `templates/cdrca-runtime/Back-end/Transpiler/index.js` | resolves and passes `currentFile` |
| `templates/cdrca-runtime/Back-end/Transpiler/Plugins/plugins.json` | `grammar` registered first |
| `templates/cdrca-runtime/Back-end/Transpiler/Plugins/quark/plugin.js` **and** `templates/plugins/quark/plugin.js` | hyphenated modifiers (`full-width`) now parse — **both copies must always change together** |
| `templates/cdrca-runtime/Back-end/Transpiler/Plugins/animations/plugin.js` | new `background [<id>] [from "<file>.cdrca"]` grammar |
| `templates/cdrca-runtime/Back-end/Transpiler/Plugins/grammar/plugin.js` | +`store`/`source`/`query` directives (phase 3) |
| `templates/cdrca-runtime/Front-end/Renderer.js` | can draw into a placed canvas; default (no `background`) path untouched |
| `templates/cdrca-runtime/Front-end/Transpiler-Plugins/animations/animations-backdrop.js` | rewritten: page/element placement, resize watching, module loading |
| `templates/cdrca-runtime/Front-end/index.html` | `parser.js` → `Parser.js` (case-sensitive, broke on non-Windows) |
| `plugins/cdrca-reactive-state/tests/integration.test.js` | now works on a throwaway copy instead of rewriting whatever tree `CDRCA_RUNTIME_PATH` points at |

**New:** `templates/cdrca-runtime/project-server.js` (the server itself — plain Node, no
dependencies), `templates/starter.html`, `Plugins/grammar/` (plugin + tests),
`tests/background.e2e.test.js`, `tests/project-server.test.js`,
`Front-end/.../animations/tests/place.test.js`, `docs/guides/V2-SYNTAX.md`,
`docs/guides/PROJECT-LAYOUT.md`, `docs/design/LANGUAGE-PLAN.md`, `tools/` (vocabulary generator,
corpus diff, docs-example check, `verify-all.sh`).

**Docs edited:** `ANIMATIONS-SYNTAX.md` (`background` section — it described a form that no longer
exists and said there was no whole-page mode; now says all four forms work), `QUARK-SYNTAX.md` (a
note pointing at the new spelling), `MANIFEST-SPEC.md` (the two new local-only fields),
`CLI-COMMANDS.md` (`cdrca run`'s two server paths), `guides/README.md` (index).

## Things the next phase (or the `build web` line of work) should know

1. **`@IMPORT`/`@AddImport` both work now.** Before this, 7 of 9 header-position import variants
   crashed with `Converting circular structure to JSON`. If `build web`'s file collector walks
   imports itself, this no longer needs working around.
2. **`load quark.components` is a library reference, exactly like `@useLib`.** The Rust scanner
   (`quark_libscan.rs`) handles both; anything reusing it is covered automatically.
3. **A production/static build needs the same runtime scripts a served page gets** —
   `project_server.js`'s `runtimeScripts()` derives that list from the preview page in one place;
   worth reusing rather than re-deriving for `build web`'s output.
4. **`background … from "x.cdrca"` needs a compiled module at `__cdrca/bg/<path>.js`.** For a
   static build, the natural mapping is `dist/__cdrca/bg/<path>.js`; the URL itself is built by one
   function, `Backdrop.programUrl`, in `animations-backdrop.js`.
5. **Compile order:** the grammar plugin rewrites v2 syntax to legacy syntax before parsing, so
   anything that calls `transpile()` gets it for free. Anything that reads `.cdrca` text another
   way (a linter, a separate scanner) sees v2 statements unrewritten.

## Found and fixed on the way (each pinned by a test)

- A **documented** legacy form, `input.bordered.full-width`, was a parse error.
- Quark's files exist in **two places** in this CLI and a fix had only reached one; a new test now
  fails whenever they drift.
- The uploaded zip did not compile from a clean checkout — `cdrca_bundle.rs` embeds
  `templates/cdrca-runtime/package-lock.json`, which the zip didn't contain. Restored from an
  earlier zip's copy (the runtime's `package.json` is identical between the two, so it still
  matches). Worth checking that file is actually committed and that CI builds from a clean
  checkout — a missing embedded file is exactly the kind of thing that guard should catch.
- My own line-number bookkeeping in the grammar plugin double-counted newlines inside a multi-line
  `js { }` block; caught by a test before it shipped.
- Phase 3: `store`/`query` wrapped in `state name = ...` would have double-defined the reactive
  cell and discarded `query`'s Promise; the emitted `js {}` block was lowercase and failed to
  compile; a bare `query = fetch(...)` passed an already-resolved Promise where a callable fetcher
  was required, so the fetch silently never ran. All three caught by executing compiled output
  against the real runtime, not by reading source or checking compiled text — see
  `LANGUAGE-PLAN.md` section 11d.

## Not done yet / known limits

- `BGcolor` and `gredientMap` don't currently change compiled output — true of the original
  transpiler too, not something this round introduced. Filed in the docs, not fixed.
- ember, campfire, and the rest of animations (`object`, `action`, `scene.*`) have no v2 forms
  yet — phases 4–5 of the plan. (Reactive-state is done as of phase 3 — see above.)
- No `cdrca migrate` yet.
- A scaffolded project's page loads `quark-components.js` twice (the template's unconditional tags
  plus the CLI's staged block) — true before this work too; not confirmed to cause a problem.
