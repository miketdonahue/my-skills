'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'workflow.cjs');
const FEATURE_AGENT = path.resolve(__dirname, '..', '..', '..', 'agents', 'feature.md');
const TEST_PRUNER_AGENT = path.resolve(__dirname, '..', '..', '..', 'agents', 'feature-test-pruner.md');
const workflow = require(SCRIPT);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feature-workflow-'));
}
function run(command, args, options = {}) {
  return childProcess.execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function runJson(args, options = {}) {
  return JSON.parse(run(process.execPath, [SCRIPT, ...args], options));
}
function assertFails(args, expected, options = {}) {
  assert.throws(
    () => run(process.execPath, [SCRIPT, ...args], options),
    (error) => String(error.stderr || error.message).includes(expected),
  );
}
function git(repo, args) {
  return run('git', ['-C', repo, ...args]);
}
function createRepo(name = 'repo') {
  const root = tmp();
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, name);
  run('git', ['init', '--bare', origin]);
  fs.mkdirSync(repo);
  run('git', ['init', '-b', 'main'], { cwd: repo });
  git(repo, ['config', 'user.email', 'feature@example.com']);
  git(repo, ['config', 'user.name', 'Feature Test']);
  git(repo, ['remote', 'add', 'origin', origin]);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['push', '-u', 'origin', 'main']);
  return { root, repo, origin };
}
function writeLocalEnvSource(root) {
  const source = path.join(root, 'source-writer-monorepo');
  fs.mkdirSync(path.join(source, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(source, 'gateway'), { recursive: true });
  fs.writeFileSync(path.join(source, 'backend', '.env'), 'DISABLE_STARTUP_MIGRATIONS=false\nDB_ENDPOINT=localhost:5444\nDB_USER=local\nDB_PASSWORD=local\n');
  fs.writeFileSync(path.join(source, 'gateway', '.env'), 'DB_ENDPOINT=postgresql://local:secret@127.0.0.1:5444/gateway_dev\nDB_USER=local\nDB_PASSWORD=local\n');
  return source;
}
function envFor(root) {
  return {
    ...process.env,
    FEATURE_RUNS_ROOT: path.join(root, 'runs'),
    FEATURE_WORKTREES_ROOT: path.join(root, 'worktrees'),
    FEATURE_DISABLE_HERDR: '1',
  };
}
function admitAndWorktree(repoInfo, rawArguments) {
  const env = envFor(repoInfo.root);
  const admitted = runJson(['admit', '--cwd', repoInfo.repo, '--arguments', rawArguments], { env });
  const created = runJson(['create-worktree', '--run-dir', admitted.runDir], { env });
  return { env, admitted, created };
}
function commitChange(worktree, file, contents) {
  const absolute = path.join(worktree, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
  git(worktree, ['add', file]);
  git(worktree, ['commit', '-m', 'change']);
}

test('parser accepts only ticket and optional plan', () => {
  assert.deepEqual(workflow.parseInvocation('--ticket ACTION-1234'), { ticket: 'ACTION-1234', plan: null });
  assert.deepEqual(workflow.parseInvocation('--ticket ACTION-1234 --plan "plans/final plan.md"'), {
    ticket: 'ACTION-1234',
    plan: 'plans/final plan.md',
  });
  assert.throws(() => workflow.parseInvocation('--ticket ACTION-1234 --has-plan'), /accepts only/);
  assert.throws(() => workflow.parseInvocation('--ticket ACTION-1234 extra'), /accepts only/);
  assert.throws(() => workflow.parseInvocation('--plan plan.md'), /--ticket is required/);
});

test('comment audit allows concise TSDoc only above a function or class', () => {
  const source = `/**
 * Reuses the active profile so reconnects preserve its identity.
 */
export async function reconnectProfile() {
  return true;
}
`;

  assert.deepEqual(workflow.auditJavaScriptComments(source, [1, 2, 3, 4, 5]), []);
});

test('comment audit rejects narration, separators, misplaced TSDoc, and metadata', () => {
  const source = `/** ACTION-8117 - Gateway observability metrics. */
import { Counter } from "prom-client";

// withDependencyRequest helper
/**
 * This comment explains every implementation branch in excessive detail.
 * It includes more detail than a maintainer needs to understand the function.
 * It keeps going so the deterministic comment budget is exceeded deliberately.
 * It also documents another branch and another branch and another branch.
 * It should be replaced with clearer code and a focused test.
 * It should not become a maintenance essay in the source file.
 * It should remain shorter than this deliberately bad example.
 */
const helper = () => Counter;

/** This documents a real function contract. */
function usefulFunction() {
  // narrates the return statement
  return helper;
}
`;

  const violations = workflow.auditJavaScriptComments(source);
  assert.ok(violations.some((violation) => violation.issue.includes('Only concise TSDoc')));
  assert.ok(violations.some((violation) => violation.issue.includes('directly above')));
  assert.ok(violations.some((violation) => violation.issue.includes('maximum')));
  assert.ok(violations.some((violation) => violation.issue.includes('ticket, PR')));
});

test('comment audit ignores comment text inside strings and regular expressions', () => {
  const source = `
const message = "// this is not a source comment";
const pattern = /https?:\\/\\/example\\.com/;
function clean() {
  return message;
}
`;

  assert.deepEqual(workflow.auditJavaScriptComments(source), []);
});

test('admit validates plan source and records source hash', () => {
  const repoInfo = createRepo();
  const plan = path.join(repoInfo.repo, 'plan.md');
  fs.writeFileSync(plan, '# final plan\n');
  const env = envFor(repoInfo.root);
  const admitted = runJson(['admit', '--cwd', repoInfo.repo, '--arguments', '--ticket ACTION-2000 --plan plan.md'], { env });
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.ticket, 'ACTION-2000');
  assert.equal(manifest.planPath, plan);
  assert.equal(manifest.ticketProvider, 'unresolved');
  assert.match(manifest.sourceHash, /^[a-f0-9]{64}$/);
  assertFails(['admit', '--cwd', repoInfo.repo, '--arguments', '--ticket ACTION-2000 --plan missing.md'], 'plan file was not found', { env });
});

test('create-worktree creates isolated branch under configured worktree root', () => {
  const repoInfo = createRepo();
  const bin = path.join(repoInfo.root, 'bin');
  const marker = path.join(repoInfo.root, 'herdr-called');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'herdr'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o700 });
  const env = { ...envFor(repoInfo.root), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const admitted = runJson(['admit', '--cwd', repoInfo.repo, '--arguments', '--ticket ACTION-3000'], { env });
  const created = runJson(['create-worktree', '--run-dir', admitted.runDir], { env });
  assert.equal(created.branch, 'action-3000');
  assert.ok(created.workingDirectory.startsWith(path.join(repoInfo.root, 'worktrees')));
  assert.equal(path.basename(created.workingDirectory), 'action-3000');
  assert.equal(git(created.workingDirectory, ['branch', '--show-current']), 'action-3000');
  assert.equal(git(created.workingDirectory, ['rev-parse', 'HEAD']), created.baseSHA);
  assert.equal(fs.existsSync(marker), false);
});

