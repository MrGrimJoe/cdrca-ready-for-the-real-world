# cdrca.json — Manifest Specification

Every CDRCA package/plugin/app has a `cdrca.json` manifest at its root.
This is a **fixed contract** shared with the CDRCA registry website — the
shape below must not be changed without coordinating with whoever
maintains that site, since it parses this exact structure.

## Full shape

```json
{
  "name": "calculastic",
  "version": "1.4.2",
  "description": "Advanced calculus animation library",
  "type": "package",
  "entry": "src/main.cdrca",
  "icon": "icon.png",
  "author": "muhammad-ayyan",
  "license": "IOSL",
  "repository": "https://github.com/user/calculastic",
  "dependencies": { "mathcore": "^3.1.0" },
  "permissions": [],
  "uses": []
}
```

A `type: "plugin"` manifest with its own bundled library, and an
independent `type: "library"` package extending it:

```json
{
  "name": "mathcore",
  "type": "plugin",
  "entry": "plugin.js",
  "permissions": [],
  "uses": [["syntax", "customRule"]],
  "libraries": { "icons": "dist/mathcore-icons.js" }
}
```

```json
{
  "name": "mathcore-charts",
  "type": "library",
  "entry": "dist/mathcore-charts.js",
  "providesFor": { "plugin": "mathcore", "library": "charts" }
}
```

