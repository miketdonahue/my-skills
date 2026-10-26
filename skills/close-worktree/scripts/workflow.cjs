#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PENDING_ROOT = path.resolve(
  process.env.WORKTREE_CLOSE_PENDING_ROOT
  || path.join(os.homedir(), '.omp', 'runtime', 'close-worktree', 'pending'),
);
const REQUEST_TTL_MS = 60 * 60 * 1000;

const {
  getInventory,
  herdrCommand,
  InventoryError,
  parseJson,
  resolveTargets,
  tokenize,
} = require('../../../lib/herdr-worktree-inventory.cjs');

function fail(message) {
  throw new InventoryError(message);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
    fail(`missing value for ${name}`);
  }
  return args[index + 1];
}

function parseArgs(args) {
  const repo = option(args, '--repo');
  const positional = args.filter((arg, index) => {
    if (arg === '--repo') return false;
    if (repo !== null && index === args.indexOf('--repo') + 1) return false;
    return !arg.startsWith('--');
  });
  const unknownFlags = args.filter((arg) => (
    arg.startsWith('--') && arg !== '--repo'
  ));
  if (unknownFlags.length) fail(`unexpected arguments: ${unknownFlags.join(' ')}`);
  if (repo !== null && args.filter((arg) => arg === '--repo').length > 1) fail('--repo may only be provided once');
  return { repo, targets: positional };
}

function parseInvocation(argv) {
  const [mode, ...args] = argv;
  if (mode === 'invoke') {
    const values = new Map();
    for (let index = 0; index < args.length; index += 2) {
      const name = args[index];
      const value = args[index + 1];
      if (!['--cwd', '--arguments'].includes(name) || value === undefined || values.has(name)) {
        fail('usage: workflow.cjs invoke --cwd <path> --arguments <arguments>');
      }
      if (name === '--cwd' && value.startsWith('--')) fail('missing value for --cwd');
      values.set(name, value);
    }
    if (!values.has('--cwd') || !values.has('--arguments')) {
      fail('usage: workflow.cjs invoke --cwd <path> --arguments <arguments>');
    }
    return {
      ...parseArgs(tokenize(values.get('--arguments'))),
      cwd: values.get('--cwd'),
      mode,
    };
  }
  if (mode === 'confirm' || mode === 'cancel') {
    if (args.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[0])) {
      fail(`usage: workflow.cjs ${mode} <confirmation-id>`);
    }
    return { mode, requestId: args[0] };
  }
  fail('usage: workflow.cjs invoke|confirm|cancel ...');
}

function inferCurrentTarget(inventory, args) {
  if (args.targets.length) return { inferred: false, targets: args.targets };
  if (args.repo) fail('cannot infer the current worktree with --repo; provide an explicit target');

  const current = inventory.allWorktrees.find((worktree) => worktree.path === inventory.repo);
  if (!current || !current.linked || current.primary || !current.managed) {
    fail(`current directory is not a managed Herdr linked worktree: ${inventory.repo}`);
  }
  return { inferred: true, targets: [current.path] };
}

function validateTargets(worktrees) {
  for (const worktree of worktrees) {
    if (worktree.state === 'PRUNABLE') fail(`worktree is prunable and cannot be deleted: ${worktree.path}`);
    if (worktree.state === 'OPEN' && !worktree.workspaceId) {
      fail(`open worktree has no workspace ID: ${worktree.path}`);
    }
  }
}

function activeDeletionReason(worktree, allowImplicitActive) {
  if (worktree.state !== 'OPEN' || allowImplicitActive) return null;
  if (worktree.focused) return 'workspace is focused';
  if (worktree.status === 'working') return 'workspace is working';
  return null;
}