test('writer-monorepo worktrees materialize guarded local env files', () => {
  const repoInfo = createRepo('writer-monorepo');
  fs.mkdirSync(path.join(repoInfo.repo, 'backend'));
  fs.mkdirSync(path.join(repoInfo.repo, 'gateway'));
  fs.writeFileSync(path.join(repoInfo.repo, 'backend', 'README.md'), 'backend\n');
  fs.writeFileSync(path.join(repoInfo.repo, 'gateway', 'README.md'), 'gateway\n');
  fs.writeFileSync(path.join(repoInfo.repo, '.gitignore'), 'backend/.env\ngateway/.env\n');
  git(repoInfo.repo, ['add', 'backend/README.md', 'gateway/README.md', '.gitignore']);
  git(repoInfo.repo, ['commit', '-m', 'add service roots']);
  git(repoInfo.repo, ['push', 'origin', 'main']);
  const envSource = writeLocalEnvSource(repoInfo.root);
  const env = { ...envFor(repoInfo.root), FEATURE_ENV_SOURCE: envSource };

  const admitted = runJson(['admit', '--cwd', repoInfo.repo, '--arguments', '--ticket ACTION-3010'], { env });
  const created = runJson(['create-worktree', '--run-dir', admitted.runDir], { env });
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  const backendEnv = fs.readFileSync(path.join(created.workingDirectory, 'backend', '.env'), 'utf8');
  const gatewayEnv = fs.readFileSync(path.join(created.workingDirectory, 'gateway', '.env'), 'utf8');

  assert.equal(manifest.envGuard.status, 'PASS');
  assert.match(backendEnv, /^DISABLE_STARTUP_MIGRATIONS=true$/m);
  assert.match(gatewayEnv, /^DISABLE_STARTUP_MIGRATIONS=true$/m);
  assert.equal(git(created.workingDirectory, ['status', '--porcelain', '--', 'backend/.env', 'gateway/.env']), '');
});

