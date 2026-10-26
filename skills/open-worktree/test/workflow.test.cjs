'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { createFixture, readLog } = require('../../../lib/test-worktree-fixture.cjs');
const { __test } = require('../scripts/workflow.cjs');

function run(fixture, args) {
  return childProcess.spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/workflow.cjs'), 'invoke', '--cwd', fixture.repo, '--arguments', args], {
    env: fixture.env,
    encoding: 'utf8',
  });
}

test('focuses an already-open worktree without opening another workspace', () => {
  const fixture = createFixture();
  const result = run(fixture, 'open-task');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Focused worktree/);
  assert.deepEqual(readLog(fixture.log).at(-1), ['workspace', 'focus', 'w-open']);
});

test('opens a parked worktree by exact branch', () => {
  const fixture = createFixture();
  const result = run(fixture, 'parked-branch');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Opened worktree/);
  assert.match(result.stdout, /Workspace: `w-reopened`/);
  assert.deepEqual(readLog(fixture.log).at(-1), [
    'worktree', 'open', '--cwd', require('node:fs').realpathSync(fixture.repo), '--path', fixture.parkedPath, '--focus', '--json',
  ]);
});

test('rejects missing and prunable targets', () => {
  const fixture = createFixture();
  assert.notEqual(run(fixture, 'missing').status, 0);
  assert.match(run(fixture, 'prunable-task').stderr, /prunable/);
});

test('parses one target and repo override', () => {
  assert.deepEqual(__test.parseArgs(['parked-task', '--repo', '/tmp/repo']), {
    repo: '/tmp/repo',
    target: 'parked-task',
  });
});
