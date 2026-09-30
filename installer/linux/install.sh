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
#   - The logo IS installed, the freedesktop way (per user, under
#     ~/.local/share): the launcher icon, a "CDRCA" menu entry, and the
#     .cdrca file-type icon. That is the Linux counterpart of the Windows
#     installer's shortcut icon and .cdrca file association. It only sets
#     icons; nothing is registered as a double-click handler.
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

# --- logo: launcher icon, menu entry, .cdrca file-type icon ---
# Optional files: skipped quietly if this script is run without them, and
# never allowed to fail the install.
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
if [ -d "$SCRIPT_DIR/icons" ]; then
  for icon in "$SCRIPT_DIR"/icons/cdrca-*.png; do
    [ -f "$icon" ] || continue
    size="${icon##*/cdrca-}"; size="${size%.png}"
    mkdir -p "$DATA_HOME/icons/hicolor/${size}x${size}/apps" "$DATA_HOME/icons/hicolor/${size}x${size}/mimetypes"
    cp "$icon" "$DATA_HOME/icons/hicolor/${size}x${size}/apps/cdrca.png"
    cp "$icon" "$DATA_HOME/icons/hicolor/${size}x${size}/mimetypes/text-x-cdrca.png"
  done
fi
if [ -f "$SCRIPT_DIR/cdrca.desktop" ]; then
  mkdir -p "$DATA_HOME/applications"
  # Point the launcher at the exact binary we just installed.
  sed "s|^Exec=.*|Exec=sh -c \"$BIN_DIR/cdrca --help; exec bash\"|" \
    "$SCRIPT_DIR/cdrca.desktop" >"$DATA_HOME/applications/cdrca.desktop"
fi
if [ -f "$SCRIPT_DIR/cdrca-mime.xml" ]; then
  mkdir -p "$DATA_HOME/mime/packages"
  cp "$SCRIPT_DIR/cdrca-mime.xml" "$DATA_HOME/mime/packages/cdrca.xml"
fi
command -v update-mime-database >/dev/null 2>&1 && update-mime-database "$DATA_HOME/mime" >/dev/null 2>&1 || true
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA_HOME/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true

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
