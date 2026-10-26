#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const RUNS_ROOT = path.resolve(process.env.ORCHESTRATE_RUNS_ROOT || path.join(HOME, '.omp', 'workflow-runs', 'orchestrate'));
const WORKTREES_ROOT = path.resolve(process.env.ORCHESTRATE_WORKTREES_ROOT || path.join(HOME, '.herdr', 'worktrees'));
const FEATURE_WORKFLOW = path.resolve(process.env.ORCHESTRATE_FEATURE_WORKFLOW || path.join(HOME, '.omp', 'agent', 'skills', 'feature', 'scripts', 'workflow.cjs'));
const HERDR = process.env.ORCHESTRATE_HERDR_BIN || 'herdr';
const OMP = process.env.ORCHESTRATE_OMP_BIN || 'omp';

class WorkflowError extends Error {
  constructor(phase, reason) {
    super(reason);
    this.phase = phase;
  }
}

function fail(phase, reason) {
  throw new WorkflowError(phase, reason);
}

function now() {
  return new Date().toISOString();
}

function mkdir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

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

function run(args, options = {}) {
  try {
    return childProcess.execFileSync(args[0], args.slice(1), {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env,
    }).trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const stdout = error.stdout ? String(error.stdout).trim() : '';
    const reason = stderr || stdout || error.message;
    if (error.code === 'ENOENT') {
      return { missing: true, reason };
    }
    return { failed: true, reason };
  }
}

function mustRun(phase, args, options = {}) {
  const result = run(args, options);
  if (typeof result === 'string') return result;
  fail(phase, result.reason);
}

function option(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) {
    if (required) fail('parse', `missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}

function rawOption(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    if (required) fail('parse', `missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
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
  if (quote) fail('parse', 'unterminated quote in arguments');
  if (current) tokens.push(current);
  return tokens;
}

function quoteFeatureArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@+-]+$/.test(text)) return text;
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}

function featureRawFromTokens(tokens) {
  return tokens.map(quoteFeatureArg).join(' ');
}

function parseFeatureArgs(rawFeatureArguments) {
  const output = mustRun('parse', ['node', FEATURE_WORKFLOW, 'parse', '--arguments', rawFeatureArguments]);
  try {
    return JSON.parse(output);
  } catch {
    fail('parse', `feature parser returned malformed JSON: ${output}`);
  }
}

function parseInvocation(raw, cwd = process.cwd()) {
  const tokens = tokenize(raw);
  if (tokens[0] !== 'feature') {
    fail('parse', 'usage: /orchestrate feature --ticket <value> [--plan <plan.md>]');
  }
  const featureRaw = featureRawFromTokens(tokens.slice(1));
  const parsed = parseFeatureArgs(featureRaw);
  const ticket = String(parsed.ticket || '').trim();
  if (!ticket) fail('parse', 'usage: /orchestrate feature --ticket <value> [--plan <plan.md>]');
  let planPath = null;
  if (parsed.plan) {
    planPath = path.resolve(cwd, parsed.plan);
    if (!planPath.endsWith('.md')) fail('parse', 'plan file must end in .md');
    if (!fs.existsSync(planPath) || !fs.statSync(planPath).isFile()) {
      fail('parse', `plan file was not found or is not readable: ${planPath}`);
    }
  }
  return { subcommand: 'feature', ticket, planPath };
}

