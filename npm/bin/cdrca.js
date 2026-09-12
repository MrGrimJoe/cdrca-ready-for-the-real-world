#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const binPath = path.join(__dirname, "..", "dist", "cdrca.exe");

if (!fs.existsSync(binPath)) {
  console.error(
    "\ncdrca12: the cdrca.exe binary isn't installed. This usually means " +
      "postinstall didn't run or failed -- try reinstalling with " +
      "`npm install -g cdrca12` and check the output above for an error.\n"
  );
  process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  console.error(`\ncdrca12: failed to run cdrca.exe: ${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
