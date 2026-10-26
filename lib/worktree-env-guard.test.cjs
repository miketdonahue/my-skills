'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.resolve(__dirname, 'worktree-env-guard.cjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-env-guard-'));
}

function writerRepo(root, name = 'writer-monorepo') {
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'gateway'), { recursive: true });
  return repo;
}

function writeEnv(repo, backendDb, gatewayDb, migrationValue = 'false') {
  fs.writeFileSync(path.join(repo, 'backend', '.env'), [
    `DISABLE_STARTUP_MIGRATIONS=${migrationValue}`,
    `DB_ENDPOINT=${backendDb}`,
    'DB_USER=local_user',
    'DB_PASSWORD=local_password',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repo, 'gateway', '.env'), [
    `DB_ENDPOINT=${gatewayDb}`,
    'DB_USER=local_user',
    'DB_PASSWORD=local_password',
    '',
  ].join('\n'));
}

function run(args) {
  return childProcess.execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function assertFails(args, expected) {
  assert.throws(
    () => run(args),
    (error) => String(error.stderr || error.message).includes(expected),
  );
}

test('materializes writer-monorepo env files and forces startup migrations off', () => {
  const root = tmp();
  const source = writerRepo(root, 'source-writer-monorepo');
  const target = writerRepo(root, 'writer-monorepo');
  writeEnv(source, 'localhost:5444', 'postgresql://local_user:secret@127.0.0.1:5444/gateway_dev');

  const result = JSON.parse(run(['--worktree', target, '--source', source, '--json']));
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.files.map((file) => file.file), ['backend/.env', 'gateway/.env']);

  const backend = fs.readFileSync(path.join(target, 'backend', '.env'), 'utf8');
  const gateway = fs.readFileSync(path.join(target, 'gateway', '.env'), 'utf8');
  assert.match(backend, /^DISABLE_STARTUP_MIGRATIONS=true$/m);
  assert.match(gateway, /^DISABLE_STARTUP_MIGRATIONS=true$/m);
  assert.match(backend, /^DB_ENDPOINT=localhost:5444$/m);
});

test('verify-only rejects dev-deer proxy and other non-local database endpoints', () => {
  const root = tmp();
  const target = writerRepo(root, 'writer-monorepo');
  writeEnv(target, 'localhost:5453', 'postgresql://user:secret@dev-deer.example.internal/gateway_dev', 'true');

  assertFails(['--worktree', target, '--verify-only'], '5453');
});

test('unsafe source env is rejected before it is written to the target', () => {
  const root = tmp();
  const source = writerRepo(root, 'source-writer-monorepo');
  const target = writerRepo(root, 'writer-monorepo');
  writeEnv(source, 'dev-deer.internal:5432', 'localhost:5444', 'true');

  assertFails(['--worktree', target, '--source', source], 'dev-deer');
  assert.equal(fs.existsSync(path.join(target, 'backend', '.env')), false);
});

test('non-writer repositories are skipped', () => {
  const root = tmp();
  const repo = path.join(root, 'other-repo');
  fs.mkdirSync(repo);
  const result = JSON.parse(run(['--worktree', repo, '--json']));
  assert.equal(result.status, 'SKIPPED');
});