test('feature reuses the linked worktree where it was invoked', () => {
  const repoInfo = createRepo();
  const manualWorktree = path.join(repoInfo.root, 'manual-space');
  git(repoInfo.repo, ['worktree', 'add', '-b', 'projects-v2-settings', manualWorktree, 'origin/main']);
  const env = envFor(repoInfo.root);
  const admitted = runJson(['admit', '--cwd', manualWorktree, '--arguments', '--ticket ACTION-7922'], { env });
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.reuseWorktree, true);
  assert.equal(manifest.worktree, fs.realpathSync(manualWorktree));
  assert.equal(manifest.branch, 'projects-v2-settings');
  const created = runJson(['create-worktree', '--run-dir', admitted.runDir], { env });
  assert.equal(created.workingDirectory, fs.realpathSync(manualWorktree));
  assert.equal(created.branch, 'projects-v2-settings');
  assert.equal(git(manualWorktree, ['branch', '--show-current']), 'projects-v2-settings');
  assert.equal(fs.existsSync(path.join(repoInfo.root, 'worktrees')), false);
});

test('feature rejects a dirty linked worktree instead of mixing user changes with a ticket run', () => {
  const repoInfo = createRepo();
  const manualWorktree = path.join(repoInfo.root, 'dirty-space');
  git(repoInfo.repo, ['worktree', 'add', '-b', 'projects-v2-settings', manualWorktree, 'origin/main']);
  fs.writeFileSync(path.join(manualWorktree, 'local-notes.txt'), 'uncommitted\n');
  const env = envFor(repoInfo.root);
  assertFails(['admit', '--cwd', manualWorktree, '--arguments', '--ticket ACTION-7922'], 'current linked worktree is dirty', { env });
});

test('existing branches fail unless resuming the same run', () => {
  const repoInfo = createRepo();
  git(repoInfo.repo, ['branch', 'action-3001']);
  const env = envFor(repoInfo.root);
  const admitted = runJson(['admit', '--cwd', repoInfo.repo, '--arguments', '--ticket ACTION-3001'], { env });
  assertFails(['create-worktree', '--run-dir', admitted.runDir], 'branch already exists locally', { env });
});

test('state transitions and receipts are persisted', () => {
  const repoInfo = createRepo();
  const { env, admitted } = admitAndWorktree(repoInfo, '--ticket ACTION-4000');
  const manifestPath = admitted.manifestPath;
  runJson(['transition', '--manifest', manifestPath, '--to', 'context.ready'], { env });
  const receipt = runJson(['receipt', '--manifest', manifestPath, '--phase', 'verify', '--status', 'PASS', '--data', '{"commands":["npm test"]}'], { env });
  assert.equal(receipt.phase, 'verify');
  assert.equal(receipt.status, 'PASS');
  assertFails(['transition', '--manifest', manifestPath, '--to', 'complete'], 'Illegal workflow transition', { env });
});

test('block command routes to final-report instead of terminal blocked', () => {
  const repoInfo = createRepo();
  const { env, admitted } = admitAndWorktree(repoInfo, '--ticket ACTION-4050');
  const blocked = runJson(['block', '--manifest', admitted.manifestPath, '--phase', 'admit', '--reason', 'metadata mismatch'], { env });
  assert.equal(blocked.state, 'report.ready');
  assert.equal(blocked.blockers[0].reason, 'metadata mismatch');
  const remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.data.items[0].phase, 'admit');
  const report = runJson(['final-report', '--manifest', admitted.manifestPath], { env });
  assert.equal(report.status, 'NEEDS_HUMAN');
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'complete');
});

