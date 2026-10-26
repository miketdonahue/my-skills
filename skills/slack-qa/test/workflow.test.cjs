'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW = path.resolve(__dirname, '..', 'scripts', 'workflow.cjs');
const { __test } = require(WORKFLOW);

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, { mode: 0o700 });
}

function runWorkflow(args, options = {}) {
  return childProcess.spawnSync(process.execPath, [WORKFLOW, ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    input: options.input,
  });
}

test('parses the slash-command PR URL without accepting extra arguments', () => {
  assert.deepEqual(__test.parseSkillArguments('https://github.com/WriterColab/writer-monorepo/pull/16339'), {
    prUrl: 'https://github.com/WriterColab/writer-monorepo/pull/16339',
  });
  assert.throws(
    () => __test.parseSkillArguments('https://github.com/WriterColab/writer-monorepo/pull/16339 --restart'),
    /usage: \/slack-qa/,
  );
});

test('invoke runs the prepare helper and returns its JSON contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-slack-qa-workflow-'));
  const log = path.join(root, 'prepare.log');
  const prepare = path.join(root, 'prepare.cjs');
  writeExecutable(prepare, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
fs.writeFileSync(process.env.PREPARE_LOG, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({
  runDirectory: '/tmp/slack-qa-run',
  planPath: '/tmp/slack-qa-run/test-plan.md',
  pullRequest: { url: process.argv[process.argv.indexOf('--pr') + 1] },
  runtime: { mode: 'local' }
}));
`);

  const result = runWorkflow(['invoke', '--arguments', 'https://github.com/WriterColab/writer-monorepo/pull/16339', '--checkout', root], {
    env: { SLACK_QA_PREPARE_SCRIPT: prepare, PREPARE_LOG: log },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.pullRequest.url, 'https://github.com/WriterColab/writer-monorepo/pull/16339');
  assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')), [
    '--pr',
    'https://github.com/WriterColab/writer-monorepo/pull/16339',
    '--checkout',
    root,
  ]);
});

test('invoke rejects non-PR arguments before running helpers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-slack-qa-reject-'));
  const log = path.join(root, 'prepare.log');
  const prepare = path.join(root, 'prepare.cjs');
  writeExecutable(prepare, `#!/usr/bin/env node
'use strict';
require('node:fs').writeFileSync(process.env.PREPARE_LOG, 'ran');
`);

  const result = runWorkflow(['invoke', '--arguments', 'https://github.com/WriterColab/writer-monorepo/issues/16339', '--checkout', root], {
    env: { SLACK_QA_PREPARE_SCRIPT: prepare, PREPARE_LOG: log },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub pull request URL|form https/);
  assert.equal(fs.existsSync(log), false);
});

test('run-case proxies the JSON case to the direct-message helper', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-slack-qa-case-'));
  const log = path.join(root, 'direct-message.log');
  const directMessage = path.join(root, 'direct-message.cjs');
  writeExecutable(directMessage, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const input = fs.readFileSync(0, 'utf8');
fs.writeFileSync(process.env.DIRECT_MESSAGE_LOG, JSON.stringify({ args: process.argv.slice(2), input }));
process.stdout.write(JSON.stringify({ ok: true, permalink: 'https://slack.example/message' }));
`);

  const request = JSON.stringify({ prompt: 'hello Zoe', expectContains: ['hello'] });
  const result = runWorkflow(['run-case', '--checkout', root], {
    env: { SLACK_QA_DIRECT_MESSAGE_SCRIPT: directMessage, DIRECT_MESSAGE_LOG: log },
    input: request,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, permalink: 'https://slack.example/message' });
  assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')), {
    args: ['run', '--checkout', root],
    input: request,
  });
});

test('workflow source contains no service lifecycle commands', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  assert.doesNotMatch(source, /dev-start|worktree-start|worktree-stop|docker compose|ngrok http|pkill|kill -/);
});
