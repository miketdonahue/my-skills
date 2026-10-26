'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const localRuntime = require('../scripts/local-runtime.cjs');
const { __test } = localRuntime;

test('parses protected dotenv values without expanding or logging secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-local-runtime-'));
  const file = path.join(root, '.env');
  fs.writeFileSync(file, 'A=first\nA="second value"\nexport B=third\n');
  const parsed = __test.parseEnv(file);
  assert.equal(parsed.get('A'), 'second value');
  assert.equal(parsed.get('B'), 'third');
});

test('reads distinct Slack credentials from a protected gateway env file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-local-runtime-'));
  const gateway = path.join(root, 'gateway');
  fs.mkdirSync(gateway);
  const file = path.join(gateway, '.env');
  fs.writeFileSync(file, [
    'SLACK_BOT_TOKEN=xoxb-zoe',
    'SLACK_SIGNING_SECRET=signing-secret',
    'SLACK_APP_TOKEN=xapp-zoe',
    'SLACK_QA_USER_TOKEN=xoxp-qa',
  ].join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600);

  assert.deepEqual(__test.readSlackCredentials(root), {
    botToken: 'xoxb-zoe',
    signingSecret: 'signing-secret',
    appToken: 'xapp-zoe',
    qaUserToken: 'xoxp-qa',
  });
});

test('rejects a missing or reused Slack QA sender token without exposing credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-local-runtime-'));
  const gateway = path.join(root, 'gateway');
  fs.mkdirSync(gateway);
  const file = path.join(gateway, '.env');
  fs.writeFileSync(file, [
    'SLACK_BOT_TOKEN=xoxb-zoe',
    'SLACK_SIGNING_SECRET=signing-secret',
    'SLACK_APP_TOKEN=xapp-zoe',
  ].join('\n'));
  fs.chmodSync(file, 0o600);
  assert.throws(() => __test.readSlackCredentials(root), /SLACK_QA_USER_TOKEN is missing/);

  fs.appendFileSync(file, '\nSLACK_QA_USER_TOKEN=xoxb-zoe\n');
  assert.throws(() => __test.readSlackCredentials(root), /must be distinct/);
});

test('rejects a group- or world-readable gateway env file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-local-runtime-'));
  const gateway = path.join(root, 'gateway');
  fs.mkdirSync(gateway);
  const file = path.join(gateway, '.env');
  fs.writeFileSync(file, [
    'SLACK_BOT_TOKEN=xoxb-zoe',
    'SLACK_SIGNING_SECRET=signing-secret',
    'SLACK_APP_TOKEN=xapp-zoe',
    'SLACK_QA_USER_TOKEN=xoxp-qa',
  ].join('\n'));
  fs.chmodSync(file, 0o640);
  assert.throws(() => __test.readSlackCredentials(root), /readable only by that user/);
});

test('authenticates Zoe and the QA sender with separate auth.test credentials', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, authorization: options.headers.authorization });
    return {
      ok: true,
      json: async () => ({ ok: true, user_id: calls.length === 1 ? 'U_ZOE' : 'U_QA', team_id: 'T_LOCAL' }),
    };
  };

  try {
    assert.deepEqual(await __test.slackAuthTest('xoxb-zoe', 'local Zoe bot'), {
      userId: 'U_ZOE',
      teamId: 'T_LOCAL',
    });
    assert.deepEqual(await __test.slackAuthTest('xoxp-qa', 'Slack QA sender'), {
      userId: 'U_QA',
      teamId: 'T_LOCAL',
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    { url: 'https://slack.com/api/auth.test', authorization: 'Bearer xoxb-zoe' },
    { url: 'https://slack.com/api/auth.test', authorization: 'Bearer xoxp-qa' },
  ]);
});

test('accepts only checkout-contained process directories', () => {
  assert.equal(__test.isWithin('/tmp/repo', '/tmp/repo/backend'), true);
  assert.equal(__test.isWithin('/tmp/repo', '/tmp/repository'), false);
  assert.equal(__test.isWithin('/tmp/repo', '/tmp/repo/../other'), false);
});

test('validates local port values', () => {
  assert.equal(__test.validPort('3847', 'gateway'), 3847);
  assert.throws(() => __test.validPort('0', 'gateway'), /valid TCP port/);
  assert.throws(() => __test.validPort('not-a-port', 'gateway'), /valid TCP port/);
});

test('exports the credential reader used by the direct-message helper', () => {
  assert.equal(typeof localRuntime.readSlackCredentials, 'function');
});
