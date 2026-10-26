"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const SCRIPT = path.resolve(__dirname, "../scripts/parse-critique-args.cjs");

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-critique-parser-"));
  fs.writeFileSync(path.join(dir, "report.html"), "<html></html>");
  fs.writeFileSync(path.join(dir, "space report.htm"), "<html></html>");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not html");
  fs.mkdirSync(path.join(dir, "folder.html"));
  return dir;
}

function runParser(rawArguments, cwd) {
  return spawnSync(process.execPath, [SCRIPT, "--arguments", rawArguments, "--cwd", cwd], {
    encoding: "utf8",
  });
}

function parseOk(rawArguments, cwd) {
  const result = runParser(rawArguments, cwd);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertRejects(rawArguments, cwd) {
  const result = runParser(rawArguments, cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Error: \/critique requires exactly one readable \.html or \.htm file\./);
}

test("missing argument rejects", () => {
  const dir = makeFixture();
  assertRejects("", dir);
});

test("relative html path resolves against cwd", () => {
  const dir = makeFixture();
  const parsed = parseOk("report.html", dir);
  assert.equal(parsed.filePath, fs.realpathSync(path.join(dir, "report.html")));
  assert.equal(parsed.extension, ".html");
  assert.equal(parsed.workingDirectory, path.resolve(dir));
});

test("quoted path with spaces resolves", () => {
  const dir = makeFixture();
  const parsed = parseOk('"space report.htm"', dir);
  assert.equal(parsed.filePath, fs.realpathSync(path.join(dir, "space report.htm")));
  assert.equal(parsed.extension, ".htm");
});

test("directory rejects", () => {
  const dir = makeFixture();
  assertRejects("folder.html", dir);
});

test("missing file rejects", () => {
  const dir = makeFixture();
  assertRejects("missing.html", dir);
});

test("flag-like input rejects", () => {
  const dir = makeFixture();
  assertRejects("--help", dir);
});

test("non-html extension rejects", () => {
  const dir = makeFixture();
  assertRejects("notes.txt", dir);
});

test("unreadable file rejects", { skip: process.platform === "win32" }, () => {
  const dir = makeFixture();
  const file = path.join(dir, "unreadable.html");
  fs.writeFileSync(file, "<html></html>");
  fs.chmodSync(file, 0o000);
  try {
    assertRejects("unreadable.html", dir);
  } finally {
    fs.chmodSync(file, 0o600);
  }
});