test('repair-cycle enforces one shared QA or review repair cycle', () => {
  const repoInfo = createRepo();
  const { env, admitted } = admitAndWorktree(repoInfo, '--ticket ACTION-4500');
  const manifestPath = admitted.manifestPath;
  runJson(['transition', '--manifest', manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', manifestPath, '--to', 'qa.ready'], { env });
  const qaCycle = runJson(['repair-cycle', '--manifest', manifestPath, '--phase', 'qa'], { env });
  assert.deepEqual(qaCycle, { status: 'PASS', phase: 'qa', cycle: 1, remaining: 0 });
  runJson(['transition', '--manifest', manifestPath, '--to', 'review.ready'], { env });
  assertFails(['repair-cycle', '--manifest', manifestPath, '--phase', 'review'], 'limit reached', { env });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.attempts, { repairCycles: 1, reviewCycles: 0, reviewPasses: 0 });
});

test('style-gate records a PASS for clean changed files', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-4600');
  commitChange(created.workingDirectory, 'README.md', '# clean\n');
  const style = runJson(['style-gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(style.status, 'PASS');
  assert.equal(style.phase, 'style');
  assert.equal(style.data.files.length, 1);
});

test('style-gate fails changed JavaScript files with forbidden comments', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-4601');
  commitChange(created.workingDirectory, 'src/metrics.ts', '// file header\nexport const metric = 1;\n');
  const style = runJson(['style-gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(style.status, 'FAIL');
  const commentCheck = style.data.checks.find((check) => check.kind === 'comment-policy');
  assert.equal(commentCheck.status, 'FAIL');
  assert.match(commentCheck.evidence, /src\/metrics\.ts:1/);
});

test('working-tree comment audit sees uncommitted and untracked JavaScript files', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-4602');
  fs.mkdirSync(path.join(created.workingDirectory, 'src'), { recursive: true });
  fs.writeFileSync(path.join(created.workingDirectory, 'src', 'uncommitted.ts'), '// remove me\nexport const value = 1;\n');
  const audit = runJson(['comment-audit', '--manifest', admitted.manifestPath, '--working-tree'], { env });
  assert.equal(audit.status, 'FAIL');
  assert.equal(audit.workingTree, true);
  assert.equal(audit.violations[0].file, 'src/uncommitted.ts');
});

test('style-gate records remaining work and final-report instead of throwing', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-4650');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'implementing'], { env });
  commitChange(created.workingDirectory, 'README.md', '# trailing whitespace \n');
  const style = runJson(['style-gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(style.status, 'FAIL');
  let manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'implementing');
  const remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.status, 'RECORDED');
  assert.equal(remaining.data.items[0].phase, 'style');
  const report = runJson(['final-report', '--manifest', admitted.manifestPath], { env });
  assert.equal(report.status, 'NEEDS_HUMAN');
  assert.match(report.summaryMarkdown, /Remaining work:/);
  manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'complete');
});

test('final-report summary mode prints Markdown instead of raw JSON', () => {
  const repoInfo = createRepo();
  const { env, admitted } = admitAndWorktree(repoInfo, '--ticket ACTION-4655');
  runJson(['block', '--manifest', admitted.manifestPath, '--phase', 'admit', '--reason', 'metadata mismatch'], { env });
  const summary = run(process.execPath, [SCRIPT, 'final-report', '--manifest', admitted.manifestPath, '--summary'], { env });
  assert.match(summary, /^Status: NEEDS_HUMAN\nTicket: ACTION-4655/m);
  assert.match(summary, /Remaining work:\n\[admit\/BLOCKED\] metadata mismatch/);
  assert.doesNotMatch(summary, /^\{/);
  const receipt = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'final-report.json'), 'utf8'));
  assert.equal(receipt.status, 'NEEDS_HUMAN');
  assert.match(receipt.summaryMarkdown, /^Status: NEEDS_HUMAN/);
});

test('style-gate pass clears stale style remaining work and gate resumes report-ready runs', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-4651');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'implementing'], { env });
  commitChange(created.workingDirectory, 'README.md', '# trailing whitespace \n');
  const failedStyle = runJson(['style-gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(failedStyle.status, 'FAIL');
  let manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'implementing');
  commitChange(created.workingDirectory, 'README.md', '# clean\n');
  const passingStyle = runJson(['style-gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(passingStyle.status, 'PASS');
  let remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.status, 'PASS');
  assert.equal(remaining.data.items.length, 0);
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'qa.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'verify', '--status', 'PASS', '--data', '{}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'qa', '--status', 'COMPLETE', '--data', '{"scenarios":[]}'], { env });
  const gate = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(gate.status, 'PASS_WITH_REMAINDERS');
  manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'publish.ready');
  remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.data.items.some((item) => item.phase === 'style'), false);
  assert.equal(remaining.data.items.some((item) => item.phase === 'review'), true);
});

test('diff-scope records changed files and changed line maps', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-5000');
  commitChange(created.workingDirectory, 'backend/app.py', 'one\nchanged\n');
  const scope = runJson(['diff-scope', '--manifest', admitted.manifestPath], { env });
  assert.equal(scope.files.length, 1);
  assert.equal(scope.files[0].file, 'backend/app.py');
  assert.deepEqual(scope.files[0].changedLines, [1, 2]);
});

