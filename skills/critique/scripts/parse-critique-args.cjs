#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ERROR = "Error: /critique requires exactly one readable .html or .htm file.";
const USAGE = "Usage: /critique <file.html>";

function fail(message = `${ERROR}\n${USAGE}`) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseCli(argv) {
  const out = {
    arguments: "",
    cwd: process.cwd(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--arguments") {
      if (i + 1 >= argv.length) fail();
      out.arguments = argv[++i];
    } else if (arg === "--cwd") {
      if (i + 1 >= argv.length) fail();
      out.cwd = argv[++i];
    } else {
      fail();
    }
  }
  return out;
}

function stripBalancedQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveCritiqueFile(rawArguments, cwd) {
  if (typeof rawArguments !== "string") fail();
  if (typeof cwd !== "string" || cwd.trim() === "") fail();

  let candidate = stripBalancedQuotes(rawArguments.trim());
  if (!candidate) fail();
  if (candidate.startsWith("-")) fail();
  if (candidate.includes("\0")) fail();

  candidate = expandHome(candidate);
  const base = path.resolve(cwd);
  const absolute = path.resolve(base, candidate);
  const extension = path.extname(absolute).toLowerCase();
  if (extension !== ".html" && extension !== ".htm") fail();

  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    fail();
  }
  if (!stat.isFile()) fail();

  try {
    fs.accessSync(absolute, fs.constants.R_OK);
  } catch {
    fail();
  }

  return {
    filePath: fs.realpathSync(absolute),
    extension,
    workingDirectory: base,
    originalArguments: rawArguments,
  };
}

if (require.main === module) {
  const options = parseCli(process.argv.slice(2));
  const result = resolveCritiqueFile(options.arguments, options.cwd);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  resolveCritiqueFile,
  stripBalancedQuotes,
  expandHome,
};
