#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseCli(argv) {
  const out = {
    bin: "/Users/michael/development/writer/tools/critique/bin/critique",
    file: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bin") {
      if (i + 1 >= argv.length) fail("Error: --bin requires a value.");
      out.bin = argv[++i];
    } else if (arg === "--file") {
      if (i + 1 >= argv.length) fail("Error: --file requires a value.");
      out.file = argv[++i];
    } else {
      fail(`Error: unsupported argument: ${arg}`);
    }
  }
  if (!out.file) fail("Error: --file is required.");
  return out;
}

function openCommand() {
  if (process.env.CRITIQUE_LAUNCH_OPEN_CMD) {
    return process.env.CRITIQUE_LAUNCH_OPEN_CMD.split(/\s+/).filter(Boolean);
  }
  if (process.platform === "darwin") return ["open"];
  if (process.platform === "win32") return ["cmd", "/c", "start", ""];
  return ["xdg-open"];
}

function extractSessionUrl(output) {
  const match = output.match(/Critique session ready:\s*(http:\/\/127\.0\.0\.1:\d+\/session\/[A-Za-z0-9_-]+)/);
  if (!match) {
    fail("Error: critique session started but no session URL was reported.");
  }
  return match[1];
}

function launch({ bin, file }) {
  if (!fs.existsSync(bin)) fail(`Error: critique binary not found: ${bin}`);
  const absoluteFile = path.resolve(file);
  const result = spawnSync(bin, [absoluteFile, "--no-open"], {
    encoding: "utf8",
    env: { ...process.env, CRITIQUE_NO_OPEN: "1" },
  });
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    process.stderr.write(combined);
    fail(`Error: critique failed to create the session for ${absoluteFile}.`);
  }

  const url = extractSessionUrl(combined);
  if (process.env.CRITIQUE_LAUNCH_DRY_RUN !== "1") {
    const [command, ...prefixArgs] = openCommand();
    const opened = spawnSync(command, [...prefixArgs, url], {
      encoding: "utf8",
      stdio: "ignore",
    });
    if (opened.error || opened.status !== 0) {
      fail("Error: critique session was created, but opening the browser failed.");
    }
  }

  process.stdout.write(`Critique session opened for ${absoluteFile}.\n`);
  return { url, file: absoluteFile };
}

if (require.main === module) {
  launch(parseCli(process.argv.slice(2)));
}

module.exports = {
  extractSessionUrl,
  launch,
  openCommand,
};