test('rule resolution is dynamic by changed path', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-6000');
  fs.mkdirSync(path.join(created.workingDirectory, 'gateway', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(created.workingDirectory, 'gateway', 'agents', 'code-review.md'), 'gateway review\n');
  fs.writeFileSync(path.join(created.workingDirectory, 'gateway', 'agents', 'code-styles.md'), 'gateway style\n');
  fs.mkdirSync(path.join(created.workingDirectory, 'backend', 'service'), { recursive: true });
  fs.writeFileSync(path.join(created.workingDirectory, 'backend', 'AGENTS.md'), 'backend rules\n');
  fs.writeFileSync(path.join(created.workingDirectory, 'backend', 'code-styles.md'), 'backend style\n');
  let rules = runJson(['rules', '--manifest', admitted.manifestPath, '--file', 'gateway/src/file.ts'], { env });
  assert.equal(rules.category, 'gateway');
  assert.equal(rules.missingRequired.length, 0);
  assert.equal(rules.codeStyles.length, 1);
  rules = runJson(['rules', '--manifest', admitted.manifestPath, '--file', 'backend/service/app.py'], { env });
  assert.equal(rules.category, 'backend');
  assert.equal(rules.required.length, 1);
});

test('review fingerprints record a repeated critical finding without blocking the workflow', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-7000');
  commitChange(created.workingDirectory, 'frontend/app.ts', 'export const value = 1;\n');
  const scope = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  const finding = {
    verdict: 'FAIL',
    reviewedSha: scope.head,
    findings: [{ severity: 'Critical', rule: 'correctness', line: '1', issue: 'unsafe behavior' }],
  };
  const first = runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.ts', '--data', JSON.stringify(finding)], { env });
  assert.equal(first.status, 'FAIL');
  commitChange(created.workingDirectory, 'frontend/other.ts', 'export const other = 1;\n');
  const next = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  const second = runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.ts', '--data', JSON.stringify({
    ...finding,
    reviewedSha: next.head,
  })], { env });
  assert.equal(second.status, 'BLOCKED');
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'worktree.ready');
  const remainders = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'review-remainders.json'), 'utf8'));
  assert.equal(remainders.status, 'RECORDED');
  assert.equal(remainders.data.items[0].kind, 'repeated_critical_finding');
  assert.equal(remainders.data.items[0].file, 'frontend/app.ts');
});

test('identical review submissions are idempotent', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-7100');
  commitChange(created.workingDirectory, 'frontend/app.ts', 'export const value = 1;\n');
  const scope = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  const data = { reviewedSha: scope.head, verdict: 'PASS', findings: [] };
  const first = runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.ts', '--data', JSON.stringify(data)], { env });
  const second = runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.ts', '--data', JSON.stringify(data)], { env });
  assert.equal(first.status, 'PASS');
  assert.equal(second.status, 'PASS');
  assert.equal(second.deduplicated, true);
  assert.equal(fs.readdirSync(path.join(admitted.runDir, 'receipts', 'reviews')).length, 1);
});

test('review plan and batch receipts preserve unchanged-file coverage', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-7500');
  commitChange(created.workingDirectory, 'frontend/one.ts', 'export const one = 1;\n');
  commitChange(created.workingDirectory, 'frontend/two.ts', 'export const two = 2;\n');
  const initial = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  assert.deepEqual(initial.files.map((file) => file.needsReview), [true, true]);
  assert.equal(initial.reviewPass, 1);
  assert.equal(runJson(['review-plan', '--manifest', admitted.manifestPath], { env }).reviewPass, 1);
  const initialReviews = runJson(['record-reviews', '--manifest', admitted.manifestPath, '--data', JSON.stringify(initial.files.map((file) => ({
    file: file.file,
    reviewedSha: initial.head,
    verdict: 'PASS',
    findings: [],
  })))], { env });
  assert.equal(initialReviews.length, 2);

  commitChange(created.workingDirectory, 'frontend/one.ts', 'export const one = 3;\n');
  const next = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  assert.equal(next.reviewPass, 2);
  const byFile = new Map(next.files.map((file) => [file.file, file]));
  assert.equal(byFile.get('frontend/one.ts').needsReview, true);
  assert.equal(byFile.get('frontend/two.ts').needsReview, false);
  assert.notEqual(byFile.get('frontend/one.ts').scopeFingerprint, initial.files.find((file) => file.file === 'frontend/one.ts').scopeFingerprint);
  assert.equal(byFile.get('frontend/two.ts').scopeFingerprint, initial.files.find((file) => file.file === 'frontend/two.ts').scopeFingerprint);

  const updated = runJson(['record-reviews', '--manifest', admitted.manifestPath, '--data', JSON.stringify([{
    file: 'frontend/one.ts',
    reviewedSha: next.head,
    verdict: 'PASS',
    findings: [],
  }])], { env });
  assert.equal(updated[0].status, 'PASS');
  assert.equal(runJson(['review-plan', '--manifest', admitted.manifestPath], { env }).files.every((file) => !file.needsReview), true);
  commitChange(created.workingDirectory, 'frontend/two.ts', 'export const two = 2;\nupdated\n');
  const limited = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  assert.equal(limited.status, 'LIMIT_REACHED');
  assert.equal(limited.reviewPassLimitReached, true);
  assert.equal(limited.reviewPass, 2);
  const remainders = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'review-remainders.json'), 'utf8'));
  assert.equal(remainders.status, 'RECORDED');
  assert.equal(remainders.data.items[0].kind, 'review_pass_limit_reached');
  assert.equal(remainders.data.items[0].file, 'frontend/two.ts');
});

