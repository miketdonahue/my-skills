'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function git(cwd, args) {
  const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-worktree-command-'));
  const repo = path.join(root, 'writer-monorepo');
  const worktreeRoot = path.join(root, 'worktrees');
  const managedRoot = path.join(worktreeRoot, 'writer-monorepo');
  const openPath = path.join(managedRoot, 'open-task');
  const workingPath = path.join(managedRoot, 'working-task');
  const parkedPath = path.join(managedRoot, 'parked-task');
  const prunablePath = path.join(managedRoot, 'prunable-task');
  fs.mkdirSync(repo, { recursive: true });
  for (const directory of [openPath, workingPath, parkedPath, prunablePath]) fs.mkdirSync(directory, { recursive: true });
  git(repo, ['init', '-q']);

  const worktrees = [
    { branch: 'main', is_linked_worktree: false, is_prunable: false, path: repo },
    { branch: 'open-branch', is_linked_worktree: true, is_prunable: false, open_workspace_id: 'w-open', path: openPath },
    { branch: 'working-branch', is_linked_worktree: true, is_prunable: false, open_workspace_id: 'w-working', path: workingPath },
    { branch: 'parked-branch', is_linked_worktree: true, is_prunable: false, path: parkedPath },
    { branch: 'prunable-branch', is_linked_worktree: true, is_prunable: true, path: prunablePath },
    { branch: 'external-branch', is_linked_worktree: true, is_prunable: false, path: path.join(root, 'external') },
  ];
  const workspaces = [
    { agent_status: 'idle', focused: false, workspace_id: 'w-open', worktree: { checkout_path: openPath } },
    { agent_status: 'working', focused: true, workspace_id: 'w-working', worktree: { checkout_path: workingPath } },
  ];
  const fakeHerdr = path.join(root, 'herdr.cjs');
  const log = path.join(root, 'herdr.log');
  fs.writeFileSync(fakeHerdr, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + '\\n');
const worktrees = JSON.parse(process.env.FAKE_WORKTREES);
const workspaces = JSON.parse(process.env.FAKE_WORKSPACES);
if (args[0] === 'worktree' && args[1] === 'list') process.stdout.write(JSON.stringify({ result: { source: { source_checkout_path: process.env.FAKE_REPO }, worktrees } }));
else if (args[0] === 'workspace' && args[1] === 'list') process.stdout.write(JSON.stringify({ result: { workspaces } }));
else if (args[0] === 'worktree' && args[1] === 'open') process.stdout.write(JSON.stringify({ result: { worktree: { open_workspace_id: 'w-reopened' } } }));
else if (args[0] === 'worktree' && args[1] === 'remove' && process.env.FAKE_REMOVE_FAIL === args[3]) { process.stderr.write('simulated remove failure'); process.exit(1); }
else if (args[0] === 'workspace' && args[1] === 'close' && process.env.FAKE_CLOSE_FAIL === args[2]) { process.stderr.write('simulated close failure'); process.exit(1); }
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
  return { env, log, openPath, parkedPath, prunablePath, repo, workingPath };
}

function readLog(log) {
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

module.exports = { createFixture, readLog };
