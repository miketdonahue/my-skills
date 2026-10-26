#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const RUNS_ROOT = path.resolve(process.env.FEATURE_RUNS_ROOT || path.join(HOME, '.omp', 'workflow-runs', 'feature'));
const WORKTREES_ROOT = path.resolve(process.env.FEATURE_WORKTREES_ROOT || path.join(HOME, '.herdr', 'worktrees'));
const ENV_GUARD_SCRIPT = '/Users/michael/.omp/agent/lib/worktree-env-guard.cjs';
const LOCK_FILE = 'lock.json';
const MAX_REPAIR_CYCLES = 1;
const MAX_REVIEW_PASSES = 2;
const COMMENT_AUDIT_EXTENSIONS = /\.(?:c|m)?(?:j|t)sx?$/;
const COMMENT_AUDIT_MAX_LINES = 6;
const COMMENT_AUDIT_MAX_CHARS = 600;

const STATES = Object.freeze({
  admitted: ['worktree.ready', 'report.ready', 'cancelled'],
  'worktree.ready': ['context.ready', 'report.ready', 'cancelled'],
  'context.ready': ['implementing', 'verification.ready', 'report.ready', 'cancelled'],
  implementing: ['verification.ready', 'report.ready', 'cancelled'],
  'verification.ready': ['qa.ready', 'report.ready', 'cancelled'],
  'qa.ready': ['review.ready', 'fixing', 'report.ready', 'cancelled'],
  'review.ready': ['fixing', 'publish.ready', 'report.ready', 'cancelled'],
  fixing: ['verification.ready', 'report.ready', 'cancelled'],
  'publish.ready': ['complete', 'report.ready', 'cancelled'],
  'report.ready': ['review.ready', 'publish.ready', 'complete', 'cancelled'],
  complete: [],
  blocked: ['report.ready', 'publish.ready'],
  cancelled: [],
});