test('review plan reuses unchanged coverage with noncritical findings', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-7550');
  commitChange(created.workingDirectory, 'frontend/one.ts', 'export const one = 1;\n');
  commitChange(created.workingDirectory, 'frontend/two.ts', 'export const two = 2;\n');
  const initial = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  runJson(['record-reviews', '--manifest', admitted.manifestPath, '--data', JSON.stringify(initial.files.map((file) => ({
    file: file.file,
    reviewedSha: initial.head,
    verdict: 'FAIL',
    findings: [{ severity: 'Nit', rule: 'style', issue: 'advisory only' }],
  })))], { env });

  commitChange(created.workingDirectory, 'frontend/one.ts', 'export const one = 2;\n');
  const next = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  const byFile = new Map(next.files.map((file) => [file.file, file]));
  assert.equal(byFile.get('frontend/one.ts').needsReview, true);
  assert.equal(byFile.get('frontend/two.ts').needsReview, false);
  assert.equal(byFile.get('frontend/two.ts').reusedReview, true);
});

test('batch review receipts reject duplicate or unknown files', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-7600');
  commitChange(created.workingDirectory, 'frontend/app.ts', 'export const value = 1;\n');
  commitChange(created.workingDirectory, 'frontend/other.ts', 'export const other = 1;\n');
  const plan = runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  const duplicate = JSON.stringify([{ file: plan.files[0].file, verdict: 'PASS', findings: [] }, { file: plan.files[0].file, verdict: 'PASS', findings: [] }]);
  assertFails(['record-reviews', '--manifest', admitted.manifestPath, '--data', duplicate], 'unique file result', { env });
  assertFails(['record-reviews', '--manifest', admitted.manifestPath, '--data', JSON.stringify([{ file: 'frontend/missing.ts', verdict: 'PASS', findings: [] }])], 'not in the current review plan', { env });
  assertFails(['record-reviews', '--manifest', admitted.manifestPath, '--data', JSON.stringify([{ file: plan.files[0].file, verdict: 'PASS', findings: [] }])], 'missing file result', { env });
  assertFails(['record-reviews', '--manifest', admitted.manifestPath, '--data', JSON.stringify([{ file: plan.files[0].file, reviewedSha: 'stale-head', verdict: 'PASS', findings: [] }, { file: plan.files[1].file, verdict: 'PASS', findings: [] }])], 'Stale reviewer result', { env });
});

test('publish gate publishes a committed diff with missing phase receipts as remainders', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-7900');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'qa.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  commitChange(created.workingDirectory, 'frontend/app.ts', 'export const value = 1;\n');
  const scope = runJson(['diff-scope', '--manifest', admitted.manifestPath], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'style', '--status', 'PASS', '--data', JSON.stringify({ reviewedSha: scope.head })], { env });
  const gate = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(gate.status, 'PASS_WITH_REMAINDERS');
  let manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'publish.ready');
  const remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.data.items[0].phase, 'verify');
  const report = runJson(['final-report', '--manifest', admitted.manifestPath], { env });
  assert.equal(report.status, 'NEEDS_HUMAN');
  manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'complete');
});

test('publish gate remains report-only when no committed diff exists', () => {
  const repoInfo = createRepo();
  const { env, admitted } = admitAndWorktree(repoInfo, '--ticket ACTION-7950');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'qa.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  const gate = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(gate.status, 'REPORT_REQUIRED');
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'report.ready');
  const remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.data.items[0].kind, 'no_publishable_diff');
});

test('publish gate accepts verify, a QA report, style, and review receipts', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-8000');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'qa.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  commitChange(created.workingDirectory, 'frontend/app.ts', 'export const value = 1;\n');
  const scope = runJson(['diff-scope', '--manifest', admitted.manifestPath], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'verify', '--status', 'PASS', '--data', '{}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'qa', '--status', 'COMPLETE', '--data', '{"scenarios":[{"scenario":"works","result":"FAIL"}]}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'style', '--status', 'PASS', '--data', JSON.stringify({ reviewedSha: scope.head })], { env });
  runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.ts', '--data', JSON.stringify({
    verdict: 'FAIL',
    reviewedSha: scope.head,
    findings: [{ severity: 'Nit', rule: 'style', line: '1', issue: 'advisory only' }],
  })], { env });
  const gate = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(gate.status, 'PASS_WITH_REMAINDERS');
  const finalized = runJson(['finalize', '--manifest', admitted.manifestPath], { env });
  assert.deepEqual(finalized, { status: 'PASS', state: 'complete', idempotent: false });
  const repeated = runJson(['finalize', '--manifest', admitted.manifestPath], { env });
  assert.deepEqual(repeated, { status: 'PASS', state: 'complete', idempotent: true });
});

