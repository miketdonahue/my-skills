'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  getInventory,
  resolveTarget,
  resolveTargets,
} = require('./herdr-worktree-inventory.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-worktree-inventory-'));
}

function git(cwd, args) {
  const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function fixture() {
  const root = tempRoot();
  const repo = path.join(root, 'writer-monorepo');
  const worktreeRoot = path.join(root, 'worktrees');
  const managedRoot = path.join(worktreeRoot, 'writer-monorepo');
  const openPath = path.join(managedRoot, 'open-task');
  const parkedPath = path.join(managedRoot, 'parked-task');
  const prunablePath = path.join(managedRoot, 'prunable-task');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(openPath, { recursive: true });
  fs.mkdirSync(parkedPath, { recursive: true });
  fs.mkdirSync(prunablePath, { recursive: true });
  git(repo, ['init', '-q']);

  const worktrees = [
    { branch: 'main', is_linked_worktree: false, is_prunable: false, path: repo },
    { branch: 'open-branch', is_linked_worktree: true, is_prunable: false, open_workspace_id: 'w-open', path: openPath },
    { branch: 'parked-branch', is_linked_worktree: true, is_prunable: false, path: parkedPath },
    { branch: 'prunable-branch', is_linked_worktree: true, is_prunable: true, path: prunablePath },
    { branch: 'external-branch', is_linked_worktree: true, is_prunable: false, path: path.join(root, 'external') },
  ];
  const workspaces = [
    {
      agent_status: 'idle',
      focused: false,
      workspace_id: 'w-open',
      worktree: { checkout_path: openPath, is_linked_worktree: true },
    },
  ];
  const fakeHerdr = path.join(root, 'herdr.cjs');
  const log = path.join(root, 'herdr.log');
  fs.writeFileSync(fakeHerdr, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'worktree' && args[1] === 'list') process.stdout.write(JSON.stringify({ result: { source: { source_checkout_path: process.env.FAKE_REPO }, worktrees: JSON.parse(process.env.FAKE_WORKTREES) } }));
else if (args[0] === 'workspace' && args[1] === 'list') process.stdout.write(JSON.stringify({ result: { workspaces: JSON.parse(process.env.FAKE_WORKSPACES) } }));
else if (args[0] === 'worktree' && args[1] === 'open') process.stdout.write(JSON.stringify({ result: { worktree: { open_workspace_id: 'w-reopened' } } }));
else process.stdout.write(JSON.stringify({ result: {} }));
`, { mode: 0o700 });

  const env = {
    ...process.env,
    FAKE_HERDR_LOG: log,
    FAKE_REPO: repo,
    FAKE_WORKSPACES: JSON.stringify(workspaces),
    FAKE_WORKTREES: JSON.stringify(worktrees),
    WORKTREE_HERDR_BIN: fakeHerdr,
    WORKTREE_ROOT: worktreeRoot,
  };
  return { env, log, openPath, parkedPath, prunablePath, repo, worktreeRoot };
}

test('inventory filters to managed linked worktrees and joins workspace state', () => {
  const data = fixture();
  const inventory = getInventory({ cwd: data.repo, env: data.env });

  assert.equal(inventory.worktrees.length, 3);
  assert.deepEqual(inventory.worktrees.map((item) => [item.name, item.state, item.status]), [
    ['open-task', 'OPEN', 'idle'],
    ['parked-task', 'PARKED', null],
    ['prunable-task', 'PRUNABLE', null],
  ]);
  assert.equal(inventory.allWorktrees.some((item) => item.branch === 'external-branch' && !item.managed), true);
});

test('targets resolve by name, branch, and absolute path', () => {
  const data = fixture();
  const inventory = getInventory({ cwd: data.repo, env: data.env });

  assert.equal(resolveTarget(inventory, 'open-task').path, data.openPath);
  assert.equal(resolveTarget(inventory, 'parked-branch').path, data.parkedPath);
  assert.deepEqual(resolveTargets(inventory, ['open-task', 'open-branch', data.parkedPath]).map((item) => item.name), [
    'open-task',
    'parked-task',
  ]);
});

test('foreign and prunable targets are rejected', () => {
  const data = fixture();
  const inventory = getInventory({ cwd: data.repo, env: data.env });

  assert.throws(() => resolveTarget(inventory, 'external-branch'), /not a managed Herdr linked worktree/);
  assert.throws(() => resolveTarget(inventory, 'prunable-task'), /prunable/);
  assert.throws(() => resolveTarget(inventory, 'missing-task'), /not found/);
});
