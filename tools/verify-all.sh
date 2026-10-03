#!/usr/bin/env bash
# Runs every check in the repo and prints one line per step. Exits non-zero if
# any step fails (all steps still run, so you see every failure at once).
#
# Prerequisites (CI: run these first):
#   * Rust toolchain           (cargo)
#   * Node 18+
#   * `npm install` in:  cli
#                          (provides cli/node_modules/acorn — the `cdrca compile` Rust tests
#                          symlink it into their fake project and fail with
#                          "Cannot find module 'acorn'" without it)
#                        cli/src/templates/cdrca-runtime
#                        cli/src/templates/cdrca-runtime/Back-end/Transpiler/Plugins/grammar
#                          (the plugin packager needs `acorn`; its tests fail without it)
#                        plugins/cdrca-reactive-state
#                        plugins/ember
#                        plugins/campfire
#   * jsdom reachable by every folder above AND by tools/generate-vocabulary.js.
#     Simplest: `npm install --no-save jsdom@24` in EACH of those two folders
#     (require() walks up node_modules from wherever a file lives, so
#     installing it once at the repo root is NOT enough for a folder that
#     isn't nested under it — these two aren't). Without jsdom, DOM tests
#     print SKIPPED and this script says so; the vocabulary check hard-fails
#     without it (there is no meaningful fallback for reading the live
#     component registry), so this script installs it there itself if needed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RT="$ROOT/cli/src/templates/cdrca-runtime"
PLUG="$RT/Back-end/Transpiler/Plugins"
FE="$RT/Front-end/Transpiler-Plugins"
if [ ! -d "$ROOT/node_modules/jsdom" ]; then
  ( cd "$ROOT" && npm install --silent --no-save jsdom@24 > /dev/null 2>&1 ) || true
fi
export NODE_PATH="$ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"
fail=0
step() {
  local name="$1"; shift
  local out; out="$("$@" 2>&1)"; local rc=$?
  local skipped=""; echo "$out" | grep -q "SKIPPED" && skipped="  (some files SKIPPED — jsdom missing?)"
  if [ $rc -eq 0 ]; then printf '  PASS  %s%s\n' "$name" "$skipped"; else printf '  FAIL  %s\n' "$name"; echo "$out" | tail -25 | sed 's/^/        /'; fail=1; fi
}
cd "$ROOT"
echo "verify-all"
step "rust: cargo test"                        bash -c "cd '$ROOT/cli' && cargo test"
step "vocabulary is up to date"                node tools/generate-vocabulary.js --check
step "grammar plugin tests"                    bash -c "cd '$PLUG/grammar' && node tests/run.js"
step "quark plugin tests (back-end)"           bash -c "cd '$PLUG/quark' && node tests/run.js"
step "animations plugin (back-end) tests"      bash -c "cd '$PLUG/animations' && node tests/run.js"
step "animations backdrop (front-end) tests"   bash -c "cd '$FE/animations' && node tests/run.js"
step "runtime: plugin architecture"            node "$RT/tests/plugin-architecture.test.js"
step "runtime: background end to end"          node "$RT/tests/background.e2e.test.js"
step "project server (page ownership)"         node "$RT/tests/project-server.test.js"
step "ember plugin tests"                      bash -c "cd '$ROOT/plugins/ember' && npm test"
step "campfire plugin tests"                   bash -c "cd '$ROOT/plugins/campfire' && npm test"
step "reactive-state suite"                    bash -c "cd '$ROOT/plugins/cdrca-reactive-state' && CDRCA_RUNTIME_PATH='$RT' node tests/run.js"
step "legacy corpus: old files unchanged"      node tools/corpus-diff.js
step "v2 guide examples compile"               node tools/docs-v2-check.js
step "REACTIVE-STATE.md examples actually run" node tools/docs-reactive-state-check.js
step "npm/docs is in sync with docs/"           node tools/sync-npm-docs.js --check
[ $fail -eq 0 ] && echo "ALL PASSED" || echo "FAILED"
exit $fail