test('publish gate blocks a committed diff with a comment-policy violation', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-8001');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'qa.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  commitChange(created.workingDirectory, 'src/app.ts', '// remove this narration\nexport const value = 1;\n');
  const scope = runJson(['diff-scope', '--manifest', admitted.manifestPath], { env });
  const style = runJson(['style-gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(style.status, 'FAIL');
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'verify', '--status', 'PASS', '--data', '{}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'qa', '--status', 'COMPLETE', '--data', '{"scenarios":[]}'], { env });
  runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'src/app.ts', '--data', JSON.stringify({ reviewedSha: scope.head, verdict: 'PASS', findings: [] })], { env });

  const gate = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(gate.status, 'REPORT_REQUIRED');
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'report.ready');
  const remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.data.items.some((item) => item.kind === 'comment_policy_violation'), true);
});

test('publish gate requires a current test-prune receipt when test files changed', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-8002');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'qa.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  commitChange(created.workingDirectory, 'frontend/app.test.ts', 'test("works", () => {});\n');
  const scope = runJson(['diff-scope', '--manifest', admitted.manifestPath], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'verify', '--status', 'PASS', '--data', '{}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'qa', '--status', 'COMPLETE', '--data', '{"scenarios":[]}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'style', '--status', 'PASS', '--data', JSON.stringify({ reviewedSha: scope.head })], { env });
  runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.test.ts', '--data', JSON.stringify({ reviewedSha: scope.head, verdict: 'PASS', findings: [] })], { env });

  const blocked = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(blocked.status, 'REPORT_REQUIRED');
  let remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.data.items.some((item) => item.kind === 'test_prune_not_current_pass'), true);

  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'test-prune', '--status', 'PASS', '--data', JSON.stringify({ reviewedSha: scope.head, changedTestFiles: ['frontend/app.test.ts'] })], { env });
  const passed = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(passed.status, 'PASS');
  remaining = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'remaining-work.json'), 'utf8'));
  assert.equal(remaining.data.items.some((item) => item.phase === 'test-prune'), false);
});

test('publish gate carries a blocked admitted run to publication when a diff exists', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-8055');
  commitChange(created.workingDirectory, 'frontend/app.ts', 'export const value = 1;\n');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['block', '--manifest', admitted.manifestPath, '--phase', 'verify', '--reason', 'environment issue'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  const scope = runJson(['diff-scope', '--manifest', admitted.manifestPath], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'verify', '--status', 'BLOCKED', '--data', '{}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'qa', '--status', 'COMPLETE', '--data', '{"scenarios":[{"scenario":"typecheck","result":"BLOCKED"}]}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'style', '--status', 'PASS', '--data', JSON.stringify({ reviewedSha: scope.head })], { env });
  runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.ts', '--data', JSON.stringify({ reviewedSha: scope.head, verdict: 'PASS', findings: [] })], { env });
  const gate = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(gate.status, 'PASS_WITH_REMAINDERS');
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'publish.ready');
});

test('publish gate records review remainders instead of blocking publication', () => {
  const repoInfo = createRepo();
  const { env, admitted, created } = admitAndWorktree(repoInfo, '--ticket ACTION-8050');
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'context.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'verification.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'qa.ready'], { env });
  runJson(['transition', '--manifest', admitted.manifestPath, '--to', 'review.ready'], { env });
  commitChange(created.workingDirectory, 'frontend/app.ts', 'export const value = 1;\n');
  const scope = runJson(['diff-scope', '--manifest', admitted.manifestPath], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'verify', '--status', 'PASS', '--data', '{}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'qa', '--status', 'COMPLETE', '--data', '{"scenarios":[]}'], { env });
  runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'style', '--status', 'PASS', '--data', JSON.stringify({ reviewedSha: scope.head })], { env });
  runJson(['review-plan', '--manifest', admitted.manifestPath], { env });
  runJson(['record-review', '--manifest', admitted.manifestPath, '--file', 'frontend/app.ts', '--data', JSON.stringify({
    verdict: 'FAIL',
    reviewedSha: scope.head,
    findings: [{ severity: 'Critical', rule: 'correctness', line: '1', issue: 'unsafe behavior' }],
  })], { env });

  const gate = runJson(['gate', '--manifest', admitted.manifestPath], { env });
  assert.equal(gate.status, 'PASS_WITH_REMAINDERS');
  assert.equal(gate.remainingReviewItems, 1);
  const manifest = JSON.parse(fs.readFileSync(admitted.manifestPath, 'utf8'));
  assert.equal(manifest.state, 'publish.ready');
  const remainders = JSON.parse(fs.readFileSync(path.join(admitted.runDir, 'receipts', 'review-remainders.json'), 'utf8'));
  assert.equal(remainders.status, 'RECORDED');
  assert.equal(remainders.data.items[0].kind, 'unresolved_critical_findings');
  assert.equal(remainders.data.items[0].file, 'frontend/app.ts');
  const report = runJson(['final-report', '--manifest', admitted.manifestPath], { env });
  assert.equal(report.status, 'NEEDS_HUMAN');
  assert.equal(report.data.remainingWork[0].phase, 'review');
});

