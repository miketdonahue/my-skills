#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const STATE_ROOT = path.resolve(
  process.env.WORKTREE_GATEWAY_SLACK_STATE_ROOT || path.join(HOME, '.omp', 'runtime', 'gateway-slack'),
);
const ENV_GUARD_SCRIPT = process.env.WORKTREE_ENV_GUARD_SCRIPT || '/Users/michael/.omp/agent/lib/worktree-env-guard.cjs';
const NGROK_DOMAIN = 'castiel-puling-charline.ngrok-free.dev';
const COMPOSE_FILE_NAME = 'docker-compose.localdev.yaml';
const RUNTIME_VERSION = 'omp-gateway-slack-v1';

class RuntimeError extends Error {}

function fail(message) {
  throw new RuntimeError(message);
}

function value(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) {
    if (required) fail(`missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}

function run(args, options = {}) {
  const result = childProcess.spawnSync(args[0], args.slice(1), {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) return result.stdout.trim();
  if (result.error?.code === 'ENOENT') fail(`${args[0]} is not installed`);
  fail((result.stderr || result.stdout || result.error?.message || `command failed: ${args.join(' ')}`).trim());
}

function mustRun(args, options = {}) {
  return run(args, options);
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const stat = fs.statSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    fail(`unsafe runtime directory: ${directory}`);
  }
}

function ensurePrivateFile(file, label) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || (stat.mode & 0o004) !== 0 || stat.uid !== process.getuid()) {
    fail(`unsafe ${label} permissions`);
  }
}

function parseEnv(file) {
  const values = new Map();
  if (!fs.existsSync(file)) return values;
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
  return String(text).replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[REDACTED_SLACK_TOKEN]');
}

function dotenvValue(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:@,+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function writeEnv(file, values) {
  const lines = [];
  for (const [key, entry] of values) lines.push(`${key}=${dotenvValue(entry)}`);
  lines.push('');
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function appendEnv(file, values) {
  const lines = [];
  for (const [key, entry] of Object.entries(values)) lines.push(`${key}=${dotenvValue(entry)}`);
  fs.appendFileSync(file, `\n# OMP gateway-slack runtime overrides\n${lines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function hashWorktree(worktree) {
  return crypto.createHash('sha256').update(fs.realpathSync(worktree)).digest('hex').slice(0, 12);
}

function stateFor(worktree) {
  const id = hashWorktree(worktree);
  return {
    id,
    directory: path.join(STATE_ROOT, id),
    receipt: path.join(STATE_ROOT, id, 'runtime.json'),
    lock: path.join(STATE_ROOT, 'active.json'),
  };
}

function portsForSlot(slot) {
  const step = 101;
  return {
    backend: 8000 + slot * step,
    postgres: 5444 + slot * step,
    redis: 6379 + slot * step,
    restate: 8080 + slot * step,
    restateAdmin: 9070 + slot * step,
    restateIngress: 5122 + slot * step,
    clickhouse: 8123 + slot * step,
    gateway: 3847 + slot * step,
  };
}

function tcpPortOpen(port) {
  const result = childProcess.spawnSync(process.execPath, ['-e', [
    "const net=require('node:net');",
    `const s=net.createConnection({host:'127.0.0.1',port:${Number(port)}});`,
    "s.setTimeout(300); s.on('connect',()=>process.exit(0)); s.on('error',()=>process.exit(1)); s.on('timeout',()=>process.exit(1));",
  ].join('')], { stdio: 'ignore' });
  return result.status === 0;
}

function chooseSlot() {
  for (let slot = 1; slot < 1000; slot += 1) {
    const ports = portsForSlot(slot);
    if (Object.values(ports).some(tcpPortOpen)) continue;
    return { slot, ports };
  }
  fail('no free local gateway-slack port slot is available');
}

function activeReceipt(lock) {
  if (!fs.existsSync(lock)) return null;
  try {
    const lockData = JSON.parse(fs.readFileSync(lock, 'utf8'));
    const receiptPath = lockData.receipt;
    if (!receiptPath || !fs.existsSync(receiptPath)) return { status: 'starting', ...lockData };
    return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch {
    return null;
  }
}

function processIdentity(pid) {
  if (!pid) return null;
  const result = childProcess.spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,command='], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function processAlive(record) {
  return Boolean(record && processIdentity(record.pid) === record.identity);
}

function acquireActiveLock(state, worktree) {
  ensurePrivateDirectory(STATE_ROOT);
  const active = activeReceipt(state.lock);
  if (active) {
    if (active.worktree === worktree && active.status === 'ready') return false;
    const startupOwnerAlive = active.status === 'starting' && processAlive({ pid: active.pid, identity: active.identity });
    if (startupOwnerAlive || active.processes?.some(processAlive)) {
      fail(`another Zoe runtime is active: ${active.worktree}`);
    }
    fs.rmSync(state.lock, { force: true });
  }
  try {
    const fd = fs.openSync(state.lock, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({
      receipt: state.receipt,
      worktree,
      status: 'starting',
      pid: process.pid,
      identity: processIdentity(process.pid),
    }, null, 2));
    fs.closeSync(fd);
  } catch (error) {
    if (error.code === 'EEXIST') fail('another Zoe runtime is starting');
    throw error;
  }
  return true;
}

function writeComposeOverride(state, ports) {
  const override = `services:\n  postgres:\n    ports:\n      - "127.0.0.1:${ports.postgres}:5432"\n  redis:\n    ports:\n      - "127.0.0.1:${ports.redis}:6379"\n  restate:\n    ports:\n      - "127.0.0.1:${ports.restate}:8080"\n      - "127.0.0.1:${ports.restateAdmin}:9070"\n      - "127.0.0.1:${ports.restateIngress}:5122"\n  clickhouse:\n    ports:\n      - "127.0.0.1:${ports.clickhouse}:8123"\n`;
  const file = path.join(state.directory, 'compose.override.yml');
  fs.writeFileSync(file, override, { mode: 0o600 });
  return file;
}

function databaseName(prefix, id) {
  return `${prefix}_${id.replace(/[^a-z0-9_]/gi, '_')}`.slice(0, 55);
}

function createDatabase(composeArgs, name) {
  const identifier = name.replace(/[^a-zA-Z0-9_]/g, '_');
  mustRun([...composeArgs, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    `SELECT format('CREATE DATABASE %I', '${identifier}') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${identifier}')\\gexec`]);
}

function spawnService(command, args, options, logFile) {
  const fd = fs.openSync(logFile, 'a', 0o600);
  const child = childProcess.spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  fs.closeSync(fd);
  const identity = processIdentity(child.pid);
  if (!identity) fail(`service exited immediately: ${command}`);
  return { pid: child.pid, identity };
}

function terminateProcess(record) {
  if (!processAlive(record)) return;
  try {
    process.kill(-record.pid, 'SIGTERM');
  } catch {
    try { process.kill(record.pid, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && processAlive(record)) {
    childProcess.spawnSync('sleep', ['0.1']);
  }
  if (processAlive(record)) {
    try { process.kill(-record.pid, 'SIGKILL'); } catch {}
  }
}

async function fetchSlackAuth(token) {
  const response = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fail(`Slack auth.test returned HTTP ${response.status}`);
  const body = await response.json();
  if (!body.ok || typeof body.user_id !== 'string') fail('Zoe Slack bot authentication failed');
  return { userId: body.user_id, teamId: body.team_id || '' };
}

function waitForHttp(url, label, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = childProcess.spawnSync('curl', ['-fsS', '--connect-timeout', '1', '--max-time', '2', url], { stdio: 'ignore' });
    if (result.status === 0) return;
    childProcess.spawnSync('sleep', ['2']);
  }
  fail(`${label} did not become ready`);
}

async function verifyReadyRuntime(receipt) {
  waitForHttp(`http://127.0.0.1:${receipt.ports.backend}/api/health`, 'worktree backend');
  waitForHttp(`http://127.0.0.1:${receipt.ports.gateway}/readyz`, 'worktree gateway');
  waitForHttp(`https://${receipt.ngrokDomain}/readyz`, 'ngrok tunnel', 60000);
  const gatewayEnv = parseEnv(path.join(receipt.worktree, 'gateway', '.env'));
  const botToken = gatewayEnv.get('SLACK_BOT_TOKEN') || '';
  if (!botToken) fail('SLACK_BOT_TOKEN is missing from the worktree gateway env');
  const slack = await fetchSlackAuth(botToken);
  if (slack.userId !== receipt.zoeUserId) fail('worktree Zoe identity does not match the runtime receipt');
}

function materializeEnvironments({ worktree, sourceRoot, ports, id, backendDatabase, gatewayDatabase }) {
  const sourceGateway = path.join(sourceRoot, 'gateway', '.env');
  const sourceBackend = path.join(sourceRoot, 'backend', '.env');
  const targetGateway = path.join(worktree, 'gateway', '.env');
  const targetBackend = path.join(worktree, 'backend', '.env');
  if (!fs.existsSync(sourceGateway)) fail(`missing protected gateway env source: ${sourceGateway}`);
  if (!fs.existsSync(sourceBackend)) fail(`missing protected backend env source: ${sourceBackend}`);
  ensurePrivateFile(sourceGateway, 'gateway env source');
  ensurePrivateFile(sourceBackend, 'backend env source');

  const gatewaySource = parseEnv(sourceGateway);
  const backendSource = parseEnv(sourceBackend);
  const botToken = gatewaySource.get('SLACK_BOT_TOKEN') || '';
  if (!botToken) fail('SLACK_BOT_TOKEN is missing from the protected gateway env source');

  fs.mkdirSync(path.dirname(targetGateway), { recursive: true });
  fs.mkdirSync(path.dirname(targetBackend), { recursive: true });
  const gatewayKeys = [
    'NODE_ENV', 'LOG_LEVEL', 'ENV_MODE', 'APPLICATION_DOMAIN', 'JWT_SIGNING_KEY',
    'ENCRYPTION_KEY', 'EKM_SERVICE_URL', 'EKM_ACTOR', 'DEK_TRANSIT_KEY',
    'AUTH_SERVICE_URL', 'USER_SERVICE_URL', 'USER_SERVICE', 'ORGANIZATION_SERVICE_URL',
    'WRITER_CLIENT_ID', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET',
    'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_OAUTH_REDIRECT_URL', 'SLACK_SLASH_COMMAND',
    'WRITER_DEFAULT_USER_ID', 'WRITER_DEFAULT_ORG_ID', 'WRITER_DEFAULT_TEAM_ID',
    'WRITER_AGENT_SLACK_ENABLED', 'WRITER_AGENT_SLACK_TEAMMATE_ROUTING', 'FEATURE_FLAGS',
    'STATSIG_SERVER_SDK_KEY', 'PLAYBOOK_AGENT_ID', 'TRIGGER_ENDPOINT',
  ];
  const gateway = new Map();
  for (const key of gatewayKeys) if (gatewaySource.has(key)) gateway.set(key, gatewaySource.get(key));
  gateway.set('PORT', String(ports.gateway));
  gateway.set('PUBLIC_BASE_URL', `https://${NGROK_DOMAIN}`);
  gateway.set('MCP_BASE_URL', `http://127.0.0.1:${ports.gateway}`);
  gateway.set('DB_ENDPOINT', `127.0.0.1:${ports.postgres}`);
  gateway.set('DB_NAME', gatewayDatabase);
  gateway.set('DB_USER', gatewaySource.get('DB_USER') || 'postgres');
  gateway.set('DB_PASSWORD', gatewaySource.get('DB_PASSWORD') || backendSource.get('DB_PASSWORD') || '');
  gateway.set('REDIS_URL', `redis://127.0.0.1:${ports.redis}`);
  gateway.set('WRITER_AGENT_URL', `http://127.0.0.1:${ports.backend}`);
  gateway.set('WRITER_APP_URL', 'https://app.qordobadev.com');
  gateway.set('DISABLE_STARTUP_MIGRATIONS', 'true');
  writeEnv(targetGateway, gateway);

  fs.copyFileSync(sourceBackend, targetBackend);
  fs.chmodSync(targetBackend, 0o600);
  appendEnv(targetBackend, {
    DB_ENDPOINT: `127.0.0.1:${ports.postgres}`,
    DATABASE_NAME: backendDatabase,
    DB_USER: gatewaySource.get('DB_USER') || 'postgres',
    DB_PASSWORD: gatewaySource.get('DB_PASSWORD') || backendSource.get('DB_PASSWORD') || '',
    REDIS_URL: `redis://127.0.0.1:${ports.redis}/0`,
    RESTATE_SERVICE_URL: `http://127.0.0.1:${ports.restate}`,
    RESTATE_SERVICE_NAMESPACE: `gateway-slack-${id}`,
    RESTATE_CALLER_ID: `gateway-slack-${id}-backend`,
    BACKEND_URL: `http://127.0.0.1:${ports.backend}`,
    MESSAGING_GATEWAY: `http://127.0.0.1:${ports.gateway}`,
    DISABLE_STARTUP_MIGRATIONS: 'true',
  });

  const npmrcSource = path.join(sourceRoot, 'gateway', '.npmrc');
  const npmrcTarget = path.join(worktree, 'gateway', '.npmrc');
  if (fs.existsSync(npmrcSource)) {
    ensurePrivateFile(npmrcSource, 'gateway package source');
    fs.copyFileSync(npmrcSource, npmrcTarget);
    fs.chmodSync(npmrcTarget, 0o600);
  } else {
    fail(`missing protected gateway package source: ${npmrcSource}`);
  }
  return { botToken };
}

function composeEnvironment(password, ports) {
  return { ...process.env, DB_PASSWORD: password, LOCALDEV_POSTGRES_PORT: String(ports.postgres), LOCALDEV_REDIS_PORT: String(ports.redis), LOCALDEV_CLICKHOUSE_PORT: String(ports.clickhouse) };
}

function commandEnvironment(file, overrides = {}) {
  return { ...process.env, ...Object.fromEntries(parseEnv(file)), ...overrides };
}

async function startRuntime(worktree, sourceRoot) {
  const absoluteWorktree = fs.realpathSync(worktree);
  const absoluteSource = fs.realpathSync(sourceRoot);
  const state = stateFor(absoluteWorktree);
  ensurePrivateDirectory(STATE_ROOT);
  ensurePrivateDirectory(state.directory);
  const existing = fs.existsSync(state.receipt) ? JSON.parse(fs.readFileSync(state.receipt, 'utf8')) : null;
  if (existing?.status === 'ready' && existing.worktree === absoluteWorktree) {
    if (existing.processes?.every(processAlive)) {
      await verifyReadyRuntime(existing);
      return;
    }
    stopRuntime(absoluteWorktree);
  }
  const acquired = acquireActiveLock(state, absoluteWorktree);
  if (!acquired) return;

  const created = [];
  const activeProcesses = [];
  let receipt = null;
  try {
    const allocation = chooseSlot();
    const { slot, ports } = allocation;
    const id = `${path.basename(absoluteWorktree).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${state.id}`;
    const backendDatabase = databaseName('action_agent', state.id);
    const gatewayDatabase = databaseName('gateway_dev', state.id);
    mustRun([process.execPath, ENV_GUARD_SCRIPT, '--worktree', absoluteSource, '--verify-only']);
    const envResult = materializeEnvironments({ worktree: absoluteWorktree, sourceRoot: absoluteSource, ports, id, backendDatabase, gatewayDatabase });
    const backendEnv = path.join(absoluteWorktree, 'backend', '.env');
    const gatewayEnv = path.join(absoluteWorktree, 'gateway', '.env');
    const password = parseEnv(gatewayEnv).get('DB_PASSWORD') || parseEnv(backendEnv).get('DB_PASSWORD');
    if (!password) fail('DB_PASSWORD is missing from the protected local env sources');
    const composeFile = path.join(absoluteSource, COMPOSE_FILE_NAME);
    if (!fs.existsSync(composeFile)) fail(`missing compose file: ${composeFile}`);
    const override = writeComposeOverride(state, ports);
    const composeArgs = ['docker', 'compose', '-p', `gateway-slack-${state.id}`, '-f', composeFile, '-f', override];
    const composeEnv = composeEnvironment(password, ports);
    // Register ownership before invoking Docker so a partial `up` failure is
    // still rolled back by the same transaction.
    created.push({ kind: 'compose', args: composeArgs, env: composeEnv });
    mustRun([...composeArgs, 'up', '-d', '--wait', 'postgres', 'redis', 'restate', 'clickhouse'], { cwd: absoluteSource, env: composeEnv });
    createDatabase(composeArgs, backendDatabase);
    createDatabase(composeArgs, gatewayDatabase);

    mustRun(['uv', 'sync'], { cwd: path.join(absoluteWorktree, 'backend'), env: commandEnvironment(backendEnv) });
    mustRun(['bun', 'install', '--silent'], { cwd: path.join(absoluteWorktree, 'gateway'), env: commandEnvironment(gatewayEnv) });
    mustRun(['uv', 'run', 'alembic', 'upgrade', 'head'], { cwd: path.join(absoluteWorktree, 'backend'), env: commandEnvironment(backendEnv, { DATABASE_NAME: backendDatabase }) });
    mustRun(['bun', 'run', 'migrate'], { cwd: path.join(absoluteWorktree, 'gateway'), env: commandEnvironment(gatewayEnv) });

    const logs = {
      backend: path.join(state.directory, 'backend.log'),
      worker: path.join(state.directory, 'worker.log'),
      gateway: path.join(state.directory, 'gateway.log'),
      ngrok: path.join(state.directory, 'ngrok.log'),
    };
    const commonBackendEnv = commandEnvironment(backendEnv, { DATABASE_NAME: backendDatabase });
    const backend = spawnService('uv', ['run', 'python', '-m', 'fastapi', 'dev', '--host', '127.0.0.1', '--port', String(ports.backend)], { cwd: path.join(absoluteWorktree, 'backend'), env: commonBackendEnv }, logs.backend);
    activeProcesses.push({ name: 'backend', ...backend });
    const worker = spawnService('uv', ['run', 'dramatiq', '--watch', '.', '--processes', '1', '--threads', '2', 'run_agent_background'], { cwd: path.join(absoluteWorktree, 'backend'), env: commonBackendEnv }, logs.worker);
    activeProcesses.push({ name: 'worker', ...worker });
    const gateway = spawnService('bun', ['run', 'dev'], { cwd: path.join(absoluteWorktree, 'gateway'), env: commandEnvironment(gatewayEnv) }, logs.gateway);
    activeProcesses.push({ name: 'gateway', ...gateway });
    waitForHttp(`http://127.0.0.1:${ports.backend}/api/health`, 'worktree backend');
    waitForHttp(`http://127.0.0.1:${ports.gateway}/readyz`, 'worktree gateway');

    const ngrok = spawnService('ngrok', ['http', String(ports.gateway), `--domain=${NGROK_DOMAIN}`], { cwd: absoluteWorktree, env: process.env }, logs.ngrok);
    activeProcesses.push({ name: 'ngrok', ...ngrok });
    waitForHttp(`https://${NGROK_DOMAIN}/readyz`, 'ngrok tunnel', 60000);
    const slack = await fetchSlackAuth(envResult.botToken);
    receipt = {
      version: RUNTIME_VERSION,
      status: 'ready',
      worktree: absoluteWorktree,
      sourceRoot: absoluteSource,
      stateId: state.id,
      slot,
      ports,
      dockerProject: `gateway-slack-${state.id}`,
      composeFile,
      composeOverride: override,
      databases: { backend: backendDatabase, gateway: gatewayDatabase },
      redisNamespace: `gateway-slack-${id}/db0`,
      restateNamespace: `gateway-slack-${id}`,
      ngrokDomain: NGROK_DOMAIN,
      publicBaseUrl: `https://${NGROK_DOMAIN}`,
      slackEventsUrl: `https://${NGROK_DOMAIN}/gateway/slack/events`,
      zoeUserId: slack.userId,
      zoeTeamId: slack.teamId,
      logs,
      processes: activeProcesses,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(state.receipt, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    fs.chmodSync(state.receipt, 0o600);
  } catch (error) {
    for (const process of [...activeProcesses].reverse()) terminateProcess(process);
    for (const item of created.reverse()) {
      if (item.kind === 'compose') {
        try { mustRun([...item.args, 'down', '-v', '--remove-orphans'], { cwd: absoluteSource, env: item.env }); } catch {}
      }
    }
    fs.rmSync(state.receipt, { force: true });
    fs.rmSync(state.directory, { recursive: true, force: true });
    fs.rmSync(state.lock, { force: true });
    throw error;
  }
}

function readReceipt(worktree) {
  const state = stateFor(fs.realpathSync(worktree));
  if (!fs.existsSync(state.receipt)) fail('no gateway-slack runtime is registered for this worktree');
  const receipt = JSON.parse(fs.readFileSync(state.receipt, 'utf8'));
  if (receipt.version !== RUNTIME_VERSION || receipt.worktree !== fs.realpathSync(worktree)) fail('invalid gateway-slack runtime receipt');
  return { state, receipt };
}

function stopRuntime(worktree) {
  const { state, receipt } = readReceipt(worktree);
  if (receipt.dockerProject !== `gateway-slack-${state.id}`) fail('runtime ownership check failed');
  for (const process of [...(receipt.processes || [])].reverse()) terminateProcess(process);
  const backendEnv = parseEnv(path.join(receipt.worktree, 'backend', '.env'));
  const gatewayEnv = parseEnv(path.join(receipt.worktree, 'gateway', '.env'));
  const composeEnv = composeEnvironment(backendEnv.get('DB_PASSWORD') || gatewayEnv.get('DB_PASSWORD') || '', receipt.ports);
  const composeArgs = ['docker', 'compose', '-p', receipt.dockerProject, '-f', receipt.composeFile, '-f', receipt.composeOverride];
  try { mustRun([...composeArgs, 'down', '-v', '--remove-orphans'], { cwd: receipt.sourceRoot, env: composeEnv }); } catch (error) { fail(`owned runtime teardown failed: ${error.message}`); }
  fs.rmSync(state.receipt, { force: true });
  fs.rmSync(state.directory, { recursive: true, force: true });
  fs.rmSync(state.lock, { force: true });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const worktree = value(args, '--worktree');
  const sourceRoot = value(args, '--source-root', false) || '/Users/michael/development/writer/writer-monorepo';
  if (command === 'start') return startRuntime(worktree, sourceRoot);
  if (command === 'stop') return stopRuntime(worktree);
  if (command === 'status') return JSON.stringify(readReceipt(worktree).receipt);
  fail('usage: gateway-slack-runtime.cjs start|stop|status --worktree <path> [--source-root <path>]');
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
    databaseName,
    materializeEnvironments,
    parseEnv,
    portsForSlot,
    stateFor,
  },
};
