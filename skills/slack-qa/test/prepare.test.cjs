'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { __test } = require('../scripts/prepare.cjs');

test('accepts canonical GitHub pull request URLs', () => {
  assert.deepEqual(__test.parsePrUrl('https://github.com/WriterColab/writer-monorepo/pull/1234'), {
    url: 'https://github.com/WriterColab/writer-monorepo/pull/1234',
    owner: 'WriterColab',
    repo: 'writer-monorepo',
    number: 1234,
  });
});

test('normalizes www and trailing slash in pull request URLs', () => {
  assert.deepEqual(__test.parsePrUrl('https://www.github.com/acme/repo/pull/7/'), {
    url: 'https://github.com/acme/repo/pull/7',
    owner: 'acme',
    repo: 'repo',
    number: 7,
  });
});

test('rejects non-GitHub, non-pull-request, and credential-bearing URLs', () => {
  for (const value of [
    'https://gitlab.com/acme/repo/-/merge_requests/7',
    'https://github.com/acme/repo/issues/7',
    'https://user:pass@github.com/acme/repo/pull/7',
    'https://github.com/acme/repo/pull/7?foo=bar',
    'not-a-url',
  ]) {
    assert.throws(() => __test.parsePrUrl(value), /GitHub pull request URL|github\.com pull request URL|form https/);
  }
});

test('requires the local branch to mirror the pull request head branch', () => {
  assert.doesNotThrow(() => __test.assertBranchMatchesPr(
    { branch: 'feature/slack-change-local' },
    { headRefName: 'feature/slack-change' },
  ));
  assert.throws(() => __test.assertBranchMatchesPr(
    { branch: 'other-feature-local' },
    { headRefName: 'feature/slack-change' },
  ), /does not match pull request head/);
});
