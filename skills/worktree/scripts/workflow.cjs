#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const HERDR = process.env.WORKTREE_HERDR_BIN || 'herdr';
const WORKTREES_ROOT = path.resolve(process.env.WORKTREE_ROOT || path.join(HOME, '.herdr', 'worktrees'));
const ENV_GUARD_SCRIPT = process.env.WORKTREE_ENV_GUARD_SCRIPT || '/Users/michael/.omp/agent/lib/worktree-env-guard.cjs';
const GATEWAY_SLACK_RUNTIME_SCRIPT =
  process.env.WORKTREE_GATEWAY_SLACK_RUNTIME_SCRIPT ||
  path.resolve(__dirname, 'gateway-slack-runtime.cjs');

class WorkflowError extends Error {}

function fail(message) {
  throw new WorkflowError(message);
}

function option(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) {
    if (required) fail(`missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}

function rawOption(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    if (required) fail(`missing required option: ${name}`);
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

  if (quote) fail('unterminated quote in arguments');
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function parseWorktreeArguments(raw) {
  const tokens = tokenize(raw);
  const positional = tokens.find((token) => !token.startsWith('--'));
  const named = option(tokens, '--name', false);
  const parsed = { requestedName: positional || named || 'auto' };
  if (tokens.includes('--gateway-slack')) parsed.gatewaySlack = true;
  return parsed;
}

function run(args, options = {}) {
  const result = childProcess.spawnSync(args[0], args.slice(1), {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) return result.stdout.trim();
  if (result.error && result.error.code === 'ENOENT') {
    return { missing: true, reason: result.error.message };
  }
  return {
    failed: true,
    reason: (result.stderr || result.stdout || result.error?.message || `command failed: ${args.join(' ')}`).trim(),
  };
}

function mustRun(args, options = {}) {
  const result = run(args, options);
  if (typeof result === 'string') return result;
  fail(result.reason);
}

function maybeRun(args, options = {}) {
  return run(args, options);
}

function randomHex(bytes) {
  const forced = process.env.WORKTREE_RANDOM_HEX;
  if (forced) {
    if (!/^[a-f0-9]+$/i.test(forced) || forced.length !== bytes * 2) {
      fail(`WORKTREE_RANDOM_HEX must be ${bytes * 2} hex characters`);
    }
    return forced.toLowerCase();
  }
  return crypto.randomBytes(bytes).toString('hex');
}

function currentBranch(cwd) {
  const branch = maybeRun(['git', 'branch', '--show-current'], { cwd });
  return typeof branch === 'string' && branch ? branch : 'detached';
}

function gitRoot(cwd) {
  return mustRun(['git', 'rev-parse', '--show-toplevel'], { cwd });
}

function repositoryName(cwd) {
  const commonDir = mustRun(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  return path.basename(path.dirname(commonDir));
}

function isLinkedWorktree(cwd) {
  const gitDir = mustRun(['git', 'rev-parse', '--path-format=absolute', '--git-dir'], { cwd });
  const gitCommon = mustRun(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  const superproject = maybeRun(['git', 'rev-parse', '--show-superproject-working-tree'], { cwd });
  const hasSuperproject = typeof superproject === 'string' && superproject.trim() !== '';
  return gitDir !== gitCommon && !hasSuperproject;
}

function guardEnv(worktree) {
  if (process.env.WORKTREE_DISABLE_ENV_GUARD === '1') return;
  mustRun([process.execPath, ENV_GUARD_SCRIPT, '--worktree', worktree]);
}

function prepareGatewaySlack(worktree, sourceRoot) {
  mustRun([
    process.execPath,
    GATEWAY_SLACK_RUNTIME_SCRIPT,
    'start',
    '--worktree',
    worktree,
    '--source-root',
    sourceRoot,
  ]);
}

function existingPathForBranch(repo, branch) {
  const output = mustRun(['git', '-C', repo, 'worktree', 'list', '--porcelain']);
  let current = '';
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    if (line === `branch refs/heads/${branch}`) return current;
  }
  return '';
}

function createWithHerdr(repo, branch, target) {
  return maybeRun([
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

function formatReady(repo, worktree, branch) {
  return [
    `repo: ${repo}`,
    `worktree: ${worktree}`,
    `branch: ${branch}`,
    'status: ready',
  ].join('\n');
}

function createWorktree({ cwd, requestedName, gatewaySlack = false }) {
  const root = gitRoot(cwd);
  const repo = repositoryName(cwd);
  const resolvedRoot = fs.realpathSync(root);

  if (gatewaySlack && repo !== 'writer-monorepo') {
    fail('--gateway-slack is only supported for writer-monorepo');
  }

  const finalize = (result) => {
    if (gatewaySlack) {
      prepareGatewaySlack(
        result.worktree,
        process.env.WORKTREE_GATEWAY_SLACK_SOURCE_ROOT || '/Users/michael/development/writer/writer-monorepo',
      );
    } else {
      guardEnv(result.worktree);
    }
    return result;
  };

  if (isLinkedWorktree(cwd)) {
    const linkedRoot = fs.realpathSync(gitRoot(cwd));
    return finalize({
      repo,
      worktree: linkedRoot,
      branch: currentBranch(linkedRoot),
      status: 'ready',
    });
  }

  let name;
  if (!requestedName || requestedName === 'auto') name = randomHex(4);
  else name = `${requestedName}-${randomHex(2)}`;

  const target = path.join(WORKTREES_ROOT, repo, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const existingPath = existingPathForBranch(resolvedRoot, name);
  if (existingPath) {
    return finalize({ repo, worktree: existingPath, branch: name, status: 'ready' });
  }

  if (fs.existsSync(target)) {
    return finalize({ repo, worktree: target, branch: name, status: 'ready' });
  }

  mustRun(['git', '-C', resolvedRoot, 'fetch', '--quiet', 'origin', 'main:refs/remotes/origin/main']);

  const herdrResult = createWithHerdr(resolvedRoot, name, target);
  if (typeof herdrResult !== 'string') {
    mustRun(['git', '-C', resolvedRoot, 'worktree', 'add', '-b', name, target, 'origin/main']);
  }

  return finalize({ repo, worktree: target, branch: name, status: 'ready' });
}

function createCommand(args) {
  const cwd = path.resolve(option(args, '--cwd', false) || process.cwd());
  const requestedName = option(args, '--name', false) || 'auto';
  const result = createWorktree({ cwd, requestedName, gatewaySlack: args.includes('--gateway-slack') });
  return formatReady(result.repo, result.worktree, result.branch);
}

function invokeCommand(args) {
  const cwd = path.resolve(option(args, '--cwd', false) || process.cwd());
  const parsed = parseWorktreeArguments(rawOption(args, '--arguments', false) || '');
  const result = createWorktree({ cwd, requestedName: parsed.requestedName, gatewaySlack: parsed.gatewaySlack === true });
  return formatReady(result.repo, result.worktree, result.branch);
}

function parseCommand(args) {
  return JSON.stringify(parseWorktreeArguments(rawOption(args, '--arguments', false) || ''));
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create') return createCommand(args);
  if (command === 'invoke') return invokeCommand(args);
  if (command === 'parse') return parseCommand(args);
  fail('usage: workflow.cjs create|invoke|parse ...');
}

if (require.main === module) {
  try {
    const output = main();
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stdout.write(`blocked: worktree\nreason: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  __test: {
    createWorktree,
    formatReady,
    isLinkedWorktree,
    parseWorktreeArguments,
    repositoryName,
    tokenize,
  },
};