function fail(message) { throw new Error(message); }
function now() { return new Date().toISOString(); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function sha256File(file) { return sha256(fs.readFileSync(file)); }
function slug(value, fallback = 'value') {
  const result = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return result || fallback;
}
function ticketBranch(ticket) {
  return String(ticket || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function mkdir(directory) { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
function writeAtomic(file, value) {
  mkdir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function appendJsonl(file, value) {
  mkdir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail(`Missing or malformed JSON: ${file}`); }
}
function maybeReadJson(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}
function run(args, options = {}) {
  try {
    return childProcess.execFileSync(args[0], args.slice(1), {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', options.stderr || 'pipe'],
      env: options.env || process.env,
    }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    fail(stderr || error.message);
  }
}
function maybeRun(args, options = {}) {
  try {
    return { ok: true, stdout: run(args, options) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
function option(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) {
    if (required) fail(`Missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}
function rawOption(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    if (required) fail(`Missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}
function repoRoot(cwd) {
  return run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']);
}
function repoName(root) {
  return path.basename(root);
}
function linkedWorktreeInfo(cwd) {
  const root = repoRoot(cwd);
  const gitDir = run(['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-dir']);
  const gitCommon = run(['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  const superproject = maybeRun(['git', '-C', root, 'rev-parse', '--show-superproject-working-tree']);
  if (gitDir === gitCommon || (superproject.ok && superproject.stdout)) return null;
  const branch = run(['git', '-C', root, 'branch', '--show-current']);
  if (!branch) fail('Error: current linked worktree is detached; check out a feature branch before running /feature.');
  const status = run(['git', '-C', root, 'status', '--porcelain']);
  if (status) fail(`Error: current linked worktree is dirty. Commit or stash changes before running /feature: ${root}`);
  return { root, branch, head: run(['git', '-C', root, 'rev-parse', 'HEAD']) };
}
function manifestPath(runDir) {
  return path.join(runDir, 'manifest.json');
}
function eventsPath(runDir) {
  return path.join(runDir, 'events.jsonl');
}
function reviewRemaindersPath(runDir) {
  return path.join(runDir, 'receipts', 'review-remainders.json');
}
function remainingWorkPath(runDir) {
  return path.join(runDir, 'receipts', 'remaining-work.json');
}
function finalReportPath(runDir) {
  return path.join(runDir, 'receipts', 'final-report.json');
}
function runDirFor(project, runId) {
  return path.join(RUNS_ROOT, slug(project, 'repo'), runId);
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
  if (quote) fail('Error: unterminated quote in arguments.');
  if (current) tokens.push(current);
  return tokens;
}
function parseInvocation(raw) {
  const tokens = tokenize(raw);
  const ticketIndex = tokens.indexOf('--ticket');
  if (ticketIndex < 0) fail('Error: --ticket is required.');
  if (ticketIndex + 1 >= tokens.length || tokens[ticketIndex + 1].startsWith('--')) fail('Error: --ticket requires a value.');
  if (tokens.indexOf('--ticket', ticketIndex + 1) >= 0) fail('Error: --ticket may be provided only once.');
  const planIndex = tokens.indexOf('--plan');
  let plan = null;
  if (planIndex >= 0) {
    if (planIndex + 1 >= tokens.length || tokens[planIndex + 1].startsWith('--')) fail('Error: --plan requires a single .md plan file path.');
    if (tokens.indexOf('--plan', planIndex + 1) >= 0) fail('Error: --plan may be provided only once.');
    plan = tokens[planIndex + 1];
  }
  const consumed = new Set([ticketIndex, ticketIndex + 1]);
  if (planIndex >= 0) {
    consumed.add(planIndex);
    consumed.add(planIndex + 1);
  }
  const extras = tokens.filter((_, index) => !consumed.has(index));
  if (extras.length) fail('Error: /feature accepts only --ticket <value> and optional --plan <plan.md>.');
  return { ticket: tokens[ticketIndex + 1], plan };
}
function detectProvider(ticket) {
  const value = String(ticket || '');
  if (/linear\.app/i.test(value)) return 'linear';
  if (/atlassian\.net|browse\//i.test(value)) return 'jira';
  if (/^[A-Za-z]+-\d+$/.test(value)) return 'unresolved';
  return 'unresolved';
}
function acquire(runDir, command) {
  mkdir(runDir);
  const file = path.join(runDir, LOCK_FILE);
  const value = { pid: process.pid, hostname: os.hostname(), command, acquiredAt: now() };
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fs.closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const current = readJson(file);
    if (current.hostname !== os.hostname()) fail(`Workflow is locked on host ${current.hostname}`);
    try {
      process.kill(current.pid, 0);
      fail(`Workflow is already locked by PID ${current.pid}`);
    } catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
      fs.unlinkSync(file);
      return acquire(runDir, command);
    }
  }
  return () => {
    try {
      const current = readJson(file);
      if (current.pid !== process.pid) fail('Workflow lock ownership changed');
      fs.unlinkSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };
}
function manifestFromArg(args) {
  const explicit = option(args, '--manifest', false);
  if (explicit) return path.resolve(explicit);
  const runDir = option(args, '--run-dir', false);
  if (runDir) return manifestPath(path.resolve(runDir));
  fail('Missing required option: --manifest or --run-dir');
}
function loadManifestFromArg(args) {
  const file = manifestFromArg(args);
  return { file, runDir: path.dirname(file), manifest: readJson(file) };
}
function saveManifest(runDir, manifest, event) {
  if (event) appendJsonl(eventsPath(runDir), event);
  writeAtomic(manifestPath(runDir), manifest);
  return manifest;
}
function transitionTo(runDir, to, patch = {}, reason = null) {
  const current = readJson(manifestPath(runDir));
  if (!STATES[current.state] || !STATES[current.state].includes(to)) fail(`Illegal workflow transition: ${current.state} -> ${to}`);
  const event = { eventId: crypto.randomUUID(), at: now(), from: current.state, to, reason, patch };
  return saveManifest(runDir, { ...current, ...patch, state: to, updatedAt: event.at, lastEventId: event.eventId }, event);
}
function transitionToReportReady(runDir, reason, patch = {}) {
  const current = readJson(manifestPath(runDir));
  if (current.state === 'complete' || current.state === 'report.ready') return current;
  if (current.state === 'cancelled') return current;
  if (!STATES[current.state] || !STATES[current.state].includes('report.ready')) fail(`Cannot move workflow to report.ready from state ${current.state}.`);
  return transitionTo(runDir, 'report.ready', patch, reason);
}
function remainingWorkItem(phase, kind, status, reason, extra = {}) {
  return { phase, kind, status, reason, ...extra };
}
function remainingWorkKey(item) {
  return JSON.stringify({
    phase: item.phase || null,
    kind: item.kind || null,
    file: item.file || null,
    reason: item.reason || null,
  });
}
function writeRemainingWork(runDir, manifest, items, reason) {
  const existing = maybeReadJson(remainingWorkPath(runDir));
  const merged = new Map();
  for (const item of existing?.data?.items || []) merged.set(remainingWorkKey(item), item);
  for (const item of items || []) merged.set(remainingWorkKey(item), item);
  return replaceRemainingWork(runDir, manifest, [...merged.values()], reason);
}
function replaceRemainingWork(runDir, manifest, items, reason) {
  const recordedAt = now();
  const value = {
    schemaVersion: 1,
    workflow: 'feature',
    runId: manifest.runId,
    phase: 'remaining-work',
    status: items.length ? 'RECORDED' : 'PASS',
    reviewedSha: manifest.currentHEAD || null,
    recordedAt,
    reason,
    data: { items },
  };
  writeAtomic(remainingWorkPath(runDir), value);
  appendJsonl(eventsPath(runDir), { eventId: crypto.randomUUID(), at: recordedAt, type: 'receipt', phase: 'remaining-work', status: value.status, count: value.data.items.length });
  return value;
}
function removeRemainingWork(runDir, manifest, predicate, reason) {
  const existing = maybeReadJson(remainingWorkPath(runDir));
  if (!existing) return null;
  const items = (existing.data?.items || []).filter((item) => !predicate(item));
  if (items.length === (existing.data?.items || []).length) return existing;
  return replaceRemainingWork(runDir, manifest, items, reason);
}
function receiptFor(runDir, phase) {
  return maybeReadJson(path.join(runDir, 'receipts', `${phase}.json`));
}
function admit(args) {
  const cwd = path.resolve(option(args, '--cwd', false) || process.cwd());
  const parsed = parseInvocation(rawOption(args, '--arguments'));
  const root = repoRoot(cwd);
  const project = repoName(root);
  const ticket = parsed.ticket.trim();
  const reusedWorktree = linkedWorktreeInfo(cwd);
  const branch = reusedWorktree ? reusedWorktree.branch : ticketBranch(ticket);
  if (!branch) fail('Error: ticket value cannot be normalized into a branch name.');
  let planPath = null;
  let sourceHash;
  if (parsed.plan) {
    planPath = path.resolve(cwd, parsed.plan);
    if (!planPath.endsWith('.md')) fail('Error: plan file must end in .md.');
    if (!fs.existsSync(planPath) || !fs.statSync(planPath).isFile()) fail(`Error: plan file was not found or is not readable: ${planPath}`);
    sourceHash = sha256File(planPath);
  } else {
    sourceHash = sha256(`ticket:${ticket}`);
  }
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${slug(branch, 'ticket')}-${crypto.randomBytes(3).toString('hex')}`;
  const runDir = runDirFor(project, runId);
  if (fs.existsSync(runDir)) fail(`Workflow run already exists: ${runId}`);
  mkdir(path.join(runDir, 'receipts', 'reviews'));
  const createdAt = now();
  const manifest = {
    schemaVersion: 1,
    workflow: 'feature',
    runId,
    state: 'admitted',
    ticket,
    ticketProvider: detectProvider(ticket),
    planPath,
    sourceHash,
    repoRoot: root,
    project,
    branch,
    worktree: reusedWorktree ? reusedWorktree.root : null,
    baseSHA: null,
    currentHEAD: reusedWorktree ? reusedWorktree.head : null,
    reuseWorktree: Boolean(reusedWorktree),
    attempts: { repairCycles: 0, reviewCycles: 0, reviewPasses: 0 },
    blockers: [],
    createdAt,
    updatedAt: createdAt,
  };
  const release = acquire(runDir, 'admit');
  try {
    saveManifest(runDir, manifest, { eventId: crypto.randomUUID(), at: createdAt, from: null, to: 'admitted', patch: manifest });
    return { runId, runDir, manifestPath: manifestPath(runDir), ...launcherFields(manifest) };
  } finally {
    release();
  }
}
function launcherFields(manifest) {
  return {
    ticket: manifest.ticket,
    ticketProvider: manifest.ticketProvider,
    planPath: manifest.planPath || '(none)',
    sourceHash: manifest.sourceHash,
    workingDirectory: manifest.worktree || '(none)',
    branch: manifest.branch,
    baseSHA: manifest.baseSHA || '(none)',
  };
}
function currentWorktreeForBranch(repo, branch) {
  const output = maybeRun(['git', '-C', repo, 'worktree', 'list', '--porcelain']);
  if (!output.ok) return null;
  let current = null;
  for (const line of output.stdout.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}
function hasLocalBranch(repo, branch) {
  return maybeRun(['git', '-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
}
function hasRemoteBranch(repo, branch) {
  return maybeRun(['git', '-C', repo, 'ls-remote', '--exit-code', '--heads', 'origin', branch]).ok;
}
function herdrEnabled() {
  return process.env.FEATURE_DISABLE_HERDR !== '1';
}
function createLinkedWorktree(repo, branch, target) {
  if (herdrEnabled()) {
    const herdr = maybeRun([
      'herdr',
      'worktree',
      'create',
      '--cwd',
      repo,
      '--branch',
      branch,
      '--base',
      'origin/main',
      '--path',
      target,
      '--label',
      branch,
      '--no-focus',
      '--json',
    ]);
    if (herdr.ok) return;
  }
  run(['git', '-C', repo, 'worktree', 'add', '-b', branch, target, 'origin/main'], { stderr: 'pipe' });
}
function guardWorktreeEnv(worktree) {
  const args = [process.execPath, ENV_GUARD_SCRIPT, '--worktree', worktree, '--json'];
  if (process.env.FEATURE_ENV_SOURCE) args.push('--source', process.env.FEATURE_ENV_SOURCE);
  return JSON.parse(run(args));
}
function createWorktree(args) {
  const { runDir, manifest } = loadManifestFromArg(args);
  const release = acquire(runDir, 'create-worktree');
  try {
    const current = readJson(manifestPath(runDir));
    if (current.state === 'worktree.ready' && current.worktree && fs.existsSync(current.worktree)) {
      guardWorktreeEnv(current.worktree);
      return { runId: current.runId, runDir, manifestPath: manifestPath(runDir), ...launcherFields(current) };
    }
    if (current.state !== 'admitted') fail(`Cannot create worktree from state ${current.state}`);
    if (current.reuseWorktree) {
      const status = run(['git', '-C', current.worktree, 'status', '--porcelain']);
      if (status) fail(`Error: current linked worktree became dirty: ${current.worktree}`);
      run(['git', '-C', current.worktree, 'fetch', '--quiet', 'origin', 'main:refs/remotes/origin/main']);
      const baseSHA = run(['git', '-C', current.worktree, 'merge-base', 'HEAD', 'origin/main']);
      const head = run(['git', '-C', current.worktree, 'rev-parse', 'HEAD']);
      const envGuard = guardWorktreeEnv(current.worktree);
      const next = transitionTo(runDir, 'worktree.ready', { baseSHA, currentHEAD: head, envGuard }, 'existing-worktree-reused');
      return { runId: next.runId, runDir, manifestPath: manifestPath(runDir), ...launcherFields(next) };
    }
    const branch = current.branch;
    const repo = current.repoRoot;
    const existing = currentWorktreeForBranch(repo, branch);
    if (existing) fail(`Error: branch already exists in worktree: ${existing}`);
    if (hasLocalBranch(repo, branch)) fail(`Error: branch already exists locally: ${branch}`);
    if (hasRemoteBranch(repo, branch)) fail(`Error: branch already exists remotely: ${branch}`);
    run(['git', '-C', repo, 'fetch', '--quiet', 'origin', 'main:refs/remotes/origin/main']);
    const baseSHA = run(['git', '-C', repo, 'rev-parse', 'origin/main']);
    const root = path.join(WORKTREES_ROOT, current.project);
    const target = path.join(root, branch);
    if (fs.existsSync(target)) fail(`Error: worktree path already exists: ${target}`);
    mkdir(root);
    createLinkedWorktree(repo, branch, target);
    const head = run(['git', '-C', target, 'rev-parse', 'HEAD']);
    const envGuard = guardWorktreeEnv(target);
    const next = transitionTo(runDir, 'worktree.ready', { worktree: target, baseSHA, currentHEAD: head, envGuard }, 'worktree-created');
    return { runId: next.runId, runDir, manifestPath: manifestPath(runDir), ...launcherFields(next) };
  } finally {
    release();
  }
}
function transitionCommand(args) {
  const { runDir } = loadManifestFromArg(args);
  const release = acquire(runDir, 'transition');
  try {
    return transitionTo(runDir, option(args, '--to'), JSON.parse(option(args, '--patch', false) || '{}'), option(args, '--reason', false));
  } finally {
    release();
  }
}
function receipt(args) {
  const { runDir, manifest } = loadManifestFromArg(args);
  const phase = option(args, '--phase');
  const status = option(args, '--status');
  const data = JSON.parse(option(args, '--data', false) || '{}');
  const release = acquire(runDir, `receipt:${phase}`);
  try {
    const current = readJson(manifestPath(runDir));
    const value = {
      schemaVersion: 1,
      workflow: 'feature',
      runId: current.runId,
      phase,
      status,
      reviewedSha: data.reviewedSha || current.currentHEAD || null,
      recordedAt: now(),
      data,
    };
    writeAtomic(path.join(runDir, 'receipts', `${phase}.json`), value);
    appendJsonl(eventsPath(runDir), { eventId: crypto.randomUUID(), at: value.recordedAt, type: 'receipt', phase, status });
    return value;
  } finally {
    release();
  }
}
function block(args) {
  const { runDir } = loadManifestFromArg(args);
  const phase = option(args, '--phase');
  const reason = option(args, '--reason');
  const release = acquire(runDir, 'block');
  try {
    const current = readJson(manifestPath(runDir));
    const blocker = { phase, reason, at: now() };
    writeRemainingWork(runDir, current, [
      remainingWorkItem(phase, 'phase_blocked', 'BLOCKED', reason, { at: blocker.at }),
    ], reason);
    return transitionToReportReady(runDir, reason, { blockers: [...(current.blockers || []), blocker] });
  } finally {
    release();
  }
}
function repairCycle(args) {
  const { runDir } = loadManifestFromArg(args);
  const phase = option(args, '--phase');
  if (!['qa', 'review'].includes(phase)) fail('Repair phase must be qa or review.');
  const release = acquire(runDir, `repair-cycle:${phase}`);
  try {
    const current = readJson(manifestPath(runDir));
    const expectedState = phase === 'qa' ? 'qa.ready' : 'review.ready';
    if (current.state !== expectedState) fail(`Cannot start ${phase} repair from state ${current.state}; expected ${expectedState}.`);
    const attempts = { repairCycles: 0, reviewCycles: 0, reviewPasses: 0, ...(current.attempts || {}) };
    if (attempts.repairCycles >= MAX_REPAIR_CYCLES) fail(`Repair cycle limit reached: ${MAX_REPAIR_CYCLES} total QA/review repair cycle.`);
    attempts.repairCycles += 1;
    if (phase === 'review') attempts.reviewCycles += 1;
    const at = now();
    const event = { eventId: crypto.randomUUID(), at, type: 'repair-cycle', phase, cycle: attempts.repairCycles };
    saveManifest(runDir, { ...current, attempts, updatedAt: at, lastEventId: event.eventId }, event);
    return { status: 'PASS', phase, cycle: attempts.repairCycles, remaining: MAX_REPAIR_CYCLES - attempts.repairCycles };
  } finally {
    release();
  }
}
function parseDiff(output) {
  const files = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      current = { file: null, status: 'modified', changedLines: [], hunks: [] };
    } else if (current && line.startsWith('+++ b/')) {
      current.file = line.slice(6);
    } else if (current && line.startsWith('deleted file mode')) {
      current.status = 'deleted';
    } else if (current && line.startsWith('new file mode')) {
      current.status = 'added';
    } else if (current && line.startsWith('@@ ')) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      const start = match ? Number(match[1]) : null;
      const count = match ? Number(match[2] || '1') : 0;
      const lines = [];
      if (start !== null && count > 0) {
        for (let index = 0; index < count; index += 1) lines.push(start + index);
        current.changedLines.push(...lines);
      }
      current.hunks.push({ header: line, changedLines: lines });
    } else if (current && current.hunks.length) {
      current.hunks[current.hunks.length - 1].text = `${current.hunks[current.hunks.length - 1].text || ''}${line}\n`;
    }
  }
  if (current) files.push(current);
  return files.filter((file) => file.file).map((file) => ({
    ...file,
    changedLines: [...new Set(file.changedLines)].sort((a, b) => a - b),
  }));
}

function lineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function lineNumber(starts, index) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= index) low = middle + 1;
    else high = middle;
  }
  return low;
}

function isIdentifierCharacter(character) {
  return Boolean(character) && /[A-Za-z0-9_$]/.test(character);
}

function slashStartsRegex(lastToken) {
  return !lastToken || [
    '(', '{', '[', '=', ':', ',', ';', '!', '?', '&', '|', '=>',
    'return', 'case', 'throw', 'else', 'do', 'in', 'of', 'yield',
  ].includes(lastToken);
}

function scanJavaScriptComments(source) {
  const comments = [];
  const starts = lineStarts(source);
  let state = 'code';
  let commentStart = -1;
  let commentKind = null;
  let escaped = false;
  let regexClass = false;
  let lastToken = null;

  function addComment(end) {
    const raw = source.slice(commentStart, end);
    const startLine = lineNumber(starts, commentStart);
    const endLine = lineNumber(starts, Math.max(commentStart, end - 1));
    comments.push({
      kind: commentKind,
      start: commentStart,
      end,
      startLine,
      endLine,
      text: raw,
    });
    commentStart = -1;
    commentKind = null;
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === 'single' || state === 'double' || state === 'template') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if ((state === 'single' && character === "'")
        || (state === 'double' && character === '"')
        || (state === 'template' && character === '`')) {
        state = 'code';
        lastToken = 'literal';
      }
      continue;
    }

    if (state === 'regex') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '[') {
        regexClass = true;
        continue;
      }
      if (character === ']' && regexClass) {
        regexClass = false;
        continue;
      }
      if (character === '/' && !regexClass) {
        state = 'code';
        lastToken = 'literal';
      }
      continue;
    }

    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') {
        addComment(index);
        state = 'code';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        addComment(index + 2);
        index += 1;
        state = 'code';
      }
      continue;
    }

    if (character === "'") {
      state = 'single';
      escaped = false;
      continue;
    }
    if (character === '"') {
      state = 'double';
      escaped = false;
      continue;
    }
    if (character === '`') {
      state = 'template';
      escaped = false;
      continue;
    }
    if (character === '/' && next === '/') {
      commentStart = index;
      commentKind = 'line';
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      commentStart = index;
      commentKind = source[index + 2] === '*' ? 'tsdoc' : 'block';
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (character === '/' && slashStartsRegex(lastToken)) {
      state = 'regex';
      regexClass = false;
      escaped = false;
      continue;
    }
    if (isIdentifierCharacter(character)) {
      let end = index + 1;
      while (isIdentifierCharacter(source[end])) end += 1;
      lastToken = source.slice(index, end);
      index = end - 1;
      continue;
    }
    if (!/\s/.test(character)) {
      lastToken = character;
    }
  }

  if (state === 'line-comment') addComment(source.length);
  if (state === 'block-comment') addComment(source.length);
  return comments;
}

function commentIntersectsChangedLines(comment, changedLines) {
  if (!changedLines || changedLines.length === 0) return true;
  const changed = new Set(changedLines);
  for (let line = comment.startLine; line <= comment.endLine; line += 1) {
    if (changed.has(line)) return true;
  }
  return false;
}

function nextMeaningfulLine(source, line) {
  const lines = source.split(/\r?\n/);
  for (let index = line; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (value) return value;
  }
  return '';
}

function isFunctionOrClassDefinition(line) {
  const declaration = line.replace(/^(?:export\s+)?(?:default\s+)?/, '');
  if (/^(?:declare\s+|abstract\s+)?(?:async\s+)?(?:function|class)\b/.test(declaration)) return true;
  return /^(?:(?:public|private|protected|static|abstract|override|async|get|set)\s+)*[A-Za-z_$][\w$]*(?:<[^>]+>)?\s*\(/.test(declaration);
}

function commentMetadataPattern(text) {
  return /\b(?:ACTION|JIRA|TICKET|ISSUE|PROJ|ENG)-\d+\b/i.test(text)
    || /\bPR\s*#?\s*\d+\b/i.test(text)
    || /@(?:author|owner|contributor|reviewer)\b/i.test(text)
    || /\b(?:co-authored-by|authored-by|generated-by|written-by)\b/i.test(text)
    || /\b(?:ai-generated|generated by (?:openai|chatgpt|claude|codex)|chatgpt|openai|claude|codex)\b/i.test(text);
}

function auditJavaScriptComments(source, changedLines = null) {
  const violations = [];
  const comments = scanJavaScriptComments(source);
  for (const comment of comments) {
    if (!commentIntersectsChangedLines(comment, changedLines)) continue;
    if (comment.kind !== 'tsdoc') {
      violations.push({
        line: comment.startLine,
        rule: 'comment-policy',
        issue: 'Only concise TSDoc directly above a function or class definition is allowed; remove this comment.',
      });
      continue;
    }

    const followingLine = nextMeaningfulLine(source, comment.endLine);
    if (!isFunctionOrClassDefinition(followingLine)) {
      violations.push({
        line: comment.startLine,
        rule: 'comment-policy',
        issue: 'TSDoc is allowed only directly above a function or class definition.',
      });
    }

    const content = comment.text
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .replace(/^\s*\* ?/gm, '')
      .trim();
    const contentLines = content ? content.split(/\r?\n/).filter((line) => line.trim()).length : 0;
    if (content.length > COMMENT_AUDIT_MAX_CHARS || contentLines > COMMENT_AUDIT_MAX_LINES) {
      violations.push({
        line: comment.startLine,
        rule: 'comment-policy',
        issue: `TSDoc must stay concise (maximum ${COMMENT_AUDIT_MAX_LINES} non-empty lines or ${COMMENT_AUDIT_MAX_CHARS} characters).`,
      });
    }
    if (commentMetadataPattern(content)) {
      violations.push({
        line: comment.startLine,
        rule: 'comment-policy',
        issue: 'Source comments must not contain ticket, PR, author, or AI-attribution metadata.',
      });
    }
  }
  return violations;
}

function commentAuditEntries(worktree, entries) {
  const violations = [];
  const auditedFiles = [];
  for (const entry of entries) {
    if (entry.status === 'deleted' || !COMMENT_AUDIT_EXTENSIONS.test(entry.file)) continue;
    if (entry.file.startsWith('backend/') || entry.file.startsWith('frontend/')) continue;
    const filePath = path.join(worktree, entry.file);
    if (!fs.existsSync(filePath)) continue;
    const fileViolations = auditJavaScriptComments(fs.readFileSync(filePath, 'utf8'), entry.changedLines);
    auditedFiles.push(entry.file);
    for (const violation of fileViolations) violations.push({ file: entry.file, ...violation });
  }
  return {
    status: violations.length ? 'FAIL' : 'PASS',
    files: auditedFiles,
    violations,
  };
}

function workingTreeDiffScope(manifest) {
  const head = run(['git', '-C', manifest.worktree, 'rev-parse', 'HEAD']);
  const output = run(['git', '-C', manifest.worktree, 'diff', '--no-color', '--unified=0', manifest.baseSHA]);
  const files = parseDiff(output);
  const tracked = new Set(files.map((file) => file.file));
  const untrackedOutput = run(['git', '-C', manifest.worktree, 'ls-files', '--others', '--exclude-standard']);
  for (const file of untrackedOutput.split('\n').filter(Boolean)) {
    if (tracked.has(file)) continue;
    const filePath = path.join(manifest.worktree, file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    const lineCount = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).length;
    files.push({ file, status: 'added', changedLines: Array.from({ length: lineCount }, (_, index) => index + 1), hunks: [] });
  }
  return { baseSHA: manifest.baseSHA, head, files };
}

function commentAudit(args) {
  const { runDir, manifest } = loadManifestFromArg(args);
  const scope = args.includes('--working-tree') ? workingTreeDiffScope(manifest) : diffScope(args);
  const audit = commentAuditEntries(manifest.worktree, scope.files);
  return {
    status: audit.status,
    phase: 'comment-audit',
    workingTree: args.includes('--working-tree'),
    reviewedSha: scope.head,
    files: audit.files,
    violations: audit.violations,
    runDir,
  };
}
function diffScope(args) {
  const { runDir } = loadManifestFromArg(args);
  const manifest = readJson(manifestPath(runDir));
  if (!manifest.worktree || !manifest.baseSHA) fail('Worktree and baseSHA are required for diff scope');
  const head = run(['git', '-C', manifest.worktree, 'rev-parse', 'HEAD']);
  const output = run(['git', '-C', manifest.worktree, 'diff', '--no-color', '--unified=0', `${manifest.baseSHA}...${head}`]);
  const files = parseDiff(output);
  const release = acquire(runDir, 'diff-scope');
  try {
    const current = readJson(manifestPath(runDir));
    saveManifest(runDir, { ...current, currentHEAD: head, updatedAt: now() }, { eventId: crypto.randomUUID(), at: now(), type: 'diff-scope', head, files: files.map((file) => file.file) });
    writeAtomic(path.join(runDir, 'receipts', 'diff-scope.json'), { status: 'PASS', head, baseSHA: manifest.baseSHA, files, recordedAt: now() });
    return { baseSHA: manifest.baseSHA, head, files };
  } finally {
    release();
  }
}

function runCheck(command, args, cwd, timeoutMs = 120000) {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (result.error) {
    return {
      status: result.error.code === 'ETIMEDOUT' ? 'BLOCKED' : 'BLOCKED',
      command: [command, ...args].join(' '),
      evidence: output || result.error.message,
    };
  }
  return {
    status: result.status === 0 ? 'PASS' : 'FAIL',
    command: [command, ...args].join(' '),
    evidence: output.slice(-4000),
  };
}

function styleGate(args) {
  const { runDir } = loadManifestFromArg(args);
  const manifest = readJson(manifestPath(runDir));
  const scope = diffScope(args);
  const files = scope.files.filter((entry) => entry.status !== 'deleted').map((entry) => entry.file);
  const checks = [runCheck('git', ['-C', manifest.worktree, 'diff', '--check', `${scope.baseSHA}...${scope.head}`], manifest.worktree)];
  const commentAudit = commentAuditEntries(manifest.worktree, scope.files);
  if (commentAudit.files.length > 0) {
    checks.push({
      status: commentAudit.status,
      command: 'feature comment policy audit',
      evidence: commentAudit.status === 'PASS'
        ? `Audited ${commentAudit.files.length} changed JavaScript/TypeScript file(s).`
        : commentAudit.violations.map((violation) => `${violation.file}:${violation.line} ${violation.issue}`).join('\n'),
      kind: 'comment-policy',
      violations: commentAudit.violations,
    });
  }
  const frontendFiles = files.filter((file) => file.startsWith('frontend/') && /\.(?:c|m)?(?:j|t)sx?$/.test(file));
  const frontendRoot = path.join(manifest.worktree, 'frontend');
  if (frontendFiles.length > 0) {
    if (!fs.existsSync(path.join(frontendRoot, 'package.json'))) {
      checks.push({ status: 'BLOCKED', command: 'frontend package checks', evidence: 'frontend/package.json is missing.' });
    } else {
      const relativeFiles = frontendFiles.map((file) => path.relative(frontendRoot, path.join(manifest.worktree, file)));
      checks.push(runCheck('pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', ...relativeFiles], frontendRoot));
      checks.push(runCheck('pnpm', ['exec', 'eslint', ...relativeFiles], frontendRoot));
    }
  }
  const gatewayFiles = files.filter((file) => file.startsWith('gateway/') && /\.(?:c|m)?(?:j|t)sx?$/.test(file));
  const gatewayRoot = path.join(manifest.worktree, 'gateway');
  if (gatewayFiles.length > 0) {
    if (!fs.existsSync(path.join(gatewayRoot, 'package.json'))) {
      checks.push({ status: 'BLOCKED', command: 'gateway package checks', evidence: 'gateway/package.json is missing.' });
    } else {
      checks.push(runCheck('bun', ['run', 'lint', '--', ...gatewayFiles.map((file) => path.relative(gatewayRoot, path.join(manifest.worktree, file)))], gatewayRoot));
    }
  }
  const backendFiles = files.filter((file) => file.startsWith('backend/') && file.endsWith('.py'));
  if (backendFiles.length > 0) {
    checks.push(runCheck('ruff', ['check', ...backendFiles], manifest.worktree));
    checks.push(runCheck('ruff', ['format', '--check', ...backendFiles], manifest.worktree));
  }
  const status = checks.some((check) => check.status === 'BLOCKED')
    ? 'BLOCKED'
    : checks.some((check) => check.status === 'FAIL') ? 'FAIL' : 'PASS';
  const recordedAt = now();
  const value = {
    schemaVersion: 1,
    workflow: 'feature',
    runId: manifest.runId,
    phase: 'style',
    status,
    reviewedSha: scope.head,
    recordedAt,
    data: { baseSHA: scope.baseSHA, head: scope.head, files, checks },
  };
  const release = acquire(runDir, 'style-gate');
  try {
    writeAtomic(path.join(runDir, 'receipts', 'style.json'), value);
    appendJsonl(eventsPath(runDir), { eventId: crypto.randomUUID(), at: recordedAt, type: 'receipt', phase: 'style', status });
    const current = readJson(manifestPath(runDir));
    if (status === 'PASS') {
      removeRemainingWork(runDir, current, (item) => item.phase === 'style', 'style-gate-pass-cleared-style-remaining-work');
    } else {
      writeRemainingWork(runDir, current, checks
        .filter((check) => check.status !== 'PASS')
        .map((check) => remainingWorkItem('style', 'style_gate_failed', check.status, `${check.command}: ${check.evidence}`, { command: check.command, evidence: check.evidence })), 'style-gate-not-pass');
    }
  } finally {
    release();
  }
  return value;
}
function ancestorDirs(start, stop) {
  const dirs = [];
  let current = path.resolve(start);
  const boundary = path.resolve(stop);
  while (current.startsWith(boundary)) {
    dirs.push(current);
    if (current === boundary) break;
    current = path.dirname(current);
  }
  return dirs;
}
function firstExisting(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}
function nearestRule(worktree, file, rootSegment, names) {
  const segments = file.split(/[\\/]+/);
  const rootIndex = segments.indexOf(rootSegment);
  if (rootIndex < 0) return null;
  const root = path.join(worktree, ...segments.slice(0, rootIndex + 1));
  const start = path.dirname(path.join(worktree, file));
  for (const directory of ancestorDirs(start, root)) {
    const found = firstExisting(names.map((name) => path.join(directory, name)));
    if (found) return found;
  }
  return null;
}
function resolveRulesFor(manifest, file) {
  const worktree = manifest.worktree;
  const result = { file, category: 'general', required: [], optional: [], missingRequired: [], codeStyles: [] };
  if (file.startsWith('gateway/')) {
    result.category = 'gateway';
    result.required.push(firstExisting([
      path.join(worktree, 'gateway', 'agents', 'code-review.md'),
      path.join(worktree, 'gateway', 'docs', 'agents', 'code-review.md'),
    ]));
    result.optional.push(...[
      firstExisting([path.join(worktree, 'gateway', 'agents', 'code-style.md'), path.join(worktree, 'gateway', 'docs', 'agents', 'code-style.md')]),
      firstExisting([path.join(worktree, 'gateway', 'agents', 'typescript.md'), path.join(worktree, 'gateway', 'docs', 'agents', 'typescript.md')]),
      firstExisting([path.join(worktree, 'gateway', 'agents', 'patterns.md'), path.join(worktree, 'gateway', 'docs', 'agents', 'patterns.md')]),
    ].filter(Boolean));
    const style = firstExisting([
      path.join(worktree, 'gateway', 'agents', 'code-styles.md'),
      path.join(worktree, 'gateway', 'docs', 'agents', 'code-styles.md'),
      path.join(worktree, 'gateway', 'agents', 'code-style.md'),
      path.join(worktree, 'gateway', 'docs', 'agents', 'code-style.md'),
    ]) || nearestRule(worktree, file, 'gateway', ['code-styles.md', 'code-style.md']);
    if (style) result.codeStyles.push(style);
  } else if (file.split(/[\\/]+/).includes('backend')) {
    result.category = 'backend';
    result.required.push(nearestRule(worktree, file, 'backend', ['agents.md', 'AGENTS.md']));
    const style = nearestRule(worktree, file, 'backend', ['code-styles.md']);
    if (style) result.codeStyles.push(style);
  } else if (file.split(/[\\/]+/).includes('frontend')) {
    result.category = 'frontend';
    result.required.push(nearestRule(worktree, file, 'frontend', ['agents.md', 'AGENTS.md']));
    const style = nearestRule(worktree, file, 'frontend', ['code-styles.md']);
    if (style) result.codeStyles.push(style);
  } else {
    result.optional.push('/Users/michael/.omp/agent/agents/feature/review-prompts/code-quality.md');
    result.optional.push('/Users/michael/.omp/agent/agents/feature/rules/code-style.md');
  }
  result.required = result.required.filter(Boolean);
  if (['gateway', 'backend', 'frontend'].includes(result.category) && result.required.length === 0) {
    result.missingRequired.push(`${result.category} rule source`);
  }
  return result;
}
function rules(args) {
  const { manifest } = loadManifestFromArg(args);
  const file = option(args, '--file', false);
  if (file) return resolveRulesFor(manifest, file);
  return diffScope(args).files.map((entry) => resolveRulesFor(manifest, entry.file));
}
function scopeFingerprint(entry) {
  return sha256(JSON.stringify({
    file: entry.file,
    status: entry.status,
    changedLines: entry.changedLines || [],
    hunks: entry.hunks || [],
  })).slice(0, 24);
}
function isTestFilePath(file) {
  const normalized = String(file || '').replace(/\\/g, '/');
  return /(^|\/)(tests?|__tests__|specs?)\//.test(normalized)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    || /(^|\/)test_[^/]+\.py$/.test(normalized)
    || /_test\.py$/.test(normalized);
}
function testFilesForPlan(plan) {
  return (plan.files || [])
    .filter((entry) => entry.status !== 'deleted' && isTestFilePath(entry.file))
    .map((entry) => entry.file);
}
function ruleFingerprint(manifest, resolution, cache = new Map()) {
  const paths = [...(resolution.required || []), ...(resolution.optional || []), ...(resolution.codeStyles || [])];
  const sources = paths.map((file) => {
    if (!file) return { file: null, hash: null };
    if (!cache.has(file)) cache.set(file, fs.existsSync(file) ? sha256File(file) : null);
    return { file, hash: cache.get(file) };
  });
  return sha256(JSON.stringify(sources)).slice(0, 24);
}
function reviewPlan(args) {
  const { runDir } = loadManifestFromArg(args);
  const manifest = readJson(manifestPath(runDir));
  const scope = diffScope(args);
  const cache = new Map();
  const prior = latestReviewByFile(runDir);
  const files = scope.files.filter((entry) => entry.status !== 'deleted').map((entry) => {
    const rules = resolveRulesFor(manifest, entry.file);
    const fileScopeFingerprint = scopeFingerprint(entry);
    const fileRuleFingerprint = ruleFingerprint(manifest, rules, cache);
    const previous = prior.get(entry.file);
    const fingerprintsMatch = previous
      && previous.scopeFingerprint === fileScopeFingerprint
      && previous.ruleFingerprint === fileRuleFingerprint;
    const hasBlockingFinding = previous
      && (previous.status === 'BLOCKED'
        || previous.verdict === 'BLOCKED'
        || (previous.findings || []).some(isBlockingFinding));
    const reusePrevious = Boolean(fingerprintsMatch && !hasBlockingFinding);
    const needsReview = !reusePrevious;
    return {
      ...entry,
      scopeFingerprint: fileScopeFingerprint,
      ruleFingerprint: fileRuleFingerprint,
      rules,
      needsReview,
      reusedReview: reusePrevious,
      reusedReviewRecordedAt: reusePrevious ? previous.recordedAt : null,
    };
  });
  const value = { status: 'PASS', baseSHA: scope.baseSHA, head: scope.head, files, recordedAt: now() };
  const release = acquire(runDir, 'review-plan');
  try {
    const current = readJson(manifestPath(runDir));
    const previousPlanPath = path.join(runDir, 'receipts', 'review-plan.json');
    const previousPlan = fs.existsSync(previousPlanPath) ? readJson(previousPlanPath) : null;
    const attempts = { repairCycles: 0, reviewCycles: 0, reviewPasses: 0, ...(current.attempts || {}) };
    const isNewPass = !previousPlan || previousPlan.baseSHA !== value.baseSHA || previousPlan.head !== value.head;
    if (!isNewPass && previousPlan?.status === 'LIMIT_REACHED') return previousPlan;
    if (isNewPass) {
      if (files.some((file) => file.needsReview) && attempts.reviewPasses >= MAX_REVIEW_PASSES) {
        value.status = 'LIMIT_REACHED';
        value.reviewPass = attempts.reviewPasses;
        value.reviewPassLimitReached = true;
        value.maxReviewPasses = MAX_REVIEW_PASSES;
        writeAtomic(previousPlanPath, value);
        writeReviewRemainders(runDir, current, value, reviewRemaindersForPlan(runDir, value, true), 'review-pass-limit-reached');
        saveManifest(runDir, { ...current, currentHEAD: value.head, updatedAt: value.recordedAt }, { eventId: crypto.randomUUID(), at: value.recordedAt, type: 'review-pass-limit', head: value.head, maxReviewPasses: MAX_REVIEW_PASSES });
        return value;
      }
      attempts.reviewPasses += 1;
      value.reviewPass = attempts.reviewPasses;
      saveManifest(runDir, { ...current, attempts, currentHEAD: value.head, updatedAt: value.recordedAt }, { eventId: crypto.randomUUID(), at: value.recordedAt, type: 'review-plan', head: value.head, files: files.map((file) => file.file), reviewPass: value.reviewPass });
    } else if (previousPlan && previousPlan.reviewPass) {
      value.reviewPass = previousPlan.reviewPass;
    }
    writeAtomic(previousPlanPath, value);
    return value;
  } finally {
    release();
  }
}
function fingerprintFinding(file, finding) {
  return sha256(JSON.stringify({
    file,
    line: finding.line || finding.hunk || finding.changedLine || '',
    rule: finding.rule || '',
    issue: finding.issue || finding.evidence || finding.risk || finding.recommendedFix || '',
  })).slice(0, 24);
}
function isBlockingFinding(finding) {
  return String(finding.severity || 'Critical').toLowerCase() === 'critical';
}
function shortFinding(finding) {
  return {
    severity: finding.severity || 'Critical',
    rule: finding.rule || null,
    line: finding.line || finding.hunk || finding.changedLine || null,
    issue: finding.issue || finding.evidence || finding.risk || finding.recommendedFix || '',
  };
}
function reviewRemainderItem(file, kind, reason, extra = {}) {
  return { file, kind, reason, ...extra };
}
function reviewRemaindersForPlan(runDir, plan, includeLimit = false) {
  const latest = latestReviewByFile(runDir);
  const items = [];
  for (const file of plan.files) {
    const review = latest.get(file.file);
    if (includeLimit && file.needsReview) {
      items.push(reviewRemainderItem(file.file, 'review_pass_limit_reached', `Review pass limit reached: ${MAX_REVIEW_PASSES} total review passes.`, {
        maxReviewPasses: MAX_REVIEW_PASSES,
        scopeFingerprint: file.scopeFingerprint,
        ruleFingerprint: file.ruleFingerprint,
      }));
      continue;
    }
    if (!review) {
      items.push(reviewRemainderItem(file.file, 'missing_review', 'No current review receipt exists for this changed file.', {
        scopeFingerprint: file.scopeFingerprint,
        ruleFingerprint: file.ruleFingerprint,
      }));
      continue;
    }
    if (review.scopeFingerprint !== file.scopeFingerprint) {
      items.push(reviewRemainderItem(file.file, 'stale_file_review', 'The latest review receipt does not match the current file diff fingerprint.', {
        expectedScopeFingerprint: file.scopeFingerprint,
        actualScopeFingerprint: review.scopeFingerprint || null,
      }));
      continue;
    }
    if (review.ruleFingerprint !== file.ruleFingerprint) {
      items.push(reviewRemainderItem(file.file, 'stale_rule_review', 'The latest review receipt does not match the current rule fingerprint.', {
        expectedRuleFingerprint: file.ruleFingerprint,
        actualRuleFingerprint: review.ruleFingerprint || null,
      }));
      continue;
    }
    const blockingFindings = (review.findings || []).filter(isBlockingFinding);
    if (review.status === 'BLOCKED' || review.verdict === 'BLOCKED') {
      items.push(reviewRemainderItem(file.file, 'blocked_review_receipt', 'The latest review receipt is BLOCKED.', {
        status: review.status || null,
        verdict: review.verdict || null,
        findings: blockingFindings.map(shortFinding),
        repeatedFingerprints: review.repeatedFingerprints || [],
      }));
    } else if (blockingFindings.length) {
      items.push(reviewRemainderItem(file.file, 'unresolved_critical_findings', 'The latest review receipt contains unresolved Critical findings.', {
        findings: blockingFindings.map(shortFinding),
      }));
    } else if ((review.findings || []).length) {
      items.push(reviewRemainderItem(file.file, 'unresolved_review_findings', 'The latest review receipt contains findings for human follow-up.', {
        findings: review.findings.map(shortFinding),
      }));
    }
  }
  return items;
}
function writeReviewRemainders(runDir, manifest, plan, items, reason) {
  const recordedAt = now();
  const value = {
    schemaVersion: 1,
    workflow: 'feature',
    runId: manifest.runId,
    phase: 'review-remainders',
    status: items.length ? 'RECORDED' : 'PASS',
    reviewedSha: plan?.head || manifest.currentHEAD || null,
    recordedAt,
    reason,
    data: {
      baseSHA: plan?.baseSHA || manifest.baseSHA || null,
      head: plan?.head || manifest.currentHEAD || null,
      maxReviewPasses: MAX_REVIEW_PASSES,
      items,
    },
  };
  writeAtomic(reviewRemaindersPath(runDir), value);
  appendJsonl(eventsPath(runDir), { eventId: crypto.randomUUID(), at: recordedAt, type: 'receipt', phase: 'review-remainders', status: value.status, count: items.length });
  if (items.length) {
    writeRemainingWork(runDir, manifest, items.map((item) => remainingWorkItem('review', item.kind, 'BLOCKED', item.reason, item)), reason);
  }
  return value;
}
function readReviewData(args) {
  const dataFile = option(args, '--data-file', false);
  if (dataFile) return JSON.parse(fs.readFileSync(path.resolve(dataFile), 'utf8'));
  return JSON.parse(option(args, '--data'));
}
function reviewSubmissionFingerprint(file, plan, data) {
  const planned = plan.files.find((entry) => entry.file === file);
  const findings = Array.isArray(data.findings) ? data.findings : [];
  return sha256(JSON.stringify({
    file,
    reviewedSha: data.reviewedSha || plan.head,
    scopeFingerprint: data.scopeFingerprint || planned?.scopeFingerprint || null,
    ruleFingerprint: data.ruleFingerprint || planned?.ruleFingerprint || null,
    verdict: data.verdict || (findings.length ? 'FAIL' : 'PASS'),
    findings,
  })).slice(0, 24);
}
function recordReviewValue(runDir, current, plan, file, data) {
  const planned = plan.files.find((entry) => entry.file === file);
  if (!planned) fail(`Review file is not in the current review plan: ${file}`);
  if (data.reviewedSha && data.reviewedSha !== plan.head) fail(`Stale reviewer result for ${file}: expected ${plan.head}, received ${data.reviewedSha}`);
  if (data.scopeFingerprint && data.scopeFingerprint !== planned.scopeFingerprint) fail(`Stale file fingerprint for ${file}`);
  if (data.ruleFingerprint && data.ruleFingerprint !== planned.ruleFingerprint) fail(`Stale rule fingerprint for ${file}`);
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const submissionFingerprint = reviewSubmissionFingerprint(file, plan, data);
  const previousReview = latestReviewByFile(runDir).get(file);
  if (previousReview && previousReview.submissionFingerprint === submissionFingerprint) {
    return { ...previousReview, deduplicated: true };
  }
  const fingerprints = findings.map((finding) => fingerprintFinding(file, finding));
  const reviewDir = path.join(runDir, 'receipts', 'reviews');
  mkdir(reviewDir);
  const prior = fs.readdirSync(reviewDir).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(reviewDir, name)));
  const counts = new Map();
  for (const item of prior) {
    for (const fingerprint of item.findingFingerprints || []) counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1);
  }
  const repeated = findings
    .filter((finding) => isBlockingFinding(finding))
    .map((finding) => fingerprintFinding(file, finding))
    .filter((fingerprint) => (counts.get(fingerprint) || 0) >= 1);
  const value = {
    schemaVersion: 1,
    workflow: 'feature',
    runId: current.runId,
    file,
    reviewedSha: data.reviewedSha || plan.head,
    scopeFingerprint: planned.scopeFingerprint,
    ruleFingerprint: planned.ruleFingerprint,
    verdict: data.verdict || (findings.length ? 'FAIL' : 'PASS'),
    changedLines: data.changedLines || planned.changedLines || [],
    ruleSources: data.ruleSources || [],
    findings,
    findingFingerprints: fingerprints,
    submissionFingerprint,
    repeatedFingerprints: repeated,
    status: repeated.length ? 'BLOCKED' : (findings.length ? 'FAIL' : 'PASS'),
    recordedAt: now(),
  };
  const out = path.join(reviewDir, `${sha256(`${file}:${value.recordedAt}`).slice(0, 16)}.json`);
  writeAtomic(out, value);
  appendJsonl(eventsPath(runDir), { eventId: crypto.randomUUID(), at: value.recordedAt, type: 'file-review', file, status: value.status });
  if (value.status === 'BLOCKED') {
    writeReviewRemainders(runDir, current, plan, [
      reviewRemainderItem(file, 'repeated_critical_finding', `Repeated Critical finding after review retry: ${file}`, {
        repeatedFingerprints: repeated,
        findings: findings.filter(isBlockingFinding).map(shortFinding),
      }),
    ], 'repeated-critical-finding');
  }
  return value;
}
function recordReview(args) {
  const { runDir } = loadManifestFromArg(args);
  const file = option(args, '--file');
  const data = readReviewData(args);
  const release = acquire(runDir, `record-review:${file}`);
  try {
    const beforePlan = readJson(manifestPath(runDir));
    const plan = reviewPlanForRun(runDir, beforePlan);
    const current = readJson(manifestPath(runDir));
    return recordReviewValue(runDir, current, plan, file, data);
  } finally {
    release();
  }
}
function reviewPlanForRun(runDir, manifest) {
  const file = path.join(runDir, 'receipts', 'review-plan.json');
  if (fs.existsSync(file)) {
    const plan = readJson(file);
    const head = run(['git', '-C', manifest.worktree, 'rev-parse', 'HEAD']);
    if (plan.head === head && plan.baseSHA === manifest.baseSHA) return plan;
  }
  return reviewPlan(['--manifest', manifestPath(runDir)]);
}
function recordReviews(args) {
  const { runDir } = loadManifestFromArg(args);
  const data = readReviewData(args);
  if (!Array.isArray(data) || data.length === 0) fail('Batch review data must be a non-empty array.');
  const files = data.map((item) => item && item.file);
  if (files.some((file) => !file) || new Set(files).size !== files.length) fail('Batch review data must contain one unique file result per entry.');
  const release = acquire(runDir, 'record-reviews');
  try {
    const beforePlan = readJson(manifestPath(runDir));
    const plan = reviewPlanForRun(runDir, beforePlan);
    const current = readJson(manifestPath(runDir));
    const planned = new Set(plan.files.map((entry) => entry.file));
    for (const file of files) if (!planned.has(file)) fail(`Review file is not in the current review plan: ${file}`);
    const required = plan.files.filter((entry) => entry.needsReview).map((entry) => entry.file);
    const missing = required.filter((file) => !files.includes(file));
    if (missing.length) fail(`Batch review data is missing file result(s): ${missing.join(', ')}`);
    return data.map((item) => recordReviewValue(runDir, current, plan, item.file, item));
  } finally {
    release();
  }
}
function latestReviewByFile(runDir) {
  const reviewDir = path.join(runDir, 'receipts', 'reviews');
  const latest = new Map();
  if (!fs.existsSync(reviewDir)) return latest;
  for (const name of fs.readdirSync(reviewDir).filter((entry) => entry.endsWith('.json'))) {
    const item = readJson(path.join(reviewDir, name));
    const previous = latest.get(item.file);
    if (!previous || previous.recordedAt < item.recordedAt) latest.set(item.file, item);
  }
  return latest;
}
function gate(args) {
  const { runDir } = loadManifestFromArg(args);
  const manifest = readJson(manifestPath(runDir));
  const plan = reviewPlan(['--manifest', manifestPath(runDir)]);
  const hasPublishableDiff = Boolean(plan.baseSHA && plan.head && plan.head !== plan.baseSHA && plan.files.length > 0);
  if ((manifest.state === 'blocked' && !hasPublishableDiff) || manifest.state === 'cancelled') {
    const release = acquire(runDir, 'gate');
    try {
      const current = readJson(manifestPath(runDir));
      writeRemainingWork(runDir, current, [
        remainingWorkItem('workflow', 'workflow_not_publishable', 'BLOCKED', `Workflow is ${current.state}.`),
      ], 'workflow-not-publishable');
      transitionToReportReady(runDir, 'workflow-not-publishable');
      return { status: 'REPORT_REQUIRED', state: current.state, remainingWork: remainingWorkPath(runDir) };
    } finally {
      release();
    }
  }
  const verify = fs.existsSync(path.join(runDir, 'receipts', 'verify.json')) ? readJson(path.join(runDir, 'receipts', 'verify.json')) : null;
  const qa = fs.existsSync(path.join(runDir, 'receipts', 'qa.json')) ? readJson(path.join(runDir, 'receipts', 'qa.json')) : null;
  const style = fs.existsSync(path.join(runDir, 'receipts', 'style.json')) ? readJson(path.join(runDir, 'receipts', 'style.json')) : null;
  const testPrune = fs.existsSync(path.join(runDir, 'receipts', 'test-prune.json')) ? readJson(path.join(runDir, 'receipts', 'test-prune.json')) : null;
  const changedTestFiles = testFilesForPlan(plan);
  const gateFailures = [];
  if (!verify || verify.status !== 'PASS') {
    gateFailures.push(remainingWorkItem('verify', 'verify_not_pass', verify?.status || 'MISSING', 'Verify receipt is not PASS.', { receiptStatus: verify?.status || null }));
  }
  if (!qa) {
    gateFailures.push(remainingWorkItem('qa', 'qa_report_missing', 'MISSING', 'QA report receipt is missing.'));
  }
  if (!style || style.status !== 'PASS' || style.reviewedSha !== plan.head) {
    gateFailures.push(remainingWorkItem('style', 'style_not_current_pass', style?.status || 'MISSING', 'Current PASS style receipt is missing.', {
      receiptStatus: style?.status || null,
      styleHead: style?.reviewedSha || null,
      expectedHead: plan.head,
    }));
  }
  const remainders = reviewRemaindersForPlan(runDir, plan, plan.status === 'LIMIT_REACHED');
  const release = acquire(runDir, 'gate');
  try {
    const current = readJson(manifestPath(runDir));
    if (!hasPublishableDiff) {
      writeRemainingWork(runDir, current, [
        remainingWorkItem('workflow', 'no_publishable_diff', 'BLOCKED', 'No committed implementation diff exists to publish as a PR.', {
          baseSHA: plan.baseSHA || null,
          head: plan.head || null,
        }),
      ], 'publish-gate-no-publishable-diff');
      transitionToReportReady(runDir, 'publish-gate-no-publishable-diff');
      return {
        status: 'REPORT_REQUIRED',
        head: plan.head,
        reviewedFiles: plan.files.length,
        remainingWorkItems: 1,
        remainingWork: remainingWorkPath(runDir),
      };
    }
    const commentPolicyCheck = style?.data?.checks?.find((check) => check.kind === 'comment-policy');
    if (commentPolicyCheck && commentPolicyCheck.status !== 'PASS') {
      writeRemainingWork(runDir, current, [remainingWorkItem(
        'style',
        'comment_policy_violation',
        'BLOCKED',
        'Comment policy violations must be removed before PR creation.',
        { violations: commentPolicyCheck.violations || [], evidence: commentPolicyCheck.evidence },
      )], 'publish-gate-comment-policy');
      transitionToReportReady(runDir, 'publish-gate-comment-policy');
      return {
        status: 'REPORT_REQUIRED',
        head: plan.head,
        reviewedFiles: plan.files.length,
        remainingWorkItems: 1,
        remainingWork: remainingWorkPath(runDir),
      };
    }
    if (changedTestFiles.length && (!testPrune || testPrune.status !== 'PASS' || testPrune.reviewedSha !== plan.head)) {
      writeRemainingWork(runDir, current, [remainingWorkItem(
        'test-prune',
        'test_prune_not_current_pass',
        'BLOCKED',
        'Changed test files must pass the low-value-test pruning review before PR creation.',
        {
          receiptStatus: testPrune?.status || null,
          testPruneHead: testPrune?.reviewedSha || null,
          expectedHead: plan.head,
          changedTestFiles,
        },
      )], 'publish-gate-test-prune');
      transitionToReportReady(runDir, 'publish-gate-test-prune');
      return {
        status: 'REPORT_REQUIRED',
        head: plan.head,
        reviewedFiles: plan.files.length,
        remainingWorkItems: 1,
        remainingWork: remainingWorkPath(runDir),
      };
    }
    removeRemainingWork(runDir, current, (item) => item.phase === 'test-prune', 'publish-gate-refresh-test-prune');
    removeRemainingWork(runDir, current, (item) => item.phase === 'review', 'publish-gate-refresh-review-remainders');
    if (gateFailures.length) writeRemainingWork(runDir, current, gateFailures, 'publish-gate-recorded-phase-remainders');
    let receipt = null;
    if (remainders.length) {
      receipt = writeReviewRemainders(runDir, current, plan, remainders, 'publish-gate-recorded-review-remainders');
    }
    const hasRemainders = gateFailures.length > 0 || remainders.length > 0;
    if (['blocked', 'review.ready', 'report.ready'].includes(current.state)) transitionTo(runDir, 'publish.ready', {}, hasRemainders ? 'publish-gate-recorded-remainders' : 'publish-gate-passed');
    return {
      status: hasRemainders ? 'PASS_WITH_REMAINDERS' : 'PASS',
      head: plan.head,
      reviewedFiles: plan.files.length,
      verify: verify?.recordedAt || null,
      qa: qa?.recordedAt || null,
      phaseRemainders: gateFailures.length,
      remainingReviewItems: remainders.length,
      reviewRemainders: receipt ? reviewRemaindersPath(runDir) : null,
    };
  } finally {
    release();
  }
}
function finalize(args) {
  const { runDir } = loadManifestFromArg(args);
  const release = acquire(runDir, 'finalize');
  try {
    const current = readJson(manifestPath(runDir));
    if (current.state === 'complete') return { status: 'PASS', state: 'complete', idempotent: true };
    if (current.state !== 'publish.ready') fail(`Cannot finalize workflow from state ${current.state}; expected publish.ready.`);
    const next = transitionTo(runDir, 'complete', {}, 'publish-complete');
    return { status: 'PASS', state: next.state, idempotent: false };
  } finally {
    release();
  }
}
function summarizeRemainingWork(items) {
  if (!items.length) return 'none';
  return items.map((item) => `[${item.phase}/${item.status}] ${item.reason}`).join('\n');
}
function nextHumanAction(items, prUrl) {
  if (items.length && prUrl) return 'Review the PR and address the remaining work listed in the report.';
  if (items.length) return 'Review the remaining work list and decide whether to fix, accept, or rerun the affected phase.';
  if (prUrl) return 'Review the PR.';
  return 'No PR was created; inspect the run receipts before deciding next action.';
}
function finalReport(args) {
  const { runDir } = loadManifestFromArg(args);
  const summaryOnly = args.includes('--summary') || args.includes('--markdown');
  const release = acquire(runDir, 'final-report');
  try {
    let current = readJson(manifestPath(runDir));
    let remaining = maybeReadJson(remainingWorkPath(runDir));
    let items = [...(remaining?.data?.items || [])];
    const pr = receiptFor(runDir, 'pr');
    const push = receiptFor(runDir, 'push');
    const style = receiptFor(runDir, 'style');
    const verify = receiptFor(runDir, 'verify');
    const qa = receiptFor(runDir, 'qa');
    const testPrune = receiptFor(runDir, 'test-prune');
    const prUrl = pr?.data?.url || null;
    const inferredItems = [];
    const hasRemainingPhase = (phase) => items.some((item) => item.phase === phase);
    if (style && style.status !== 'PASS' && !hasRemainingPhase('style')) {
      inferredItems.push(remainingWorkItem('style', 'style_not_pass', style.status, 'Style receipt is not PASS.', { receiptStatus: style.status }));
    }
    if (verify && verify.status !== 'PASS' && !hasRemainingPhase('verify')) {
      inferredItems.push(remainingWorkItem('verify', 'verify_not_pass', verify.status, 'Verify receipt is not PASS.', { receiptStatus: verify.status }));
    }
    for (const scenario of qa?.data?.scenarios || []) {
      if (['FAIL', 'BLOCKED'].includes(scenario.result)
        && !items.some((item) => item.phase === 'qa' && item.scenario === scenario.scenario)) {
        inferredItems.push(remainingWorkItem('qa', 'qa_scenario_not_pass', scenario.result, scenario.scenario || 'QA scenario did not pass.', {
          scenario: scenario.scenario || null,
          surface: scenario.surface || null,
          evidence: scenario.evidence || null,
        }));
      }
    }
    if (inferredItems.length) {
      remaining = writeRemainingWork(runDir, current, inferredItems, 'final-report-inferred-remaining-work');
      items = [...(remaining?.data?.items || [])];
    }
    if (!prUrl && items.length === 0 && current.state !== 'complete') {
      remaining = writeRemainingWork(runDir, current, [
        remainingWorkItem('workflow', 'workflow_incomplete', 'BLOCKED', `Workflow ended before PR creation from state ${current.state}.`, { state: current.state }),
      ], 'final-report-workflow-incomplete');
      items = [...(remaining?.data?.items || [])];
    }
    const status = prUrl
      ? (items.length ? 'COMPLETE_WITH_REMAINDERS' : 'COMPLETE')
      : (items.length ? 'NEEDS_HUMAN' : 'REPORT_ONLY');
    const recordedAt = now();
    const report = {
      schemaVersion: 1,
      workflow: 'feature',
      runId: current.runId,
      phase: 'final-report',
      status,
      reviewedSha: current.currentHEAD || null,
      recordedAt,
      data: {
        ticket: current.ticket,
        branch: current.branch,
        worktree: current.worktree,
        prUrl,
        checks: {
          style: style ? { status: style.status, recordedAt: style.recordedAt, reviewedSha: style.reviewedSha } : { status: 'MISSING' },
          testPrune: testPrune ? { status: testPrune.status, recordedAt: testPrune.recordedAt, reviewedSha: testPrune.reviewedSha } : { status: 'NOT_REQUIRED_OR_MISSING' },
          verify: verify ? { status: verify.status, recordedAt: verify.recordedAt, reviewedSha: verify.reviewedSha } : { status: 'MISSING' },
          qa: qa ? { status: qa.status, recordedAt: qa.recordedAt, reviewedSha: qa.reviewedSha } : { status: 'MISSING' },
          push: push ? { status: push.status, recordedAt: push.recordedAt } : { status: prUrl ? 'MISSING' : 'NOT_RUN' },
          pr: pr ? { status: pr.status, recordedAt: pr.recordedAt, url: prUrl } : { status: 'NOT_CREATED' },
        },
        remainingWork: items,
        nextHumanAction: nextHumanAction(items, prUrl),
      },
      summaryMarkdown: [
        `Status: ${status}`,
        `Ticket: ${current.ticket}`,
        `Branch: ${current.branch}`,
        `PR: ${prUrl || 'not created'}`,
        `Checks: style=${style?.status || 'MISSING'}, test-prune=${testPrune?.status || 'NOT_REQUIRED_OR_MISSING'}, verify=${verify?.status || 'MISSING'}, qa=${qa?.status || 'MISSING'}`,
        `Remaining work:\n${summarizeRemainingWork(items)}`,
        `Next human action: ${nextHumanAction(items, prUrl)}`,
      ].join('\n'),
    };
    writeAtomic(finalReportPath(runDir), report);
    appendJsonl(eventsPath(runDir), { eventId: crypto.randomUUID(), at: recordedAt, type: 'receipt', phase: 'final-report', status });
    current = readJson(manifestPath(runDir));
    if (current.state !== 'complete' && current.state !== 'cancelled') {
      if (current.state !== 'report.ready') transitionToReportReady(runDir, 'final-report');
      current = readJson(manifestPath(runDir));
      if (current.state === 'report.ready') transitionTo(runDir, 'complete', { finalStatus: status }, 'final-report-complete');
    }
    return summaryOnly ? report.summaryMarkdown : report;
  } finally {
    release();
  }
}
function status(args) {
  const { runDir, manifest } = loadManifestFromArg(args);
  return { runDir, manifestPath: manifestPath(runDir), manifest };
}
function main(argv) {
  const command = argv[0];
  const args = argv.slice(1);
  if (command === 'admit') return admit(args);
  if (command === 'create-worktree') return createWorktree(args);
  if (command === 'status') return status(args);
  if (command === 'transition') return transitionCommand(args);
  if (command === 'receipt') return receipt(args);
  if (command === 'block') return block(args);
  if (command === 'repair-cycle') return repairCycle(args);
  if (command === 'diff-scope') return diffScope(args);
  if (command === 'comment-audit') return commentAudit(args);
  if (command === 'style-gate') return styleGate(args);
  if (command === 'rules') return rules(args);
  if (command === 'review-plan') return reviewPlan(args);
  if (command === 'record-review') return recordReview(args);
  if (command === 'record-reviews') return recordReviews(args);
  if (command === 'gate') return gate(args);
  if (command === 'finalize') return finalize(args);
  if (command === 'final-report') return finalReport(args);
  if (command === 'parse') return parseInvocation(rawOption(args, '--arguments'));
  fail('Usage: workflow.cjs admit|create-worktree|status|transition|receipt|block|repair-cycle|diff-scope|comment-audit|style-gate|rules|review-plan|record-review|record-reviews|gate|finalize|final-report|parse ...');
}

module.exports = {
  parseInvocation,
  detectProvider,
  ticketBranch,
  parseDiff,
  scanJavaScriptComments,
  auditJavaScriptComments,
  commentAuditEntries,
  workingTreeDiffScope,
  commentAudit,
  isTestFilePath,
  testFilesForPlan,
  resolveRulesFor,
  scopeFingerprint,
  ruleFingerprint,
  fingerprintFinding,
  main,
};

if (require.main === module) {
  try {
    const result = main(process.argv.slice(2));
    process.stdout.write(typeof result === 'string' ? `${result}\n` : `${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  }
}
