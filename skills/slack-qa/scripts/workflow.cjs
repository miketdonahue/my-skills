#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CHECKOUT = '/Users/michael/development/writer/writer-monorepo';
const PREPARE_SCRIPT = process.env.SLACK_QA_PREPARE_SCRIPT || path.resolve(__dirname, 'prepare.cjs');
const DIRECT_MESSAGE_SCRIPT = process.env.SLACK_QA_DIRECT_MESSAGE_SCRIPT || path.resolve(__dirname, 'direct-message.cjs');

class WorkflowError extends Error {}

function fail(message) {
  throw new WorkflowError(message);
}

function redact(text) {
  return String(text)
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[REDACTED_SLACK_TOKEN]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
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

function assertOnlyOptions(args, valueOptions) {
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) fail(`unexpected arguments: ${arg}`);
    if (!valueOptions.has(arg)) fail(`unexpected arguments: ${arg}`);
    if (seen.has(arg)) fail(`duplicate option: ${arg}`);
    seen.add(arg);
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) fail(`missing required option: ${arg}`);
    index += 1;
  }
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

function parsePrUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('Slack QA requires a valid GitHub pull request URL');
  }
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash) {
    fail('Slack QA requires a github.com pull request URL');
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/);
  if (!match) fail('Slack QA requires a URL in the form https://github.com/OWNER/REPOSITORY/pull/NUMBER');
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

function parseSkillArguments(raw) {
  const tokens = tokenize(raw);
  if (tokens.length !== 1) fail('usage: /slack-qa <github-pr-url>');
  if (tokens[0].startsWith('--')) fail(`unexpected arguments: ${tokens[0]}`);
  return { prUrl: parsePrUrl(tokens[0]) };
}

function parsePrepareArgs(args) {
  assertOnlyOptions(args, new Set(['--pr', '--checkout']));
  const prUrl = parsePrUrl(option(args, '--pr'));
  const checkout = path.resolve(option(args, '--checkout', false) || process.env.SLACK_QA_LOCAL_CHECKOUT || DEFAULT_CHECKOUT);
  return { checkout, prUrl };
}

function parseRunCaseArgs(args) {
  assertOnlyOptions(args, new Set(['--checkout', '--case-file']));
  const checkout = path.resolve(option(args, '--checkout', false) || process.env.SLACK_QA_LOCAL_CHECKOUT || DEFAULT_CHECKOUT);
  const caseFile = option(args, '--case-file', false);
  return { caseFile, checkout };
}

function parseInvocation(argv) {
  const [commandName, ...rest] = argv;
  if (commandName === 'invoke') {
    assertOnlyOptions(rest, new Set(['--arguments', '--checkout', '--cwd']));
    const rawArguments = rawOption(rest, '--arguments');
    const parsed = parseSkillArguments(rawArguments);
    const checkout = path.resolve(option(rest, '--checkout', false) || process.env.SLACK_QA_LOCAL_CHECKOUT || DEFAULT_CHECKOUT);
    const cwd = option(rest, '--cwd', false);
    return { command: 'prepare', checkout, cwd, prUrl: parsed.prUrl };
  }
  if (commandName === 'prepare') return { command: 'prepare', ...parsePrepareArgs(rest) };
  if (commandName === 'run-case') return { command: 'run-case', ...parseRunCaseArgs(rest) };
  fail('usage: workflow.cjs invoke --arguments <github-pr-url> [--checkout <path>]');
}

function runJson(args, options = {}) {
  const result = childProcess.spawnSync(args[0], args.slice(1), {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: options.env || process.env,
    input: options.input,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (result.error?.code === 'ENOENT') fail(`${args[0]} is not installed`);
    fail(redact((result.stderr || result.stdout || result.error?.message || 'command failed').trim()));
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail('workflow helper returned invalid JSON');
  }
}

function prepare(args) {
  return runJson([
    process.execPath,
    PREPARE_SCRIPT,
    '--pr',
    args.prUrl,
    '--checkout',
    args.checkout,
  ], { cwd: args.cwd });
}

function readCaseInput(caseFile) {
  if (!caseFile) return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(path.resolve(caseFile), 'utf8');
}

function runCase(args) {
  return runJson([
    process.execPath,
    DIRECT_MESSAGE_SCRIPT,
    'run',
    '--checkout',
    args.checkout,
  ], { input: readCaseInput(args.caseFile) });
}

function main(argv = process.argv.slice(2)) {
  const parsed = parseInvocation(argv);
  const result = parsed.command === 'run-case' ? runCase(parsed) : prepare(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Error: ${redact(error.message)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  __test: {
    parseInvocation,
    parsePrUrl,
    parseSkillArguments,
    tokenize,
  },
};
