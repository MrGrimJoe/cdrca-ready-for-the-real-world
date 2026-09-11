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

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Package identifier. Must be non-empty. Used as the registry lookup key (`GET /api/packages/:name`) and the local store directory name. |
| `version` | string | yes | Must be valid [semver](https://semver.org). Validated on `cdrca publish` before it's ever sent to the registry. |
| `description` | string | yes | Free text, shown in `cdrca search` / `cdrca info` output. |
| `type` | `"package"` \| `"plugin"` \| `"app"` | yes | See [Package types](#package-types) below. |
| `entry` | string | yes | Path (relative to the manifest) to the main `.cdrca` source file. Must exist on disk — the CLI checks this before `publish`, `run`, and `build app`. |
| `icon` | string | yes | Path (relative to the manifest) to a PNG icon. If missing at build time, `cdrca build app` silently falls back to the bundled default CDRCA logo rather than shipping a blank icon — see [ARCHITECTURE.md](./ARCHITECTURE.md). |
| `author` | string | yes | Free text. Defaults to the current OS username when scaffolded via `cdrca create app`. |
| `license` | string | yes | Expected to be `"IOSL"` (CDRCA's own Islamic Open Source License) for ecosystem packages. The CLI does not hard-fail on other values — it prints a warning — since a package could conceivably use a different license, but `"IOSL"` is the assumed default everywhere else in the tooling. **Never assume MIT.** This field is deliberately free text rather than an enum, so it can also represent a package licensed under a more elaborate framework (e.g. [IOSLF](./LICENSING.md)) accurately, if a package author adopts one — see [docs/LICENSING.md](./LICENSING.md). |
| `repository` | string | yes | URL, typically a GitHub repo. Empty string is valid (e.g. for local-only projects not yet pushed anywhere). |
| `dependencies` | object (string → string) | no, defaults to `{}` | Maps dependency package name to a version constraint (`^1.2.3`, `>=2.0.0`, or an exact pin like `1.4.2`). Resolved via the CLI's semver-based resolver — see ARCHITECTURE.md. |
| `permissions` | array of strings | no, defaults to `[]` | **Security-relevant. Only meaningful for `type: "plugin"`.** See [PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md) for the full model. |
| `uses` | array of `[hookType, hookProcess]` pairs | no, defaults to `[]` | **Security-relevant. Only meaningful for `type: "plugin"`.** See [PLUGIN-PERMISSIONS.md](./PLUGIN-PERMISSIONS.md). |

## Package types

- **`"package"`** — a reusable `.cdrca` source library other projects depend on (like `calculastic` in the example above). No special permissions model applies.
- **`"plugin"`** — a JS module hooking into CDRCA's transpiler pipeline. `permissions` and `uses` control what it's allowed to do — see PLUGIN-PERMISSIONS.md. The CLI shows these to the user and requires explicit `y/N` confirmation before installing any plugin, the same way a mobile OS prompts for app permissions.
- **`"app"`** — a runnable/shippable project, the kind `cdrca create app` scaffolds and `cdrca build app` packages into a distributable Windows `.exe` via Tauri.

## Validation rules the CLI enforces

Run automatically before `cdrca publish`, and partially before `cdrca run` / `cdrca build app`:

- `name` must be non-empty.
- `version` must parse as valid semver.
- `entry` must be non-empty **and** the file it points to must actually exist relative to the project root.
- If `type` is `"plugin"` and `permissions` is non-empty but `uses` is empty, the CLI prints a warning: the plugin will be seized by CDRCA's runtime on its very first hook-registration attempt, since it declared no allowed hooks.

## What's *not* in this file

Two pieces of state are deliberately kept **out** of `cdrca.json`, since it's a fixed cross-team contract and shouldn't grow implementation-detail fields:

- **`cdrca-lock.json`** — the resolved dependency lockfile (exact versions, checksums, resolved download URLs). See ARCHITECTURE.md.
- **`.cdrca-state.json`** — local per-project state, currently just the port baked into this project's patched CDRCA runtime copy. Gitignored by default (see `cdrca create app`'s generated `.gitignore`) since it's machine/instance-specific and shouldn't leak into a repo or a published package tarball.
