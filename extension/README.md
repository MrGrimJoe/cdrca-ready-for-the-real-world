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