function worktreeStatus(worktree, options = {}) {
  const gitBin = options.gitBin || options.env?.WORKTREE_GIT_BIN || process.env.WORKTREE_GIT_BIN || 'git';
  const result = childProcess.spawnSync(gitBin, [
    '-C', worktree.path, 'status', '--porcelain=v1', '--untracked-files=normal',
  ], {
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  if (result.error) fail(`could not inspect worktree changes at ${worktree.path}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
    fail(`could not inspect worktree changes at ${worktree.path}: ${detail}`);
  }
  const text = result.stdout || '';
  return {
    clean: text.trim().length === 0,
    hash: crypto.createHash('sha256').update(text).digest('hex'),
  };
}

function cleanDetail(detail) {
  return String(detail || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

function pullRequestStatus(worktree, options = {}) {
  if (!worktree.branch) return { detail: 'worktree has no checked-out branch', kind: 'unknown' };
  const ghBin = options.ghBin || options.env?.WORKTREE_GH_BIN || process.env.WORKTREE_GH_BIN || 'gh';
  const result = childProcess.spawnSync(ghBin, [
    'pr', 'list', '--state', 'all', '--head', worktree.branch, '--limit', '100',
    '--json', 'number,url,state,mergedAt,headRefName',
  ], {
    cwd: worktree.path,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || `exit code ${result.status}`;
    return { detail: cleanDetail(detail), kind: 'unknown' };
  }

  let pulls;
  try {
    pulls = JSON.parse(result.stdout || '');
  } catch (error) {
    return { detail: `GitHub CLI returned invalid JSON: ${cleanDetail(error.message)}`, kind: 'unknown' };
  }
  if (!Array.isArray(pulls) || pulls.some((pull) => !pull || typeof pull.headRefName !== 'string')) {
    return { detail: 'GitHub CLI returned incomplete pull-request metadata', kind: 'unknown' };
  }

  const matching = pulls.filter((pull) => pull.headRefName === worktree.branch);
  if (matching.length === 0) return { kind: 'none', pulls: [] };
  if (matching.length === 1 && matching[0].mergedAt) return { kind: 'merged', pulls: matching };
  if (matching.length === 1) return { kind: 'unmerged', pulls: matching };
  return { kind: 'ambiguous', pulls: matching };
}

function formatPullRequest(pull) {
  const number = Number.isInteger(pull.number) ? `#${pull.number}` : 'unknown number';
  return pull.url ? `PR ${number} (${pull.url})` : `PR ${number}`;
}

function describePullRequestStatus(status, worktree) {
  if (status.kind === 'merged') {
    return `${status.pulls.map(formatPullRequest).join(', ')} ${status.pulls.length === 1 ? 'is' : 'are'} merged`;
  }
  if (status.kind === 'none') return `no PR found for branch ${JSON.stringify(worktree.branch)}`;
  if (status.kind === 'unmerged') {
    const pull = status.pulls[0];
    const state = String(pull.state || 'not merged').toLowerCase();
    return `${formatPullRequest(pull)} is ${state} and not merged`;
  }
  if (status.kind === 'ambiguous') {
    return `multiple PRs are attached to branch ${JSON.stringify(worktree.branch)}: ${status.pulls.map(formatPullRequest).join(', ')}`;
  }
  return `PR status could not be checked: ${status.detail}`;
}

function removeGitWorktree(repo, worktreePath, options = {}) {
  const gitBin = options.gitBin || options.env?.WORKTREE_GIT_BIN || process.env.WORKTREE_GIT_BIN || 'git';
  const result = childProcess.spawnSync(gitBin, ['-C', repo, 'worktree', 'remove', '--force', worktreePath], {
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`git worktree remove failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
    throw new Error(`git worktree remove failed: ${detail}`);
  }
}

function deleteWorktree(inventory, worktree, options = {}) {
  if (worktree.state === 'OPEN') {
    herdrCommand(['worktree', 'remove', '--workspace', worktree.workspaceId, '--force', '--json'], options);
    return `deleted workspace ${worktree.workspaceId} and worktree`;
  }
  removeGitWorktree(inventory.repo, worktree.path, options);
  return 'deleted worktree';
}

function pendingRoot(options = {}) {
  return path.resolve(options.pendingRoot || options.env?.WORKTREE_CLOSE_PENDING_ROOT || PENDING_ROOT);
}

function expirePendingRequests(root, now = Date.now()) {
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (!/^[0-9a-f-]+\.json$/i.test(name)) continue;
    const file = path.join(root, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const request = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number(request.expiresAt) <= now) fs.unlinkSync(file);
    } catch {
      // Leave malformed files for inspection instead of deleting unknown data.
    }
  }
}

function writePendingRequest(inventory, candidates, inferred, options = {}) {
  const root = pendingRoot(options);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  expirePendingRequests(root);
  const requestId = crypto.randomUUID();
  const request = {
    expiresAt: Date.now() + REQUEST_TTL_MS,
    inferred,
    repo: inventory.repo,
    repoName: inventory.repoName,
    targets: candidates.map(({ activeReason, reason, status, worktree }) => ({
      activeReason,
      branch: worktree.branch,
      path: worktree.path,
      reason,
      statusHash: status.hash,
    })),
    version: 1,
  };
  fs.writeFileSync(path.join(root, `${requestId}.json`), `${JSON.stringify(request, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return requestId;
}

function readPendingRequest(requestId, options = {}) {
  const root = pendingRoot(options);
  expirePendingRequests(root);
  const file = path.join(root, `${requestId}.json`);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    fail(`confirmation request is missing or expired: ${requestId}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`invalid confirmation request: ${requestId}`);
  let request;
  try {
    request = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`could not read confirmation request ${requestId}: ${error.message}`);
  }
  if (request.version !== 1 || !Number.isFinite(request.expiresAt)
    || request.expiresAt <= Date.now() || !Array.isArray(request.targets)) {
    fail(`confirmation request is invalid or expired: ${requestId}`);
  }
  return { file, request };
}

function workspaceRecords(options = {}) {
  const payload = parseJson(herdrCommand(['workspace', 'list'], options), 'herdr workspace list');
  return payload.result?.workspaces || payload.workspaces || [];
}

function nextWorkspaceToFocus(inventory, closedWorktree, options = {}) {
  const nextManaged = inventory.worktrees.find((worktree) => (
    worktree.path !== closedWorktree.path
    && worktree.state === 'OPEN'
    && worktree.workspaceId
  ));
  if (nextManaged) return nextManaged;

  const primary = workspaceRecords(options).find((workspace) => (
    path.resolve(workspace.worktree?.checkout_path || '') === inventory.primaryPath
  ));
  if (!primary?.workspace_id) return null;
  return { name: path.basename(inventory.primaryPath), workspaceId: primary.workspace_id };
}

function focusNextWorkspace(inventory, closedWorktree, options = {}) {
  const next = nextWorkspaceToFocus(inventory, closedWorktree, options);
  if (!next) return { status: 'no open workspace to focus' };
  try {
    herdrCommand(['workspace', 'focus', next.workspaceId], options);
    return { status: `focused workspace ${next.workspaceId}` };
  } catch (error) {
    return { error: error.message, failed: true, status: `failed to focus workspace ${next.workspaceId}` };
  }
}

function decideWorktrees(inventory, worktrees, args, inferred, options = {}) {
  const decisions = worktrees.map((worktree) => {
    const status = worktreeStatus(worktree, options);
    const pullRequest = pullRequestStatus(worktree, options);
    const reason = describePullRequestStatus(pullRequest, worktree);
    const activeReason = activeDeletionReason(worktree, inferred);
    const safePullRequestState = pullRequest.kind === 'merged' || pullRequest.kind === 'none';
    const needsConfirmation = !safePullRequestState || !status.clean || Boolean(activeReason);
    return { activeReason, needsConfirmation, pullRequest, reason, status, worktree };
  });

  const pending = decisions.filter((decision) => decision.needsConfirmation);
  const requestId = pending.length
    ? writePendingRequest(inventory, pending.map(({ activeReason, reason, status, worktree }) => ({
      activeReason, reason, status, worktree,
    })), inferred, options)
    : null;

  const results = decisions.map((decision) => {
    const { activeReason, needsConfirmation, reason, status, worktree } = decision;
    if (needsConfirmation) {
      const notes = [reason];
      if (!status.clean) notes.push('worktree has uncommitted changes that deletion will discard');
      if (activeReason) notes.push(activeReason);
      return { worktree, status: `confirmation required: ${notes.join('; ')}` };
    }
    try {
      return { worktree, status: `${deleteWorktree(inventory, worktree, options)} (${reason})` };
    } catch (error) {
      return { error: error.message, worktree, status: 'failed to delete worktree' };
    }
  });
  return { requestId, results };
}

function reissueConfirmation(inventory, request, candidates, options = {}) {
  const newId = writePendingRequest(inventory, candidates, request.inferred, options);
  return {
    requestId: newId,
    results: candidates.map(({ activeReason, changed, reason, status, worktree }) => ({
      worktree,
      status: `confirmation required again: ${[
        reason,
        activeReason,
        changed ? 'worktree changes changed since the prior prompt' : 'included again because another target changed',
        !status.clean ? 'worktree has uncommitted changes that deletion will discard' : null,
      ].filter(Boolean).join('; ')}`,
    })),
  };
}

function confirmPendingRequest(requestId, options = {}) {
  const { file, request } = readPendingRequest(requestId, options);
  const inventory = getInventory({ cwd: request.repo, env: options.env });
  if (path.resolve(inventory.repo) !== path.resolve(request.repo) || inventory.repoName !== request.repoName) {
    fail('repository changed since the deletion request was created');
  }

  const worktrees = resolveTargets(inventory, request.targets.map((target) => target.path));
  if (worktrees.length !== request.targets.length) fail('worktree targets changed since the deletion request was created');
  const candidates = [];
  let statusChanged = false;
  for (const worktree of worktrees) {
    const expected = request.targets.find((target) => target.path === worktree.path);
    if (!expected || expected.branch !== worktree.branch) {
      fail(`worktree identity changed since the deletion request was created: ${worktree.path}`);
    }
    const status = worktreeStatus(worktree, options);
    const changed = status.hash !== expected.statusHash;
    if (changed) statusChanged = true;
    candidates.push({
      activeReason: expected.activeReason,
      changed,
      reason: expected.reason,
      status,
      worktree,
    });
  }
  if (statusChanged) {
    const result = reissueConfirmation(inventory, request, candidates, options);
    fs.unlinkSync(file);
    return result;
  }

  const results = worktrees.map((worktree) => {
    try {
      return { worktree, status: deleteWorktree(inventory, worktree, options) };
    } catch (error) {
      return { error: error.message, worktree, status: 'failed to delete worktree' };
    }
  });
  fs.unlinkSync(file);
  const failed = results.some((result) => result.error);
  let focusResult = null;
  if (request.inferred && !failed && worktrees[0]) {
    focusResult = focusNextWorkspace(inventory, worktrees[0], options);
  }
  return { focusResult, results };
}

function cancelPendingRequest(requestId, options = {}) {
  const { file, request } = readPendingRequest(requestId, options);
  fs.unlinkSync(file);
  return `Canceled deletion request ${requestId}; ${request.targets.length} worktree(s) left unchanged.`;
}

function format(inventory, results, requestId = null, focusResult = null) {
  const lines = [
    '## Close worktree',
    '',
    `Repository: ${JSON.stringify(inventory.repoName)}`,
    '',
    ...results.map(({ error, worktree, status }) => (
      `- ${JSON.stringify(worktree.name)}: ${status}${error ? ` - ${error}` : ''}`
    )),
  ];
  if (requestId) {
    lines.push(
      '',
      `Confirmation ID: ${requestId}`,
      'Reply yes to delete only the worktrees marked "confirmation required", or no to leave those unchanged.',
      'Deletion removes the worktree directory and ignored build output such as .next; the Git branches are preserved.',
    );
    if (results.some((result) => /uncommitted changes that deletion will discard/.test(result.status))) {
      lines.push('The listed worktree changes will be discarded if deletion is approved.');
    }
  }
  if (focusResult) {
    lines.push('', `- ${focusResult.status}${focusResult.error ? ` - ${focusResult.error}` : ''}`);
  }
  return lines.join('\n');
}

function formatConfirmationResults(results, focusResult = null, requestId = null) {
  const lines = [
    '## Worktree deletion',
    '',
    ...results.map(({ error, worktree, status }) => (
      `- ${JSON.stringify(worktree.name)}: ${status}${error ? ` - ${error}` : ''}`
    )),
  ];
  if (focusResult) lines.push('', `- ${focusResult.status}${focusResult.error ? ` - ${focusResult.error}` : ''}`);
  if (requestId) {
    lines.push(
      '',
      `Confirmation ID: ${requestId}`,
      'Reply yes to delete the listed worktrees, or no to leave them unchanged.',
      'The Git branches are preserved.',
    );
    if (results.some((result) => /uncommitted changes/.test(result.status))) {
      lines.push('The listed worktree changes will be discarded if deletion is approved.');
    }
  }
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseInvocation(argv);
  if (args.mode === 'cancel') {
    process.stdout.write(`${cancelPendingRequest(args.requestId)}\n`);
    return;
  }
  if (args.mode === 'confirm') {
    const outcome = confirmPendingRequest(args.requestId);
    process.stdout.write(`${formatConfirmationResults(outcome.results, outcome.focusResult, outcome.requestId)}\n`);
    if (outcome.results.some((result) => result.error) || outcome.focusResult?.failed) process.exitCode = 1;
    return;
  }

  const inventory = getInventory({ cwd: args.cwd, repo: args.repo });
  const targetSpec = inferCurrentTarget(inventory, args);
  const worktrees = resolveTargets(inventory, targetSpec.targets);
  validateTargets(worktrees);
  const outcome = decideWorktrees(inventory, worktrees, args, targetSpec.inferred);
  let focusResult = null;
  if (targetSpec.inferred && !outcome.requestId && worktrees[0]
    && outcome.results[0]?.status.startsWith('deleted ')) {
    focusResult = focusNextWorkspace(inventory, worktrees[0]);
  }
  process.stdout.write(`${format(inventory, outcome.results, outcome.requestId, focusResult)}\n`);
  if (outcome.results.some((result) => result.error) || focusResult?.failed) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  __test: {
    activeDeletionReason,
    cancelPendingRequest,
    confirmPendingRequest,
    decideWorktrees,
    describePullRequestStatus,
    deleteWorktree,
    format,
    formatConfirmationResults,
    focusNextWorkspace,
    inferCurrentTarget,
    main,
    nextWorkspaceToFocus,
    parseArgs,
    parseInvocation,
    pullRequestStatus,
    readPendingRequest,
    removeGitWorktree,
    validateTargets,
    worktreeStatus,
    writePendingRequest,
  },
};
