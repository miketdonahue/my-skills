'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createFixture } = require('../../../lib/test-worktree-fixture.cjs');
const { sessionDirectory } = require('../../../lib/herdr-worktree-inventory.cjs');
const { __test } = require('../scripts/workflow.cjs');

test('lists managed worktrees and renders joined Herdr state', () => {
  const fixture = createFixture();
  const sessionRoot = path.join(path.dirname(fixture.repo), 'sessions');
  fixture.env.OMP_AGENT_SESSIONS = sessionRoot;
  const activity = [
    [fixture.openPath, '2026-09-01T12:00:00.000Z'],
    [fixture.workingPath, '2026-09-03T12:00:00.000Z'],
    [fixture.parkedPath, '2026-09-08T12:00:00.000Z'],
  ];
  for (const [worktreePath, timestamp] of activity) {
    const directory = sessionDirectory(worktreePath, sessionRoot);
    fs.mkdirSync(directory, { recursive: true });
    const log = path.join(directory, 'session.jsonl');
    fs.writeFileSync(log, '{}\n');
    const date = new Date(timestamp);
    fs.utimesSync(log, date, date);
  }
  const result = require('node:child_process').spawnSync(process.execPath, [
    require('node:path').resolve(__dirname, '../scripts/workflow.cjs'),
    'invoke', '--cwd', fixture.repo, '--arguments', '',
  ], { env: fixture.env, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\| PARKED \| 2026-09-08 12:00 UTC \| - \| - \| no \| parked-branch \|/);
  assert.match(result.stdout, /\| OPEN \| 2026-09-03 12:00 UTC \| w-working \| working \| yes \| working-branch \|/);
  assert.match(result.stdout, /\| OPEN \| 2026-09-01 12:00 UTC \| w-open \| idle \| no \| open-branch \|/);
  assert.match(result.stdout, /\| PRUNABLE \| - \| - \| - \| no \| prunable-branch \|/);
  assert.ok(result.stdout.indexOf('parked-branch') < result.stdout.indexOf('working-branch'));
  assert.ok(result.stdout.indexOf('working-branch') < result.stdout.indexOf('open-branch'));
  assert.doesNotMatch(result.stdout, /external-branch/);
});

test('parses repo override and rejects unexpected arguments', () => {
  assert.deepEqual(__test.parseArgs(['--repo', '/tmp/repo']), { repo: '/tmp/repo', search: '' });
  assert.deepEqual(__test.parseArgs(['8663']), { repo: null, search: '8663' });
  assert.deepEqual(__test.parseArgs(['action', '8663']), { repo: null, search: 'action 8663' });
  assert.throws(() => __test.parseArgs(['--bad']), /unexpected arguments/);
});

test('filters results by a case-insensitive branch substring', () => {
  const fixture = createFixture();
  const result = require('node:child_process').spawnSync(process.execPath, [
    require('node:path').resolve(__dirname, '../scripts/workflow.cjs'),
    'invoke', '--cwd', fixture.repo, '--arguments', 'WORKING',
  ], { env: fixture.env, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /branch contains "WORKING"/);
  assert.match(result.stdout, /\| OPEN \| .* \| working-branch \|/);
  assert.doesNotMatch(result.stdout, /open-branch|parked-branch|prunable-branch/);
});

test('reports when a branch search has no matches', () => {
  const fixture = createFixture();
  const result = require('node:child_process').spawnSync(process.execPath, [
    require('node:path').resolve(__dirname, '../scripts/workflow.cjs'),
    'invoke', '--cwd', fixture.repo, '--arguments', '8663',
  ], { env: fixture.env, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No matching worktrees/);
  assert.doesNotMatch(result.stdout, /open-branch|working-branch|parked-branch|prunable-branch/);
});

test('formats missing activity timestamps as a placeholder', () => {
  assert.equal(__test.formatLastActive(null), '-');
  assert.equal(__test.formatLastActive(Date.parse('2026-09-08T12:00:00.000Z')), '2026-09-08 12:00 UTC');
});
