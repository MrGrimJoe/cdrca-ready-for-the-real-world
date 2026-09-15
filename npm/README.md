# cdrca12

npm wrapper for the CDRCA CLI. Downloads the prebuilt `cdrca` binary from
[GitHub Releases](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world/releases)
on install and runs it.

**Windows and Linux** — CI builds both as two separate jobs (see
`.github/workflows/release.yml` in the main repo), each attaching its own
platform-suffixed binary to the release. Installing on any other platform
fails with a clear error instead of silently installing something broken.

Note: `cdrca build app` (packaging a CDRCA project into a distributable
app via Tauri) is Windows-only regardless of which platform the CLI
itself runs on — see the main repo's
[Platform support](https://github.com/MrGrimJoe/cdrca-ready-for-the-real-world#platform-support)
section for what that does and doesn't affect.

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
for the CLI source (Rust), the Windows and Linux installers, and the VS
Code extension.

## License

MrMIB License v1.0 — see [LICENSE.md](./LICENSE.md).
