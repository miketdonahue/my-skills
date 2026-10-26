#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE = '/Users/michael/development/writer/writer-monorepo';
const ENV_FILES = ['backend/.env', 'gateway/.env'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal', 'postgres', 'localdev', 'localdev-postgres-1']);
const REMOTE_MARKERS = [
  'dev-deer',
  'qordoba',
  'alloydb',
  'cloudsql',
  'cloud-sql',
  'googleapis',
  'amazonaws',
  'rds.amazonaws',
  'writerai',
  '5453',
];

function fail(message) {
  throw new Error(message);
}

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) fail(`Missing value for ${name}`);
  return args[index + 1];
}

function hasFlag(args, name) {
  return args.includes(name);
}

function mkdir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeAtomic(file, text) {
  mkdir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) value = value.slice(1, -1);
    values.set(key, value);
  }
  return values;
}

function setEnvValue(text, key, value) {
  const lines = text.replace(/\s*$/, '').split(/\r?\n/);
  let replaced = false;
  const next = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && match[1] === key) {
      if (!replaced) {
        next.push(`${key}=${value}`);
        replaced = true;
      }
      continue;
    }
    next.push(line);
  }
  if (!replaced) next.push(`${key}=${value}`);
  return `${next.join('\n')}\n`;
}

function isWriterMonorepo(root) {
  return path.basename(root) === 'writer-monorepo'
    || (fs.existsSync(path.join(root, 'backend')) && fs.existsSync(path.join(root, 'gateway')));
}

function dbEndpointKey(key) {
  if (/^(?:PGHOST|PGURL|DATABASE_URL|DB_ENDPOINT|SOURCE_DB_ENDPOINT|TARGET_DB_ENDPOINT|POSTGRES_URL|POSTGRES_HOST)$/i.test(key)) return true;
  if (!/(?:DB|DATABASE|POSTGRES|PG)/i.test(key)) return false;
  return /(?:HOST|ENDPOINT|URL|URI|DSN)$/i.test(key);
}

function hostAndPort(value) {
  const raw = String(value || '').trim();
  if (!raw) return { host: '', port: '' };
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    const withoutAuth = raw.includes('@') ? raw.split('@').pop() : raw;
    const hostPort = withoutAuth.split(/[/?#]/)[0] || withoutAuth;
    const bracket = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (bracket) return { host: bracket[1].toLowerCase(), port: bracket[2] || '' };
    if (/^[^:]+:\d+$/.test(hostPort)) {
      const [host, port] = hostPort.split(':');
      return { host: host.toLowerCase(), port };
    }
  }
  try {
    const url = new URL(raw);
    return { host: url.hostname.toLowerCase(), port: url.port };
  } catch {}
  try {
    const url = new URL(`postgresql://${raw}`);
    return { host: url.hostname.toLowerCase(), port: url.port };
  } catch {}
  const withoutAuth = raw.includes('@') ? raw.split('@').pop() : raw;
  const hostPort = withoutAuth.split(/[/?#]/)[0] || withoutAuth;
  const bracket = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) return { host: bracket[1].toLowerCase(), port: bracket[2] || '' };
  const parts = hostPort.split(':');
  return { host: (parts[0] || '').toLowerCase(), port: parts[1] || '' };
}

function assertLocalDatabaseEndpoint(file, key, value) {
  const normalized = String(value || '').toLowerCase();
  const remoteMarker = REMOTE_MARKERS.find((marker) => normalized.includes(marker));
  if (remoteMarker) fail(`${file}: ${key} points at forbidden non-local database marker "${remoteMarker}"`);
  const { host, port } = hostAndPort(value);
  if (!host) fail(`${file}: ${key} is empty or malformed`);
  if (!LOCAL_HOSTS.has(host) && !host.endsWith('.local')) {
    fail(`${file}: ${key} must point at a local database host, not "${host}"`);
  }
  if (port === '5453') fail(`${file}: ${key} uses port 5453, which is reserved for dev-deer proxy access`);
}

function validateEnvText(relative, text) {
  const values = parseEnv(text);
  if (String(values.get('DISABLE_STARTUP_MIGRATIONS') || '').toLowerCase() !== 'true') {
    fail(`${relative}: DISABLE_STARTUP_MIGRATIONS must be true`);
  }
  const checked = [];
  for (const [key, value] of values) {
    if (!dbEndpointKey(key) || !value) continue;
    assertLocalDatabaseEndpoint(relative, key, value);
    checked.push(key);
  }
  if (checked.length === 0) fail(`${relative}: no database endpoint keys were found to validate`);
  return checked;
}

function materializeFile(sourceRoot, targetRoot, relative, verifyOnly) {
  const source = path.join(sourceRoot, relative);
  const target = path.join(targetRoot, relative);
  if (!fs.existsSync(source)) fail(`Source env file is missing: ${source}`);
  if (!verifyOnly) {
    let text = fs.readFileSync(source, 'utf8');
    text = setEnvValue(text, 'DISABLE_STARTUP_MIGRATIONS', 'true');
    validateEnvText(relative, text);
    writeAtomic(target, text);
  }
  if (!fs.existsSync(target)) fail(`Target env file is missing: ${target}`);
  const checked = validateEnvText(relative, fs.readFileSync(target, 'utf8'));
  return { file: relative, checked };
}

function guard(options) {
  const targetRoot = fs.realpathSync(path.resolve(options.worktree));
  if (!isWriterMonorepo(targetRoot)) return { status: 'SKIPPED', reason: 'not-writer-monorepo', worktree: targetRoot };
  const sourceRoot = fs.realpathSync(path.resolve(options.source || DEFAULT_SOURCE));
  if (!isWriterMonorepo(sourceRoot)) fail(`Source is not writer-monorepo: ${sourceRoot}`);
  const files = ENV_FILES.map((relative) => materializeFile(sourceRoot, targetRoot, relative, options.verifyOnly));
  return { status: 'PASS', worktree: targetRoot, source: sourceRoot, files };
}

function main(argv) {
  const worktree = option(argv, '--worktree');
  const source = option(argv, '--source', DEFAULT_SOURCE);
  const result = guard({ worktree, source, verifyOnly: hasFlag(argv, '--verify-only') });
  if (hasFlag(argv, '--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

module.exports = {
  parseEnv,
  setEnvValue,
  dbEndpointKey,
  hostAndPort,
  guard,
  main,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  }
}
