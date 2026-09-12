# cdrca12

npm wrapper for the CDRCA CLI. Downloads the prebuilt `cdrca.exe` from
[GitHub Releases](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world/releases)
on install and runs it.

**Windows only right now** — that's the only platform CI currently builds
a binary for. Installing on macOS/Linux will fail with a clear error
instead of silently installing something broken.

## Install

```
npm install -g cdrca12
```

## Use

```
cdrca12 --help
```

## Source

This is a thin wrapper, not the actual implementation — see
[github.com/MrGrimJoe/cdrca-ready-for-the-real-world](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world)
for the CLI source (Rust), the Windows installer, and the VS Code
extension.

## License

MrMIB License v1.0 — see [LICENSE.md](./LICENSE.md).
