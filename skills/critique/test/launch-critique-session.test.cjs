"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const SCRIPT = path.resolve(__dirname, "../scripts/launch-critique-session.cjs");

function makeExecutable(file, content) {
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
}

test("launch creates session with --no-open and opens extracted URL once without printing it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-critique-launch-"));
  const callsFile = path.join(dir, "calls.jsonl");
  const fakeCritique = path.join(dir, "critique");
  const fakeOpen = path.join(dir, "fake-open");
  const html = path.join(dir, "report.html");
  fs.writeFileSync(html, "<html></html>");

  makeExecutable(
    fakeCritique,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ tool: "critique", argv: process.argv.slice(2), noOpen: process.env.CRITIQUE_NO_OPEN }) + "\\n");
console.log("Critique session ready: http://127.0.0.1:4477/session/testsession");
console.log("Give feedback in the browser, then run poll.");
`,
  );

  makeExecutable(
    fakeOpen,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ tool: "open", argv: process.argv.slice(2) }) + "\\n");
`,
  );

  const result = spawnSync(process.execPath, [SCRIPT, "--bin", fakeCritique, "--file", html], {
    encoding: "utf8",
    env: {
      ...process.env,
      CRITIQUE_LAUNCH_OPEN_CMD: fakeOpen,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `Critique session opened for ${html}.\n`);
  assert.doesNotMatch(result.stdout, /http:\/\/127\.0\.0\.1/);

  const calls = fs
    .readFileSync(callsFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls, [
    { tool: "critique", argv: [html, "--no-open"], noOpen: "1" },
    { tool: "open", argv: ["http://127.0.0.1:4477/session/testsession"] },
  ]);
});
