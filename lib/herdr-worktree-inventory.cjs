'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_HERDR = process.env.WORKTREE_HERDR_BIN || 'herdr';
const DEFAULT_WORKTREE_ROOT = process.env.WORKTREE_ROOT || path.join(os.homedir(), '.herdr', 'worktrees');

class InventoryError extends Error {}

function fail(message) {
  throw new InventoryError(message);
}

function tokenize(raw) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const character of String(raw || '')) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (quote) fail('unterminated quote in arguments');
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
    fail(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${description} returned invalid JSON: ${error.message}`);
  }
}

function herdrCommand(args, options = {}) {
  return run(options.herdrBin || options.env?.WORKTREE_HERDR_BIN || DEFAULT_HERDR, args, options);
}

function resolveRepository(cwd = process.cwd(), requestedRepo = null, env = process.env) {
  const candidate = path.resolve(requestedRepo || cwd);
  const repo = run('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], { env });
  const commonDir = run('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { env });
  const repoName = path.basename(path.dirname(commonDir));
  return { repo: path.resolve(repo), repoName };
}

function managedRoot(repoName, worktreeRoot = DEFAULT_WORKTREE_ROOT) {
  return path.resolve(worktreeRoot, repoName);
}

function sessionDirectory(worktreePath, sessionRoot = path.join(os.homedir(), '.omp', 'agent', 'sessions')) {
  const absolutePath = path.resolve(worktreePath);
  const relativeToHome = path.relative(os.homedir(), absolutePath);
  const sessionKey = relativeToHome.startsWith('..')
    ? path.relative(path.parse(absolutePath).root, absolutePath)
    : relativeToHome;
  return path.join(sessionRoot, `-${sessionKey.split(path.sep).join('-')}`);
}

function newestFileMtime(directory) {
  if (!fs.existsSync(directory)) return null;
  const pending = [directory];
  let newest = null;
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      let stat;
      try {
        stat = fs.statSync(absolute);
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (stat.isFile() && (newest === null || stat.mtimeMs > newest)) {
        newest = stat.mtimeMs;
      }
    }
  }
  return newest;
}

function lastActiveAt(worktreePath, sessionRoot) {
  return newestFileMtime(sessionDirectory(worktreePath, sessionRoot));
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function unwrap(payload, key, description) {
  const value = payload?.result?.[key];
  if (value === undefined) fail(`${description} response missing result.${key}`);
  return value;
}

function getInventory(options = {}) {
  const env = options.env || process.env;
  const { repo, repoName } = resolveRepository(options.cwd, options.repo, env);
  const root = managedRoot(repoName, options.worktreeRoot || env.WORKTREE_ROOT);
  const worktreePayload = parseJson(
    herdrCommand(['worktree', 'list', '--cwd', repo, '--json'], options),
    'herdr worktree list',
  );
  const workspacePayload = parseJson(
    herdrCommand(['workspace', 'list'], options),
    'herdr workspace list',
  );
  const allWorktrees = unwrap(worktreePayload, 'worktrees', 'herdr worktree list');
  const workspaces = unwrap(workspacePayload, 'workspaces', 'herdr workspace list');
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.workspace_id, workspace]));
  const sourcePath = worktreePayload.result.source?.source_checkout_path
    ? path.resolve(worktreePayload.result.source.source_checkout_path)
    : repo;
  const sessionRoot = options.sessionRoot || env.OMP_AGENT_SESSIONS;

  const records = allWorktrees.map((worktree) => {
    const worktreePath = path.resolve(worktree.path || '');
    const workspaceId = worktree.open_workspace_id || null;
    const workspace = workspaceId ? workspaceById.get(workspaceId) : null;
    const linked = worktree.is_linked_worktree === true;
    const managed = linked && isWithin(root, worktreePath);
    const primary = worktreePath === sourcePath || !linked;
    const open = Boolean(workspaceId || workspace);
    return {
      branch: worktree.branch || '',
      focused: Boolean(workspace?.focused),
      isPrunable: Boolean(worktree.is_prunable),
      label: worktree.label || '',
      managed,
      name: path.basename(worktreePath),
      open,
      path: worktreePath,
      lastActiveAt: managed ? lastActiveAt(worktreePath, sessionRoot) : null,
      primary,
      status: workspace?.agent_status || null,
      workspaceId: workspaceId || workspace?.workspace_id || null,
      linked,
    };
  });

  const managedWorktrees = records
    .filter((record) => record.managed && !record.primary)
    .map((record) => ({
      ...record,
      state: record.isPrunable ? 'PRUNABLE' : record.open ? 'OPEN' : 'PARKED',
    }))
    .sort((left, right) => {
      if (left.lastActiveAt !== null || right.lastActiveAt !== null) {
        if (left.lastActiveAt === null) return 1;
        if (right.lastActiveAt === null) return -1;
        if (left.lastActiveAt !== right.lastActiveAt) return right.lastActiveAt - left.lastActiveAt;
      }
      const leftKey = left.branch || left.name;
      const rightKey = right.branch || right.name;
      return leftKey.localeCompare(rightKey);
    });

  return {
    repo,
    repoName,
    managedRoot: root,
    primaryPath: sourcePath,
    allWorktrees: records,
    worktrees: managedWorktrees,
  };
}

function matchingRecords(inventory, target) {
  const normalizedTarget = path.isAbsolute(target) ? path.resolve(target) : null;
  return inventory.allWorktrees.filter((record) => (
    record.name === target
    || record.branch === target
    || (normalizedTarget && record.path === normalizedTarget)
  ));
}

function resolveTarget(inventory, target) {
  if (!target || target.startsWith('--')) fail('worktree target must not be empty');
  const matches = matchingRecords(inventory, target);
  if (matches.length === 0) fail(`worktree target not found: ${target}`);
  if (matches.length > 1) {
    const paths = matches.map((record) => record.path).join(', ');
    fail(`worktree target is ambiguous: ${target}; matches: ${paths}`);
  }
  const record = matches[0];
  if (!record.managed || record.primary || !record.linked) {
    fail(`worktree is not a managed Herdr linked worktree: ${record.path}`);
  }
  if (record.isPrunable) fail(`worktree is prunable and cannot be opened or closed: ${record.path}`);
  return inventory.worktrees.find((candidate) => candidate.path === record.path) || record;
}

function resolveTargets(inventory, targets) {
  const resolved = [];
  const seen = new Set();
  for (const target of targets) {
    const record = resolveTarget(inventory, target);
    if (seen.has(record.path)) continue;
    seen.add(record.path);
    resolved.push(record);
  }
  return resolved;
}

module.exports = {
  InventoryError,
  DEFAULT_HERDR,
  getInventory,
  herdrCommand,
  isWithin,
  managedRoot,
  lastActiveAt,
  newestFileMtime,
  parseJson,
  resolveRepository,
  resolveTarget,
  resolveTargets,
  sessionDirectory,
  tokenize,
};