`mathcore-charts` needed no involvement from `mathcore`'s author to
publish — see [PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md).

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Package identifier. Must be non-empty. Used as the registry lookup key (`GET /api/packages/:name`) and the local store directory name. |
| `version` | string | yes | Must be valid [semver](https://semver.org). Validated on `cdrca publish` before it's ever sent to the registry. |
| `description` | string | yes | Free text, shown in `cdrca search` / `cdrca info` output. |
| `type` | `"package"` \| `"plugin"` \| `"app"` \| `"library"` | yes | See [Package types](#package-types) below. |
| `entry` | string | yes | Path (relative to the manifest) to the main `.cdrca` source file — or, for `type: "library"`, the built JS bundle file (not `.cdrca` source). Must exist on disk — the CLI checks this before `publish`, `run`, and `build app`. |
| `icon` | string | yes | Path (relative to the manifest) to a PNG icon. If missing at build time, `cdrca build app` silently falls back to the bundled default CDRCA logo rather than shipping a blank icon — see [ARCHITECTURE.md](./ARCHITECTURE.md). |
| `author` | string | yes | Free text. Defaults to the current OS username when scaffolded via `cdrca create app`. |
| `license` | string | yes | Expected to be `"IOSL"` (CDRCA's own Islamic Open Source License) for ecosystem packages. The CLI does not hard-fail on other values — it prints a warning — since a package could conceivably use a different license, but `"IOSL"` is the assumed default everywhere else in the tooling. **Never assume MIT.** This field is deliberately free text rather than an enum, so it can also represent a package licensed under a more elaborate framework (e.g. [IOSLF](./LICENSING.md)) accurately, if a package author adopts one — see [docs/LICENSING.md](./LICENSING.md). |
| `repository` | string | yes | URL, typically a GitHub repo. Empty string is valid (e.g. for local-only projects not yet pushed anywhere). |
| `dependencies` | object (string → string) | no, defaults to `{}` | Maps dependency package name to a version constraint (`^1.2.3`, `>=2.0.0`, or an exact pin like `1.4.2`). Resolved via the CLI's semver-based resolver — see ARCHITECTURE.md. |
| `permissions` | array of strings | no, defaults to `[]` | **Security-relevant. Only meaningful for `type: "plugin"`.** See [PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md) for the full model. |
| `uses` | array of `[hookType, hookProcess]` pairs | no, defaults to `[]` | **Security-relevant. Only meaningful for `type: "plugin"`.** See [PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md). |
| `libraries` | object (string → string) | no, defaults to `{}` | **Only meaningful for `type: "plugin"`.** Bundles the plugin ships itself, mapped `<libraryName> -> <path relative to this manifest>`, e.g. `{ "icons": "dist/my-plugin-icons.js" }`. A `.cdrca` file's `@useLib <thisPlugin>.<libraryName>` resolves against this map first — see [PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md). Ignored (with a warning) on any other `type`. |
| `providesFor` | object `{ "plugin": string, "library": string }` | **required when `type` is `"library"`**, otherwise absent | Which plugin + library-bundle-name slot this package fills — the counterpart to a `.cdrca` file's `@useLib <plugin>.<library>`. `plugin` may name a real published `type: "plugin"` package, or one of this CLI's own built-ins (`"quark"` or `"animations"` — see `manifest::BUILTIN_PLUGIN_NAMES`). See [PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md). Ignored (with a warning) on any other `type`. |

## Package types

- **`"package"`** — a reusable `.cdrca` source library other projects depend on (like `calculastic` in the example above). No special permissions model applies. `cdrca install <package>` stages its source into `cdrca_packages/<name>/` in the consuming project (`package_stage.rs`) — **note:** whether CDRCA's actual `add import` mechanism can find it there from a real transpile isn't yet confirmed end-to-end; see that module's doc comment and [REACTIVE-STATE.md](./REACTIVE-STATE.md) for the same "verified vs. not yet confirmed" distinction applied elsewhere in this repo.
- **`"plugin"`** — a JS module hooking into CDRCA's transpiler pipeline. `permissions` and `uses` control what it's allowed to do — see PLUGIN-PERMISSIONS.md. The CLI shows these to the user and requires explicit `y/N` confirmation before installing any plugin, the same way a mobile OS prompts for app permissions. May also declare `libraries` — see above.
- **`"app"`** — a runnable/shippable project, the kind `cdrca create app` scaffolds and `cdrca build app` packages into a distributable Windows `.exe` via Tauri.
- **`"library"`** — a bundle that extends *someone else's* (or its own author's) plugin, published as an independent package, with zero coordination needed from that plugin's author. Requires `providesFor` — see above and [PLUGIN-LIBRARIES.md](./PLUGIN-LIBRARIES.md). `cdrca install <library>` stages it via `library_stage.rs` into a project-local `libraries.json` index (the counterpart to `plugins.json`), not next to the plugin it targets.

## Validation rules the CLI enforces

Run automatically before `cdrca publish`, and partially before `cdrca run` / `cdrca build app`:

- `name` must be non-empty.
- `version` must parse as valid semver.
- `entry` must be non-empty **and** the file it points to must actually exist relative to the project root.
- If `type` is `"plugin"` and `permissions` is non-empty but `uses` is empty, the CLI prints a warning: the plugin will be seized by CDRCA's runtime on its very first hook-registration attempt, since it declared no allowed hooks.
- If `type` is `"library"`, `providesFor` must be present with non-empty `plugin` and `library` strings. Whether `providesFor.plugin` names a REAL published plugin (vs. a typo) can only be confirmed against the registry — this manifest-level check is deliberately offline/fast-fail only (see `Manifest::validate()`'s own doc comment); the registry website's publish-time validation is what actually confirms it.
- If `libraries` is non-empty but `type` isn't `"plugin"`, or `providesFor` is present but `type` isn't `"library"`, the CLI warns (not an error) that the field will be ignored.

## What's *not* in this file

Two pieces of state are deliberately kept **out** of `cdrca.json`, since it's a fixed cross-team contract and shouldn't grow implementation-detail fields:

- **`cdrca-lock.json`** — the resolved dependency lockfile (exact versions, checksums, resolved download URLs). See ARCHITECTURE.md.
- **`.cdrca-state.json`** — local per-project state, currently just the port baked into this project's patched CDRCA runtime copy. Gitignored by default (see `cdrca create app`'s generated `.gitignore`) since it's machine/instance-specific and shouldn't leak into a repo or a published package tarball.