function normalizeTicket(ticket) {
  return String(ticket || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function suffix() {
  const forced = process.env.ORCHESTRATE_RANDOM_HEX;
  if (forced) {
    if (!/^[a-f0-9]{4}$/i.test(forced)) fail('parse', 'ORCHESTRATE_RANDOM_HEX must be exactly 4 hex characters');
    return forced.toLowerCase();
  }
  return crypto.randomBytes(2).toString('hex');
}

function repoRoot(cwd) {
  return mustRun('repo', ['git', '-C', cwd, 'rev-parse', '--show-toplevel']);
}

function repoName(root) {
  return path.basename(root);
}

function currentWorktreeForBranch(repo, branch) {
  const output = mustRun('repo', ['git', '-C', repo, 'worktree', 'list', '--porcelain']);
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

function refExists(repo, ref) {
  const result = run(['git', '-C', repo, 'show-ref', '--verify', '--quiet', ref]);
  return typeof result === 'string';
}

function remoteBranchExists(repo, branch) {
  const result = run(['git', '-C', repo, 'ls-remote', '--exit-code', '--heads', 'origin', branch]);
  return typeof result === 'string';
}

function parseJsonOutput(phase, output) {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    fail(phase, `command returned malformed JSON: ${output}`);
  }
}

function findWorkspaceId(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.open_workspace_id === 'string') return value.open_workspace_id;
  if (typeof value.workspace_id === 'string') return value.workspace_id;
  for (const child of Object.values(value)) {
    const found = findWorkspaceId(child);
    if (found) return found;
  }
  return null;
}

function workspaceForTarget(repo, target) {
  const output = run([HERDR, 'worktree', 'list', '--cwd', repo, '--json']);
  if (typeof output !== 'string') return null;
  const parsed = parseJsonOutput('worktree-open', output);
  const worktrees = parsed?.result?.worktrees || parsed?.worktrees || [];
  const resolvedTarget = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  for (const worktree of worktrees) {
    if (!worktree?.path) continue;
    const resolved = fs.existsSync(worktree.path) ? fs.realpathSync(worktree.path) : path.resolve(worktree.path);
    if (resolved === resolvedTarget && typeof worktree.open_workspace_id === 'string') {
      return worktree.open_workspace_id;
    }
  }
  return null;
}

function createWithGit(repo, branch, target) {
  mustRun('worktree-create', ['git', '-C', repo, 'worktree', 'add', '-b', branch, target, 'origin/main']);
}

function createWithHerdr(repo, branch, target) {
  return run([
    HERDR,
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
}

function openWithHerdr(target, branch) {
  return run([
    HERDR,
    'worktree',
    'open',
    '--path',
    target,
    '--label',
    branch,
    '--no-focus',
    '--json',
  ]);
}

function createAndOpenWorktree(repo, branch, target) {
  mustRun('worktree-create', ['git', '-C', repo, 'fetch', '--quiet', 'origin', 'main:refs/remotes/origin/main']);

  const createResult = createWithHerdr(repo, branch, target);
  let createJson = null;
  if (typeof createResult === 'string') {
    createJson = parseJsonOutput('worktree-create', createResult);
  } else if (createResult.missing) {
    createWithGit(repo, branch, target);
  } else {
    fail('worktree-create', createResult.reason);
  }

  let workspaceId = findWorkspaceId(createJson) || workspaceForTarget(repo, target);
  if (!workspaceId) {
    const openResult = openWithHerdr(target, branch);
    if (typeof openResult !== 'string') fail('worktree-open', openResult.reason);
    const openJson = parseJsonOutput('worktree-open', openResult);
    workspaceId = findWorkspaceId(openJson) || workspaceForTarget(repo, target);
  }
  if (!workspaceId) fail('worktree-open', 'Herdr did not report an open workspace id for the new worktree');
  return workspaceId;
}

function featurePrompt(ticket, planPath) {
  const parts = ['/feature', '--ticket', quoteFeatureArg(ticket)];
  if (planPath) parts.push('--plan', quoteFeatureArg(planPath));
  return parts.join(' ');
}

function runId(branch) {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${branch}`;
}

function manifestFiles(project, id) {
  const runDir = path.join(RUNS_ROOT, project, id);
  return {
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    eventsPath: path.join(runDir, 'events.jsonl'),
  };
}

function save(files, manifest, event) {
  if (event) appendJsonl(files.eventsPath, event);
  writeAtomic(files.manifestPath, manifest);
}

function launch(args) {
  const cwd = path.resolve(option(args, '--cwd', false) || process.cwd());
  const originalArguments = rawOption(args, '--arguments');
  const invocation = parseInvocation(originalArguments, cwd);
  const normalized = normalizeTicket(invocation.ticket);
  if (!normalized) fail('parse', 'ticket value cannot be normalized into a worktree name');
  const branch = `${normalized}-${suffix()}`;
  const repo = repoRoot(cwd);
  const project = repoName(repo);
  const target = path.join(WORKTREES_ROOT, project, branch);
  if (currentWorktreeForBranch(repo, branch)) fail('worktree-create', `branch already exists in a worktree: ${branch}`);
  if (refExists(repo, `refs/heads/${branch}`)) fail('worktree-create', `branch already exists locally: ${branch}`);
  if (remoteBranchExists(repo, branch)) fail('worktree-create', `branch already exists remotely: ${branch}`);
  if (fs.existsSync(target)) fail('worktree-create', `worktree path already exists: ${target}`);

  const id = runId(branch);
  const files = manifestFiles(project, id);
  if (fs.existsSync(files.runDir)) fail('admit', `orchestrate run already exists: ${id}`);
  const createdAt = now();
  const manifest = {
    schemaVersion: 1,
    workflow: 'orchestrate',
    subcommand: invocation.subcommand,
    runId: id,
    state: 'admitted',
    repoRoot: repo,
    project,
    ticket: invocation.ticket,
    planPath: invocation.planPath,
    normalizedTicket: normalized,
    branch,
    worktree: target,
    workerAgentName: `feature-${branch}`,
    workerPrompt: featurePrompt(invocation.ticket, invocation.planPath),
    workspaceId: null,
    createdAt,
    updatedAt: createdAt,
  };
  save(files, manifest, { eventId: crypto.randomUUID(), at: createdAt, to: 'admitted', patch: manifest });

  const workspaceId = createAndOpenWorktree(repo, branch, target);
  const workerAgentName = `feature-${branch}`;
  const workerPrompt = featurePrompt(invocation.ticket, invocation.planPath);
  const startArgs = [
    HERDR,
    'agent',
    'start',
    workerAgentName,
    '--cwd',
    target,
    '--workspace',
    workspaceId,
    '--no-focus',
    '--env',
    `OMP_ORCHESTRATE_RUN_ID=${id}`,
    '--env',
    `OMP_ORCHESTRATE_MANIFEST=${files.manifestPath}`,
    '--',
    OMP,
    workerPrompt,
  ];
  const startResult = run(startArgs);
  if (typeof startResult !== 'string') fail('worker-start', startResult.reason);

  const launchedAt = now();
  const next = {
    ...manifest,
    state: 'started',
    workspaceId,
    workerAgentName,
    workerPrompt,
    launchCommand: startArgs,
    launchedAt,
    updatedAt: launchedAt,
  };
  save(files, next, { eventId: crypto.randomUUID(), at: launchedAt, from: 'admitted', to: 'started', patch: { workspaceId, workerAgentName, launchedAt } });

  return [
    'launched: feature',
    `ticket: ${invocation.ticket}`,
    `worktree: ${target}`,
    `branch: ${branch}`,
    `agent: ${workerAgentName}`,
    'status: started',
  ].join('\n');
}

function parseCommand(args) {
  const cwd = path.resolve(option(args, '--cwd', false) || process.cwd());
  const parsed = parseInvocation(rawOption(args, '--arguments'), cwd);
  return JSON.stringify(parsed);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'launch') return launch(args);
  if (command === 'parse') return parseCommand(args);
  fail('parse', 'usage: workflow.cjs launch|parse --arguments <args>');
}

try {
  const output = main();
  if (output) process.stdout.write(`${output}\n`);
} catch (error) {
  if (error instanceof WorkflowError) {
    process.stdout.write(`blocked: ${error.phase}\nreason: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`blocked: internal\nreason: ${error.message}\n`);
    process.exitCode = 1;
  }
}
