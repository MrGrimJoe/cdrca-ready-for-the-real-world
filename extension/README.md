# CDRCA VS Code Extension

Language support, project scaffolding, and a run button for CDRCA
animation projects, directly inside VS Code.

> **This extension is not published on the VS Code Marketplace.** It's
> bundled as an optional component of the main CDRCA installer — see
> the root [README.md](../README.md) and
> [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#vs-code-extension-bundling)
> for how it gets installed.

## What it does

- **Syntax highlighting** for `.cdrca` files (TextMate grammar in
  `syntaxes/cdrca.tmLanguage.json`), covering scene blocks (`!--- ... ---`),
  plugin blocks (`plugin ... scope ... trusted ...`), the `@requires`/
  `@syntaxPlugin` directives, and core keywords.
- **`CDRCA: Create New Project`** (Ctrl+Shift+P) — folder picker, then a
  name prompt, then scaffolds via the CLI's `cdrca create app` and opens
  the result. This is a direct `child_process.spawn` call, independent of
  and separate from typing `cdrca create app <name>` in a terminal
  yourself — the two paths don't share any VS Code machinery.
- **Run button** (▶ in the editor toolbar, `.cdrca` files only) — spawns
  `cdrca run` for the current project directly (never `npm`/`npx`), reads
  the port it reports back over stdout, health-checks it, then opens a
  live preview in a VS Code webview panel beside your editor. A stop
  button (■) tears the process down.

## File icons

The extension contributes an optional **File Icon Theme** called
**CDRCA Icons** (`icons/theme/cdrca-icon-theme.json`) that gives
`.cdrca` files a branded icon in the Explorer, editor tabs, and
breadcrumbs.

This is opt-in and separate from whatever icon theme you already use —
VS Code has no API for an extension to add "just one" icon to an
existing theme (see the note in
[docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md)). Selecting **CDRCA
Icons** *replaces* your current icon theme rather than layering on top
of it. To enable it: **Ctrl+Shift+P** → *Preferences: File Icon Theme*
→ **CDRCA Icons**.

Because of that tradeoff, this theme is intentionally minimal: it ships
a generic file icon, a generic folder icon (open/closed), and the
CDRCA-specific one for `.cdrca` — not full per-language coverage the
way a general-purpose icon theme (e.g. Material Icon Theme) has. If you
rely on per-language icons for other file types, you may prefer to
switch back to your usual theme when you're not focused on a CDRCA
project.

## Requirements

- The `cdrca` CLI must already be on PATH (installed via the main CDRCA
  installer, or built from `../cli` and added to PATH manually).
- The extension only activates inside an actual CDRCA project
  (`workspaceContains:cdrca.json`) or when a `.cdrca` file is opened — it
  does nothing in unrelated workspaces, and it never installs CDRCA
  itself.

## Building the .vsix manually

If you're not going through the main installer/CI pipeline:

```
cd extension
npm install -g @vscode/vsce
vsce package
```

Produces `cdrca-extension-<version>.vsix`, installable via
`code --install-extension cdrca-extension-<version>.vsix`.
