'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SKILL_ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(SKILL_ROOT, 'scripts', 'workflow.cjs');
const COORDINATOR = path.resolve(SKILL_ROOT, '..', '..', 'agents', 'peer-review.md');
const SHARD = path.resolve(SKILL_ROOT, '..', '..', 'agents', 'peer-review-shard.md');
const ARCHITECTURE = path.resolve(SKILL_ROOT, '..', '..', 'agents', 'peer-review-architecture.md');
const WRAPPER = path.join(SKILL_ROOT, 'SKILL.md');
const FIXTURE = path.join(__dirname, 'fixtures', 'fixture.json');
const workflow = require(WORKFLOW);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'peer-review-workflow-'));
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseFrontmatter(file) {
  const script = [
    "require 'yaml'",
    "require 'json'",
    "text = File.read(ARGV[0])",
    "frontmatter = text.split(/^---\\s*$/, 3)[1]",
    "puts JSON.generate(YAML.load(frontmatter))",
  ].join('; ');
  return JSON.parse(childProcess.execFileSync('ruby', ['-e', script, file], { encoding: 'utf8' }));
}

function assertArraySchemasHaveItems(schema, location = 'output') {
  if (!schema || typeof schema !== 'object') {
    return;
  }
  if (schema.type === 'array') {
    assert.ok(schema.items, `${location} array schema is missing items`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object') {
      assertArraySchemasHaveItems(value, `${location}.${key}`);
    }
  }
}

test('parsePrUrl accepts one canonical pull-request URL', () => {
  assert.deepEqual(workflow.parsePrUrl('https://github.com/acme/repo/pull/42'), {
    url: 'https://github.com/acme/repo/pull/42',
    owner: 'acme',
    repo: 'repo',
    pullNumber: 42,
  });
  assert.throws(() => workflow.parsePrUrl('https://github.com/acme/repo/issues/42'), /pull-request URL/);
  assert.throws(() => workflow.parsePrUrl('https://github.com/acme/repo/pull/42 extra'), /pull-request URL/);
});

test('model preflight requires the exact available provider and high reasoning', () => {
  const listing = 'openai-codex\nmodel gpt-5.6-sol thinking low,medium,high,xhigh,max\n';
  assert.equal(workflow.validateModelListing(listing), workflow.REQUIRED_MODEL);
  assert.throws(() => workflow.validateModelListing('No models matching gpt-5.6-sol'), /unavailable/);
  assert.throws(() => workflow.validateModelListing('openai-codex gpt-5.6-sol low,medium'), /unavailable/);
});

test('topology keeps primary ownership and adds only bounded supplements', () => {
  assert.deepEqual(workflow.selectTopology(12, false), []);
  assert.deepEqual(workflow.selectTopology(40, true), ['architecture']);
  assert.deepEqual(workflow.selectTopology(41, false), ['code-01', 'code-02']);
  assert.deepEqual(workflow.selectTopology(80, true), ['code-01', 'code-02', 'architecture']);
});

test('GraphQL collection follows every page', () => {
  const cursors = [];
  const nodes = workflow.collectGraphQlPages(
    'query',
    { owner: 'acme' },
    (response) => response.connection,
    {
      graphQlPage: (_query, variables) => {
        cursors.push(variables.cursor);
        if (!variables.cursor) {
          return { connection: { nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'next' } } };
        }
        return { connection: { nodes: [{ id: 2 }], pageInfo: { hasNextPage: false, endCursor: null } } };
      },
    },
  );
  assert.deepEqual(cursors, [null, 'next']);
  assert.deepEqual(nodes, [{ id: 1 }, { id: 2 }]);
});

test('fixture materialization keeps bot bodies out of blind review context', () => {
  const outputDir = tmp();
  const fixture = workflow.materializeFixture(FIXTURE, outputDir);
  assert.equal(workflow.validateBlindIsolation(fixture.reviewContext), true);
  const blind = read(path.join(outputDir, 'review-context.json'));
  const bots = read(path.join(outputDir, 'bot-inventory.json'));
  assert.doesNotMatch(blind, /review-bot\[bot\]/);
  assert.match(bots, /review-bot\[bot\]/);
  assert.doesNotMatch(blind, /falls back to true, enabling strict behavior/);
});

