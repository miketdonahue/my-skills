'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { __test } = require('../scripts/direct-message.cjs');

test('redacts Slack and bearer credentials from diagnostics', () => {
  const message = __test.redact('xoxb-secret Bearer xoxp-other');
  assert.equal(message, '[REDACTED_SLACK_TOKEN] Bearer [REDACTED]');
});

test('supports exact, fragment, and regular expression assertions', () => {
  assert.equal(__test.matches({ text: 'done' }, { expectText: 'done' }), true);
  assert.equal(__test.matches({ text: 'done for run 123' }, { expectContains: ['done', '123'] }), true);
  assert.equal(__test.matches({ text: 'done for run 123' }, { expectRegex: '^done.*123$' }), true);
  assert.equal(__test.matches({ text: 'not done' }, { expectText: 'done' }), false);
});

test('supports expected Slack file names', () => {
  const message = { text: 'attached', files: [{ name: 'result.csv', title: 'Result' }] };
  assert.equal(__test.matches(message, { expectFiles: ['result.csv'] }), true);
  assert.equal(__test.matches(message, { expectFiles: ['Result'] }), true);
  assert.equal(__test.matches(message, { expectFiles: ['missing.txt'] }), false);
});

test('requires at least one supported assertion, including file assertions', () => {
  assert.equal(__test.hasAssertion({ expectFiles: ['result.csv'] }), true);
  assert.equal(__test.hasAssertion({ expectFiles: [] }), false);
  assert.equal(__test.hasAssertion({}), false);
});

test('does not retain the legacy process-environment sender token fallback', () => {
  const source = require('node:fs').readFileSync(require.resolve('../scripts/direct-message.cjs'), 'utf8');
  assert.doesNotMatch(source, /SLACK_E2E_USER_TOKEN/);
  assert.doesNotMatch(source, /process\.env\.SLACK_QA_USER_TOKEN/);
});
