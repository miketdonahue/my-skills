'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createFixture, readLog } = require('../../../lib/test-worktree-fixture.cjs');
const { getInventory } = require('../../../lib/herdr-worktree-inventory.cjs');
const { __test } = require('../scripts/workflow.cjs');

function prepare(fixture, pulls = {}) {
  for (const directory of [fixture.repo, fixture.openPath, fixture.workingPath, fixture.parkedPath, fixture.prunablePath]) {
    const result = childProcess.spawnSync('/usr/bin/git', ['init', '--quiet', directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const fakeGh = path.join(path.dirname(fixture.log), 'gh.cjs');
  fs.writeFileSync(fakeGh, `#!/usr/bin/env node
const args = process.argv.slice(2);
const branch = args[args.indexOf('--head') + 1];
const pulls = JSON.parse(process.env.FAKE_GH_PULLS || '{}');
process.stdout.write(JSON.stringify(pulls[branch] || []));
`, { mode: 0o700 });
  fixture.env.WORKTREE_GH_BIN = fakeGh;
  fixture.env.WORKTREE_CLOSE_PENDING_ROOT = path.join(path.dirname(fixture.log), 'pending');
  fixture.env.FAKE_GH_PULLS = JSON.stringify(pulls);
  return fixture;
}

function mergedPull(number, branch) {
  return [{
    headRefName: branch,
    mergedAt: '2026-10-08T16:00:00Z',
    number,
    state: 'MERGED',
    url: `https://github.com/example/writer-monorepo/pull/${number}`,
  }];
}

function run(fixture, args, mode = 'invoke') {
  const script = path.resolve(__dirname, '../scripts/workflow.cjs');
  const commandArgs = mode === 'invoke'
    ? [script, 'invoke', '--cwd', fixture.repo, '--arguments', args]
    : [script, mode, args];
  return childProcess.spawnSync(process.execPath, commandArgs, {
    env: fixture.env,
    encoding: 'utf8',
  });
}

function confirmationId(result) {
  const match = String(result.stdout || '').match(/Confirmation ID: ([0-9a-f-]{36})/i);
  assert.ok(match, result.stdout || result.stderr);
  return match[1];
}

function installFakeGit(fixture) {
  const fakeGit = path.join(path.dirname(fixture.log), 'git.cjs');
  const gitLog = path.join(path.dirname(fixture.log), 'git.log');
  fs.writeFileSync(fakeGit, `#!/usr/bin/env node
const childProcess = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '-C' && args[2] === 'worktree' && args[3] === 'remove') {
  fs.appendFileSync(process.env.FAKE_GIT_LOG, JSON.stringify(args) + '\\n');
  if (process.env.FAKE_GIT_REMOVE_FAIL === '1') {
    process.stderr.write('simulated git remove failure');
    process.exit(1);
  }
  process.exit(0);
}
const result = childProcess.spawnSync('/usr/bin/git', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });
  fixture.env.WORKTREE_GIT_BIN = fakeGit;
  fixture.env.FAKE_GIT_LOG = gitLog;
  return gitLog;
}

function readGitLog(log) {
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('deletes clean merged and no-PR worktrees', () => {
  const fixture = prepare(createFixture(), { 'open-branch': mergedPull(101, 'open-branch') });
  const result = run(fixture, 'open-task parked-task');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"open-task": deleted workspace w-open and worktree/);
  assert.match(result.stdout, /"parked-task": deleted worktree \(no PR found for branch "parked-branch"\)/);
  assert.doesNotMatch(result.stdout, /Confirmation ID:/);
  assert.equal(readLog(fixture.log).filter((args) => args[0] === 'worktree' && args[1] === 'remove').length, 2);
  assert.equal(readLog(fixture.log).filter((args) => args[0] === 'workspace' && args[1] === 'close').length, 0);
});

test('asks before deleting focused or working targets without a merged PR', () => {
  const fixture = prepare(createFixture());
  const result = run(fixture, 'working-task');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /confirmation required: no PR found/);
  assert.match(result.stdout, /workspace is focused/);
  assert.equal(readLog(fixture.log).filter((args) => args[0] === 'worktree' && args[1] === 'remove').length, 0);
});

test('allows an inferred current target to bypass active-workspace confirmation', () => {
  const fixture = prepare(createFixture());
  const inventory = getInventory({ cwd: fixture.repo, env: fixture.env });
  const working = inventory.worktrees.find((worktree) => worktree.name === 'working-task');

  assert.equal(__test.activeDeletionReason(working, true), null);
  assert.equal(__test.activeDeletionReason(working, false), 'workspace is focused');
});

test('rejects --force instead of bypassing active-target confirmation', () => {
  const fixture = prepare(createFixture(), { 'working-branch': mergedPull(102, 'working-branch') });
  const result = run(fixture, 'working-task --force');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected arguments: --force/);
  assert.equal(readLog(fixture.log).filter((args) => args[0] === 'worktree' && args[1] === 'remove').length, 0);
});

test('deletes a merged parked worktree without deleting its branch', () => {
  const fixture = prepare(createFixture(), { 'parked-branch': mergedPull(103, 'parked-branch') });
  const gitLog = installFakeGit(fixture);
  const result = run(fixture, 'parked-task');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"parked-task": deleted worktree/);
  assert.deepEqual(readGitLog(gitLog), [['-C', fs.realpathSync(fixture.repo), 'worktree', 'remove', '--force', path.resolve(fixture.parkedPath)]]);
  assert.equal(readLog(fixture.log).filter((args) => args[0] === 'workspace' && args[1] === 'close').length, 0);
});

test('deletes a merged open worktree through Herdr', () => {
  const fixture = prepare(createFixture(), { 'open-branch': mergedPull(104, 'open-branch') });
  const result = run(fixture, 'open-task');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"open-task": deleted workspace w-open and worktree/);
  assert.deepEqual(readLog(fixture.log).at(-1), ['worktree', 'remove', '--workspace', 'w-open', '--force', '--json']);
});

test('asks before deleting a focused merged target', () => {
  const fixture = prepare(createFixture(), { 'working-branch': mergedPull(105, 'working-branch') });
  const result = run(fixture, 'working-task');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /confirmation required: PR #105/);
  assert.match(result.stdout, /workspace is focused/);
  assert.equal(readLog(fixture.log).filter((args) => args[0] === 'worktree' && args[1] === 'remove').length, 0);
});

test('reports deletion failures per target and returns failure', () => {
  const fixture = prepare(createFixture(), {
    'open-branch': mergedPull(106, 'open-branch'),
    'parked-branch': mergedPull(107, 'parked-branch'),
  });
  fixture.env.FAKE_REMOVE_FAIL = 'w-open';
  fixture.env.FAKE_GIT_REMOVE_FAIL = '1';
  const gitLog = installFakeGit(fixture);
  const result = run(fixture, 'open-task parked-task');

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /"open-task": failed to delete worktree/);
  assert.match(result.stdout, /"parked-task": failed to delete worktree/);
  assert.deepEqual(readGitLog(gitLog), [['-C', fs.realpathSync(fixture.repo), 'worktree', 'remove', '--force', path.resolve(fixture.parkedPath)]]);
});

test('resolves all targets before deleting any', () => {
  const fixture = prepare(createFixture(), { 'open-branch': mergedPull(108, 'open-branch') });
  const result = run(fixture, 'open-task missing-task');

  assert.notEqual(result.status, 0);
  assert.equal(readLog(fixture.log).filter((args) => args[0] === 'worktree' && args[1] === 'remove').length, 0);
});

test('confirmed deletion removes the requested worktree', () => {
  const fixture = prepare(createFixture());
  fs.writeFileSync(path.join(fixture.openPath, 'local-change.txt'), 'uncommitted');
  const first = run(fixture, 'open-task');
  const requestId = confirmationId(first);
  const confirmed = run(fixture, requestId, 'confirm');

  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stdout, /"open-task": deleted workspace w-open and worktree/);
  assert.deepEqual(readLog(fixture.log).at(-1), ['worktree', 'remove', '--workspace', 'w-open', '--force', '--json']);
});

test('confirmed deletion re-prompts if worktree changes since the request', () => {
  const fixture = prepare(createFixture());
  fs.writeFileSync(path.join(fixture.openPath, 'local-change.txt'), 'uncommitted');
  const first = run(fixture, 'open-task');
  const requestId = confirmationId(first);
  fs.writeFileSync(path.join(fixture.openPath, 'new-change.txt'), 'changed after prompt');
  const confirmed = run(fixture, requestId, 'confirm');

  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stdout, /confirmation required again/);
  assert.match(confirmed.stdout, /Confirmation ID:/);
  assert.equal(fs.existsSync(path.join(fixture.openPath, 'new-change.txt')), true);
});

test('protects prunable targets, accepts repo arguments, and rejects removed flags', () => {
  const fixture = prepare(createFixture());
  const result = run(fixture, 'prunable-task');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /prunable/);
  assert.deepEqual(__test.parseArgs(['one', 'two', '--repo', '/tmp/repo']), {
    repo: '/tmp/repo',
    targets: ['one', 'two'],
  });
  assert.deepEqual(__test.parseArgs([]), {
    repo: null,
    targets: [],
  });
  assert.throws(() => __test.parseArgs(['--delete']), /unexpected arguments/);
  assert.throws(() => __test.parseArgs(['--force']), /unexpected arguments/);
});

test('infers the current managed linked worktree when no target is supplied', () => {
  const inventory = {
    repo: '/tmp/repo/action-1234',
    allWorktrees: [{
      linked: true,
      managed: true,
      path: '/tmp/repo/action-1234',
      primary: false,
    }],
  };

  assert.deepEqual(__test.inferCurrentTarget(inventory, {
    repo: null,
    targets: [],
  }), {
    inferred: true,
    targets: ['/tmp/repo/action-1234'],
  });
  assert.throws(() => __test.inferCurrentTarget(inventory, {
    repo: '/tmp/repo',
    targets: [],
  }), /--repo/);
});

test('focuses the next open managed workspace after an inferred deletion', () => {
  const fixture = createFixture();
  const inventory = getInventory({ cwd: fixture.repo, env: fixture.env });
  const deleted = inventory.worktrees.find((worktree) => worktree.name === 'working-task');
  const result = __test.focusNextWorkspace(inventory, deleted, { env: fixture.env });

  assert.deepEqual(result, { status: 'focused workspace w-open' });
  assert.deepEqual(readLog(fixture.log).at(-1), ['workspace', 'focus', 'w-open']);
});
