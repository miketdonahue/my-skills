'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW = path.resolve(__dirname, '..', 'scripts', 'workflow.cjs');
const { __test } = require(WORKFLOW);

function runWorkflow(args, options = {}) {
  return childProcess.spawnSync(process.execPath, [WORKFLOW, ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function git(cwd, args) {
  const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createRepo(root) {
  const remote = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(remote, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--bare', remote]);
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);
  return repo;
}

function createFakeHerdr(root) {
  const bin = path.join(root, 'herdr-fake.cjs');
  const source = `#!/usr/bin/env node
'use strict';
const childProcess = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.HERDR_LOG, JSON.stringify(args) + '\\n');
function value(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
if (args[0] === 'worktree' && args[1] === 'create') {
  const cwd = value('--cwd');
  const branch = value('--branch');
  const target = value('--path');
  const result = childProcess.spawnSync('git', ['-C', cwd, 'worktree', 'add', '-b', branch, target, 'origin/main'], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status);
  }
  process.stdout.write(JSON.stringify({ result: { worktree: { path: target, branch, open_workspace_id: 'w-test' } } }));
  process.exit(0);
}
process.stderr.write('unexpected herdr args: ' + JSON.stringify(args));
process.exit(2);
`;
  fs.writeFileSync(bin, source, { mode: 0o700 });
  return bin;
}

test('parse prefers first positional worktree name', () => {
  assert.deepEqual(__test.parseWorktreeArguments('explicit-name --name backup'), {
    requestedName: 'explicit-name',
  });
});

test('parse records the opt-in gateway Slack profile without changing normal parsing', () => {
  assert.deepEqual(__test.parseWorktreeArguments('--gateway-slack explicit-name'), {
    requestedName: 'explicit-name',
    gatewaySlack: true,
  });
});

test('create preserves /worktree output shape and appends the four-character suffix', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-worktree-test-'));
  const repo = createRepo(root);
  const herdr = createFakeHerdr(root);
  const env = {
    HERDR_LOG: path.join(root, 'herdr.log'),
    WORKTREE_HERDR_BIN: herdr,
    WORKTREE_ROOT: path.join(root, 'worktrees'),
    WORKTREE_RANDOM_HEX: 'a1b2',
    WORKTREE_DISABLE_ENV_GUARD: '1',
  };

  const result = runWorkflow(['create', '--cwd', repo, '--name', 'scheduled--daily-audit'], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const expectedWorktree = path.join(root, 'worktrees', 'repo', 'scheduled--daily-audit-a1b2');
  assert.equal(result.stdout, [
    'repo: repo',
    `worktree: ${expectedWorktree}`,
    'branch: scheduled--daily-audit-a1b2',
    'status: ready',
    '',
  ].join('\n'));
  assert.equal(git(expectedWorktree, ['branch', '--show-current']), 'scheduled--daily-audit-a1b2');
});

test('gateway Slack profile is rejected outside writer-monorepo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-worktree-non-writer-'));
  const repo = createRepo(root);
  const result = runWorkflow(['create', '--cwd', repo, '--gateway-slack'], {
    env: { WORKTREE_DISABLE_ENV_GUARD: '1' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /--gateway-slack is only supported for writer-monorepo/);
});