test('coverage validation requires exact head and every primary path', () => {
  const fixture = JSON.parse(read(FIXTURE));
  const coverage = {
    reviewedSha: 'head-fixture-sha',
    files: [
      { path: 'src/lookup.js', status: 'reviewed' },
      { path: 'src/adapter.js', status: 'reviewed' },
    ],
  };
  assert.deepEqual(workflow.validateCoverage(fixture.manifest, coverage, 'head-fixture-sha'), {
    reviewed: 2,
    generated: 0,
    blocked: 0,
  });
  assert.throws(
    () => workflow.validateCoverage(fixture.manifest, { ...coverage, files: coverage.files.slice(0, 1) }, 'head-fixture-sha'),
    /coverage mismatch/,
  );
  assert.throws(() => workflow.validateCoverage(fixture.manifest, coverage, 'stale-sha'), /coverage SHA/);
});

test('exact-head verification rejects a changed PR head', () => {
  const url = 'https://github.com/acme/repo/pull/42';
  assert.equal(workflow.verifyHead(url, 'same', { fetchPull: () => ({ head: { sha: 'same' } }) }), 'same');
  assert.throws(
    () => workflow.verifyHead(url, 'old', { fetchPull: () => ({ head: { sha: 'new' } }) }),
    /changed from old to new/,
  );
});

test('final head verification can report drift without blocking comment posting', () => {
  const url = 'https://github.com/acme/repo/pull/42';
  assert.equal(
    workflow.verifyHead(url, 'old', {
      fetchPull: () => ({ head: { sha: 'new' } }),
      allowChanged: true,
    }),
    'new',
  );
});

test('GitHub comment filter retains only novel findings and prompts', () => {
  const filtered = workflow.filterNovelComment({
    findings: [
      { title: 'novel', coverage: 'novel' },
      { title: 'active duplicate', coverage: 'active-bot-overlap' },
      { title: 'old duplicate', coverage: 'resolved-or-outdated-bot-overlap' },
    ],
    prompts: [
      { question: 'novel question', coverage: 'novel' },
      { question: 'covered question', coverage: 'active-bot-overlap' },
    ],
  });
  assert.deepEqual(filtered.findings.map((finding) => finding.title), ['novel']);
  assert.deepEqual(filtered.prompts.map((prompt) => prompt.question), ['novel question']);
});

test('child output contracts are strict and every array has an item schema', () => {
  for (const file of [SHARD, ARCHITECTURE]) {
    const frontmatter = parseFrontmatter(file);
    assert.equal(frontmatter.model, workflow.REQUIRED_MODEL);
    assert.equal(frontmatter.output.type, 'object');
    assert.equal(frontmatter.output.additionalProperties, false);
    assert.ok(Array.isArray(frontmatter.output.required));
    assertArraySchemasHaveItems(frontmatter.output);
  }
});

test('wrapper and coordinator declare the intended public identity and model', () => {
  const coordinator = parseFrontmatter(COORDINATOR);
  const wrapper = parseFrontmatter(WRAPPER);
  assert.equal(coordinator.name, 'peer-review');
  assert.equal(coordinator.model, workflow.REQUIRED_MODEL);
  assert.equal(wrapper.name, 'peer-review');
});

test('prompt contract enforces blind review, primary ownership, and diff causality', () => {
  const coordinator = read(COORDINATOR);
  const freeze = coordinator.indexOf('### Freeze candidate findings');
  const reveal = coordinator.indexOf('## Phase 2: Reveal and label bot overlap');
  assert.ok(freeze > 0 && reveal > freeze);
  assert.match(coordinator, /Do not read, grep, summarize, or otherwise expose\n\s+`bot-inventory\.json` until Phase 2/);
  assert.match(coordinator, /The primary reviewer always owns the full PR/);
  assert.match(coordinator, /their failure does not erase primary coverage/);
  assert.match(coordinator, /Findings must be caused by the diff/);
  assert.match(coordinator, /unchanged callers\n+or consumers/);
  assert.match(coordinator, /`Critical`, `Suggested`, `Nits`, and `Systemic` sections as separate\nordered lists/);
  assert.match(coordinator, /Each populated section starts its own count at `1\.`/);
  assert.doesNotMatch(coordinator, /Bots handle line-level quality well/);
});

test('wrapper preflights before relay', () => {
  const wrapper = read(WRAPPER);
  assert.match(wrapper, /preflight --arguments/);
  assert.doesNotMatch(wrapper, /verify-resolved-model --resolved-model/);
  assert.match(wrapper, /exactly one task entry/);
});
