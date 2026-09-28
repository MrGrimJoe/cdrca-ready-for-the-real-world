#!/bin/sh
# Runs after the package is installed or upgraded. Package scripts are not
# interactive, so unlike install.sh this only prints the manual step for the
# VS Code extension. Must never fail the install.
if command -v code >/dev/null 2>&1; then
  echo "cdrca: VS Code detected. Install the CDRCA extension with:"
else
  echo "cdrca: to use the CDRCA VS Code extension, install it with:"
fi
echo "         code --install-extension /usr/share/cdrca/cdrca-extension.vsix"
echo "cdrca: run 'cdrca doctor' to check your setup."
exit 0
