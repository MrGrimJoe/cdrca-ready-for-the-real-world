#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// `docs` is handled entirely by this npm wrapper, not the Rust binary --
// it's the only subcommand that exists here and nowhere else. See
// cdrca-docs.js: it fetches the real guide content live from the main
// repo on every call rather than bundling a copy, on purpose.
if (process.argv[2] === "docs") {
  const { run } = require("./cdrca-docs.js");
  run(process.argv.slice(3)).then((code) => process.exit(code));
  return;
}

const binName = process.platform === "win32" ? "cdrca.exe" : "cdrca";
const binPath = path.join(__dirname, "..", "dist", binName);

if (!fs.existsSync(binPath)) {
  console.error(
    "\ncdrca12: the cdrca binary isn't installed. This usually means " +
      "postinstall didn't run or failed -- try reinstalling with " +
      "`npm install -g cdrca12` and check the output above for an error.\n"
  );
  process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error(`\ncdrca12: failed to run cdrca: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
