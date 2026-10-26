#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CHECKOUT = '/Users/michael/development/writer/writer-monorepo';
const DEFAULT_BACKEND_PORT = 8000;
const DEFAULT_GATEWAY_PORT = 3847;
const DEFAULT_NGROK_API_PORT = 4040;
const NGROK_DOMAIN = 'castiel-puling-charline.ngrok-free.dev';

class LocalRuntimeError extends Error {}

function fail(message) {
  throw new LocalRuntimeError(message);
}

function parseEnv(file) {
  const values = new Map();
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function redact(text) {
  return String(text)
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[REDACTED_SLACK_TOKEN]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

function command(args) {
  const result = childProcess.spawnSync(args[0], args.slice(1), { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function requiredCommand(args, message) {
  const output = command(args);
  if (output === null) fail(message);
  return output;
}

function ensureProtectedFile(file, label) {
  if (!fs.existsSync(file)) fail(`missing ${label}: ${file}`);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
    fail(`${label} must be owned by the current user and readable only by that user`);
  }
}

function gatewayEnvPath(checkout) {
  return path.join(checkout, 'gateway', '.env');
}

function readSlackCredentials(checkout) {
  const file = gatewayEnvPath(checkout);
  ensureProtectedFile(file, 'gateway env file');
  const gatewayEnv = parseEnv(file);
  const required = key => {
    const value = (gatewayEnv.get(key) || '').trim();
    if (!value) fail(`${key} is missing from the local gateway env`);
    return value;
  };
  const credentials = {
    botToken: required('SLACK_BOT_TOKEN'),
    signingSecret: required('SLACK_SIGNING_SECRET'),
    appToken: required('SLACK_APP_TOKEN'),
    qaUserToken: required('SLACK_QA_USER_TOKEN'),
  };
  if (credentials.botToken === credentials.qaUserToken) {
    fail('SLACK_QA_USER_TOKEN must be distinct from SLACK_BOT_TOKEN');
  }
  return credentials;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function validPort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`${label} is not a valid TCP port`);
  return port;
}

function listenerProcesses(port, checkout, label, commandPattern) {
  const output = command(['lsof', '-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (output === null) fail(`${label} listener could not be inspected; lsof is required`);
  const pids = [...new Set(output.split(/\s+/).filter(Boolean))];
  const matches = [];
  for (const pid of pids) {
    const processCommand = command(['ps', '-p', pid, '-o', 'command=']) || '';
    const cwdOutput = command(['lsof', '-a', '-p', pid, '-d', 'cwd', '-Fn']) || '';
    const cwdLine = cwdOutput.split(/\r?\n/).find(line => line.startsWith('n')) || '';
    const cwd = cwdLine.slice(1);
    if (commandPattern.test(processCommand) && cwd && isWithin(checkout, cwd)) {
      matches.push({ pid: Number(pid), command: processCommand.trim() });
    }
  }
  if (matches.length === 0) fail(`${label} is not served by a process from the local checkout`);
  return matches;
}

async function httpOk(url, label) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch {
    fail(`${label} is not reachable at ${url}`);
  }
  if (!response.ok) fail(`${label} returned HTTP ${response.status}`);
}

async function slackAuthTest(token, identity) {
  let response;
  try {
    response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail('Zoe Slack authentication could not be reached');
  }
  if (!response.ok) fail(`Slack auth.test returned HTTP ${response.status}`);
  const body = await response.json();
  if (!body.ok || typeof body.user_id !== 'string') fail(`${identity} authentication failed`);
  return { userId: body.user_id, teamId: body.team_id || '' };
}

async function ngrokTunnel(gatewayPort) {
  const apiPort = validPort(process.env.SLACK_QA_NGROK_API_PORT || DEFAULT_NGROK_API_PORT, 'SLACK_QA_NGROK_API_PORT');
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${apiPort}/api/tunnels`, { signal: AbortSignal.timeout(5000) });
  } catch {
    fail(`ngrok inspection API is not reachable on port ${apiPort}`);
  }
  if (!response.ok) fail(`ngrok inspection API returned HTTP ${response.status}`);
  let body;
  try { body = await response.json(); } catch { fail('ngrok inspection API returned invalid JSON'); }
  const tunnel = (body.tunnels || []).find(candidate => candidate.public_url === `https://${NGROK_DOMAIN}`);
  if (!tunnel) fail(`ngrok is not serving the required Zoe domain ${NGROK_DOMAIN}`);
  const address = String(tunnel.config?.addr || '');
  if (!new RegExp(`(?:^|:)${gatewayPort}(?:$|/)`).test(address)) {
    fail(`ngrok Zoe tunnel does not target local gateway port ${gatewayPort}`);
  }
  return { publicUrl: tunnel.public_url, address };
}

async function inspectLocalRuntime(checkoutPath) {
  const checkout = fs.realpathSync(path.resolve(checkoutPath || process.env.SLACK_QA_LOCAL_CHECKOUT || DEFAULT_CHECKOUT));
  const gitRoot = fs.realpathSync(requiredCommand(['git', '-C', checkout, 'rev-parse', '--show-toplevel'], 'local checkout is not a Git repository'));
  if (gitRoot !== checkout) fail('local Slack QA checkout must be the repository root');
  const gitDir = requiredCommand(['git', '-C', checkout, 'rev-parse', '--path-format=absolute', '--git-dir'], 'could not inspect local Git checkout');
  const gitCommon = requiredCommand(['git', '-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'], 'could not inspect local Git checkout');
  const superproject = command(['git', '-C', checkout, 'rev-parse', '--show-superproject-working-tree']) || '';
  if (gitDir !== gitCommon || superproject) fail('local Slack QA must run against the primary checkout, not a linked worktree');
  if (path.basename(checkout) !== 'writer-monorepo') fail('local Slack QA checkout must be writer-monorepo');
  const branch = requiredCommand(['git', '-C', checkout, 'branch', '--show-current'], 'could not determine the local checkout branch');
  if (!/-local$/.test(branch)) fail(`local Slack QA requires a -local branch; current branch is ${branch || 'detached'}`);

  const credentials = readSlackCredentials(checkout);

  const backendPort = validPort(process.env.SLACK_QA_BACKEND_PORT || DEFAULT_BACKEND_PORT, 'SLACK_QA_BACKEND_PORT');
  const gatewayEnv = parseEnv(gatewayEnvPath(checkout));
  const gatewayPort = validPort(process.env.SLACK_QA_GATEWAY_PORT || gatewayEnv.get('PORT') || DEFAULT_GATEWAY_PORT, 'SLACK_QA_GATEWAY_PORT');
  await httpOk(`http://127.0.0.1:${backendPort}/api/health`, 'local backend');
  await httpOk(`http://127.0.0.1:${gatewayPort}/readyz`, 'local gateway');
  const backendProcesses = listenerProcesses(backendPort, checkout, 'local backend', /python|uvicorn|fastapi/i);
  const gatewayProcesses = listenerProcesses(gatewayPort, checkout, 'local gateway', /bun|node/i);
  const tunnel = await ngrokTunnel(gatewayPort);
  await httpOk(`https://${NGROK_DOMAIN}/readyz`, 'public Zoe gateway');
  const zoe = await slackAuthTest(credentials.botToken, 'local Zoe bot');
  const qaUser = await slackAuthTest(credentials.qaUserToken, 'Slack QA sender');
  if (qaUser.userId === zoe.userId) {
    fail('SLACK_QA_USER_TOKEN must identify a different Slack user from Zoe');
  }

  return {
    mode: 'local',
    checkout,
    branch,
    state: 'shared-local-stack',
    ports: { backend: backendPort, gateway: gatewayPort },
    processes: { backend: backendProcesses, gateway: gatewayProcesses },
    ngrokDomain: NGROK_DOMAIN,
    publicBaseUrl: `https://${NGROK_DOMAIN}`,
    slackEventsUrl: `https://${NGROK_DOMAIN}/gateway/slack/events`,
    ngrokTarget: tunnel.address,
    zoeUserId: zoe.userId,
    zoeTeamId: zoe.teamId,
    slackQaUserId: qaUser.userId,
    slackQaTeamId: qaUser.teamId,
  };
}

async function main() {
  const [commandName, ...args] = process.argv.slice(2);
  const checkoutIndex = args.indexOf('--checkout');
  if (commandName !== 'status' || checkoutIndex < 0 || checkoutIndex + 1 >= args.length || args.length !== 2) {
    fail('usage: local-runtime.cjs status --checkout <primary-checkout>');
  }
  const result = await inspectLocalRuntime(args[checkoutIndex + 1]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${redact(error.message)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  __test: {
    NGROK_DOMAIN,
    gatewayEnvPath,
    isWithin,
    parseEnv,
    readSlackCredentials,
    slackAuthTest,
    validPort,
  },
  inspectLocalRuntime,
  readSlackCredentials,
};
