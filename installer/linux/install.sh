#!/usr/bin/env bash
# CDRCA Linux installer.
#
# Counterpart to installer/cdrca-installer.iss (Inno Setup, Windows), and
# deliberately much simpler:
#   - No bundled Rust toolchain install. `cdrca build app` (the Tauri
#     packaging step) is Windows-only by design -- see
#     docs/ARCHITECTURE.md#building-on-linux -- so there is nothing on
#     Linux that needs a local Rust toolchain to work immediately the way
#     the Windows installer's silent rustup-init.exe run exists for.
#   - No registry-key VS Code detection (that's a Windows Credential/
#     Uninstall-key mechanism with no Linux equivalent) -- this script
#     just checks whether `code` is on PATH instead.
#   - No file-association / Explorer icon step -- there's no single
#     cross-desktop-environment equivalent worth building against.
#
# This script is meant to be run from inside the extracted
# cdrca-installer-linux.tar.gz (it expects `cdrca` and, optionally,
# `cdrca-extension.vsix` next to itself) -- not curled and piped blind.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INSTALL_DIR="${CDRCA_INSTALL_DIR:-$HOME/.local/share/cdrca}"
BIN_DIR="${CDRCA_BIN_DIR:-$HOME/.local/bin}"

if [ ! -f "$SCRIPT_DIR/cdrca" ]; then
  echo "cdrca: couldn't find a 'cdrca' binary next to this script ($SCRIPT_DIR)." >&2
  echo "       Run this from inside the extracted cdrca-installer-linux.tar.gz." >&2
  exit 1
fi

echo "cdrca: installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
install -m 755 "$SCRIPT_DIR/cdrca" "$INSTALL_DIR/cdrca"
ln -sf "$INSTALL_DIR/cdrca" "$BIN_DIR/cdrca"
[ -f "$SCRIPT_DIR/LICENSE.md" ] && cp "$SCRIPT_DIR/LICENSE.md" "$INSTALL_DIR/LICENSE.md"

# --- PATH ---
case ":${PATH:-}:" in
  *":$BIN_DIR:"*)
    : # already on PATH, nothing to do
    ;;
  *)
    case "$(basename "${SHELL:-}")" in
      zsh) shell_rc="$HOME/.zshrc" ;;
      bash) shell_rc="$HOME/.bashrc" ;;
      *) shell_rc="$HOME/.profile" ;;
    esac
    if ! grep -qsF "$BIN_DIR" "$shell_rc" 2>/dev/null; then
      {
        echo ""
        echo "# Added by the cdrca installer"
        echo "export PATH=\"$BIN_DIR:\$PATH\""
      } >>"$shell_rc"
      echo "cdrca: added $BIN_DIR to PATH in $shell_rc -- restart your shell, or run: source $shell_rc"
    fi
    ;;
esac

# --- optional VS Code extension ---
# Same .vsix the Windows installer offers -- see extension/README.md. The
# extension itself isn't Windows-specific, only the previous distribution
# path (Windows-only installer) was.
if [ -f "$SCRIPT_DIR/cdrca-extension.vsix" ]; then
  cp "$SCRIPT_DIR/cdrca-extension.vsix" "$INSTALL_DIR/cdrca-extension.vsix"
  if command -v code >/dev/null 2>&1; then
    read -r -p "cdrca: VS Code detected -- install the CDRCA extension too? [Y/n] " reply || reply=""
    case "$reply" in
      [nN]*)
        echo "cdrca: skipped. Install it later with: code --install-extension $INSTALL_DIR/cdrca-extension.vsix"
        ;;
      *)
        code --install-extension "$SCRIPT_DIR/cdrca-extension.vsix" ||
          echo "cdrca: extension install failed -- you can run this manually later: code --install-extension $INSTALL_DIR/cdrca-extension.vsix"
        ;;
    esac
  else
    echo "cdrca: VS Code not found on PATH -- install the extension later with: code --install-extension $INSTALL_DIR/cdrca-extension.vsix"
  fi
fi

echo ""
echo "cdrca: done. Run 'cdrca doctor' (after restarting your shell, if PATH was just updated) to check your setup."
