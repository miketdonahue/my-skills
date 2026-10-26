'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../scripts/gateway-slack-runtime.cjs').__test;

test('gateway Slack port slots are deterministic and isolated', () => {
  const first = runtime.portsForSlot(1);
  const second = runtime.portsForSlot(2);
  assert.equal(second.backend - first.backend, 101);
  assert.equal(second.gateway - first.gateway, 101);
  assert.notEqual(first.postgres, first.redis);
  assert.notEqual(first.restate, first.gateway);
});

test('database names are safe and bounded', () => {
  const name = runtime.databaseName('gateway_dev', 'abc-123-very-long-runtime-id');
  assert.match(name, /^gateway_dev_abc_123/);
  assert.ok(name.length <= 55);
  assert.match(name, /^[A-Za-z0-9_]+$/);
});

test('environment parser uses the last assignment and removes quotes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-env-'));
  const file = path.join(root, '.env');
  fs.writeFileSync(file, 'A=first\nA="second value"\nexport B=third\n');
  const parsed = runtime.parseEnv(file);
  assert.equal(parsed.get('A'), 'second value');
  assert.equal(parsed.get('B'), 'third');
});

test('materializes only the gateway credential allowlist and isolated overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-gateway-slack-env-'));
  const source = path.join(root, 'source');
  const worktree = path.join(root, 'worktree');
  fs.mkdirSync(path.join(source, 'gateway'), { recursive: true });
  fs.mkdirSync(path.join(source, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'gateway'), { recursive: true });
  fs.mkdirSync(path.join(worktree, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(source, 'gateway', '.env'), [
    'SLACK_BOT_TOKEN=xoxb-zoe-secret',
    'SLACK_SIGNING_SECRET=signing-secret',
    'DB_PASSWORD=db-secret',
    'UNRELATED_SECRET=must-not-copy',
  ].join('\n'));
  fs.writeFileSync(path.join(source, 'backend', '.env'), [
    'DISABLE_STARTUP_MIGRATIONS=true',
    'DB_PASSWORD=db-secret',
    'UNRELATED_BACKEND_SECRET=backend-secret',
  ].join('\n'));
  fs.writeFileSync(path.join(source, 'gateway', '.npmrc'), '//registry.example/:_authToken=npm-secret\n', { mode: 0o600 });
  fs.chmodSync(path.join(source, 'gateway', '.env'), 0o600);
  fs.chmodSync(path.join(source, 'backend', '.env'), 0o600);

  runtime.materializeEnvironments({
    worktree,
    sourceRoot: source,
    ports: runtime.portsForSlot(1),
    id: 'runtime-id',
    backendDatabase: 'action_agent_runtime',
    gatewayDatabase: 'gateway_dev_runtime',
  });

  const gateway = fs.readFileSync(path.join(worktree, 'gateway', '.env'), 'utf8');
  const backend = fs.readFileSync(path.join(worktree, 'backend', '.env'), 'utf8');
  assert.match(gateway, /SLACK_BOT_TOKEN=xoxb-zoe-secret/);
  assert.doesNotMatch(gateway, /UNRELATED_SECRET/);
  assert.match(gateway, /DB_NAME=gateway_dev_runtime/);
  assert.match(gateway, /PUBLIC_BASE_URL=https:\/\/castiel-puling-charline\.ngrok-free\.dev/);
  assert.match(backend, /DATABASE_NAME=action_agent_runtime/);
  assert.match(backend, /UNRELATED_BACKEND_SECRET=backend-secret/);
  assert.equal(fs.statSync(path.join(worktree, 'gateway', '.env')).mode & 0o077, 0);
});