test('push and PR readback can be stored as receipts', () => {
  const repoInfo = createRepo();
  const { env, admitted } = admitAndWorktree(repoInfo, '--ticket ACTION-9000');
  const push = runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'push', '--status', 'PASS', '--data', '{"remote":"origin"}'], { env });
  const pr = runJson(['receipt', '--manifest', admitted.manifestPath, '--phase', 'pr', '--status', 'PASS', '--data', '{"url":"https://github.com/example/repo/pull/1","base":"main"}'], { env });
  assert.equal(push.status, 'PASS');
  assert.equal(pr.data.url, 'https://github.com/example/repo/pull/1');
});

test('publish instructions require the pr-description template', () => {
  const text = fs.readFileSync(FEATURE_AGENT, 'utf8');
  assert.match(text, /\/Users\/michael\/\.omp\/agent\/skills\/pr-description\/SKILL\.md/);
  assert.match(text, /<!-- PR_DESCRIPTION -->/);
  assert.match(text, /## Overview/);
  assert.match(text, /## Changes/);
  assert.match(text, /## Screenshots/);
  assert.match(text, /gh pr create --base main --head "<Branch>" --title "<title>" --body-file "<body-file>"/);
  assert.match(text, /Do not create a PR with a free-form body/);
  assert.match(text, /workflow\.cjs final-report --manifest "<ManifestPath>" --summary/);
  assert.match(text, /Only Critical findings/);
  assert.match(text, /dispatch two parallel reviewer tasks/);
  assert.match(text, /REPORT_REQUIRED/);
  assert.match(text, /PASS_WITH_REMAINDERS/);
  assert.match(text, /Remaining work:/);
  assert.match(text, /Next human action:/);
});

test('feature guidance requires behavioral tests instead of coverage-only tests', () => {
  const implementer = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'agents', 'feature-implementer.md'), 'utf8');
  const reviewer = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'agents', 'feature-reviewer.md'), 'utf8');
  const feature = fs.readFileSync(FEATURE_AGENT, 'utf8');
  const pruner = fs.readFileSync(TEST_PRUNER_AGENT, 'utf8');
  const review = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'agents', 'feature', 'review.md'), 'utf8');

  assert.match(implementer, /minimum tests needed to pin the changed contract/);
  assert.match(implementer, /Do not add tests solely to increase line or branch coverage/);
  assert.match(implementer, /private methods, internal call choreography/);
  assert.match(implementer, /Check existing tests before adding a case/);
  assert.match(implementer, /Return an uncommitted draft before the first commit/);
  assert.match(reviewer, /maps to a distinct acceptance criterion/);
  assert.match(reviewer, /coverage-only/);
  assert.match(reviewer, /high-confidence duplicate/);
  assert.match(reviewer, /"test-quality"/);
  assert.match(reviewer, /test-quality finding may also be `repairable: true`/);
  assert.match(pruner, /Default recommendation for low-value tests is delete/);
  assert.match(pruner, /"delete" \| "strengthen" \| "replace"/);
  assert.match(pruner, /Do not use this pre-commit pruner as a broad test-coverage review/);
  assert.match(pruner, /visual-only styling unit tests/);
  assert.match(feature, /minimum test contract/);
  assert.match(feature, /feature-test-pruner/);
  assert.match(feature, /test-prune` receipt/);
  assert.match(feature, /Continue the prune-only loop until `PASS`/);
  assert.doesNotMatch(feature, /one allowed prune revision/);
  assert.doesNotMatch(feature, /second test-prune result is not `PASS`/);
  assert.match(feature, /coverage-only, duplicate, trivial, private-implementation/);
  assert.match(review, /test-quality contract/);
});
