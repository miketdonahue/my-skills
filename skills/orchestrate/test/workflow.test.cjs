'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW = path.resolve(__dirname, '..', 'scripts', 'workflow.cjs');

function run(args, options = {}) {
  return childProcess.spawnSync('node', [WORKFLOW, ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function git(args, cwd) {
  const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createRepo(root) {
  const remote = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(remote, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  git(['init', '--bare', remote], root);
  git(['init'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test User'], repo);
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  git(['add', 'README.md'], repo);
  git(['commit', '-m', 'initial'], repo);
  git(['branch', '-M', 'main'], repo);
  git(['remote', 'add', 'origin', remote], repo);
  git(['push', '-u', 'origin', 'main'], repo);
  return repo;
}

function createFakeHerdr(root) {
  const bin = path.join(root, 'herdr-fake.cjs');
  const source = `#!/usr/bin/env node
'use strict';
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.HERDR_LOG, JSON.stringify(args) + '\\n');
function value(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
if (args[0] === 'worktree' && args[1] === 'create') {
  const cwd = value('--cwd');
  const branch = value('--branch');
  const target = value('--path');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const result = childProcess.spawnSync('git', ['-C', cwd, 'worktree', 'add', '-b', branch, target, 'origin/main'], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status);
  }
  process.stdout.write(JSON.stringify({ result: { worktree: { path: target, branch, open_workspace_id: 'w-test' } } }));
  process.exit(0);
}
if (args[0] === 'worktree' && args[1] === 'open') {
  const target = value('--path');
  process.stdout.write(JSON.stringify({ result: { worktree: { path: target, open_workspace_id: 'w-test' } } }));
  process.exit(0);
}
if (args[0] === 'worktree' && args[1] === 'list') {
  const root = process.env.ORCHESTRATE_WORKTREES_ROOT;
  const worktrees = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(full, '.git'))) {
        worktrees.push({ path: full, branch: path.basename(full), open_workspace_id: 'w-test' });
      } else {
        walk(full);
      }
    }
  }
  walk(root);
  process.stdout.write(JSON.stringify({ result: { worktrees } }));
  process.exit(0);
}
if (args[0] === 'agent' && args[1] === 'start') {
  process.stdout.write(JSON.stringify({ result: { started: true, agent: args[2] } }));
  process.exit(0);
}
process.stderr.write('unexpected herdr args: ' + JSON.stringify(args));
process.exit(2);
`;
  fs.writeFileSync(bin, source, { mode: 0o700 });
  return bin;
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrate-workflow-'));
  const repo = createRepo(root);
  const herdr = createFakeHerdr(root);
  const planPath = path.join(repo, 'plan.md');
  fs.writeFileSync(planPath, '# Plan\n');
  return {
    root,
    repo,
    planPath,
    env: {
      ORCHESTRATE_RUNS_ROOT: path.join(root, 'runs'),
      ORCHESTRATE_WORKTREES_ROOT: path.join(root, 'worktrees'),
      ORCHESTRATE_HERDR_BIN: herdr,
      ORCHESTRATE_OMP_BIN: '/fake/omp',
      ORCHESTRATE_RANDOM_HEX: 'a1b2',
      HERDR_LOG: path.join(root, 'herdr.log'),
    },
  };
}

test('parse accepts feature ticket invocation', () => {
  const result = run(['parse', '--arguments', 'feature --ticket action-1234']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    subcommand: 'feature',
    ticket: 'action-1234',
    planPath: null,
  });
});

test('parse converts relative plan path to absolute path', () => {
  const { repo, env, planPath } = setup();
  const result = run(['parse', '--cwd', repo, '--arguments', 'feature --ticket action-1234 --plan ./plan.md'], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    subcommand: 'feature',
    ticket: 'action-1234',
    planPath,
  });
});

test('parse rejects unsupported input', () => {
  const cases = [
    'diagnose --ticket action-1234',
    'feature',
    'feature --ticket action-1234 --ticket action-5678',
    'feature --ticket action-1234 --foo bar',
    'feature --ticket action-1234 extra',
  ];
  for (const input of cases) {
    const result = run(['parse', '--arguments', input]);
    assert.notEqual(result.status, 0, input);
    assert.match(result.stdout, /^blocked: parse\nreason: /, input);
  }
});

test('launch creates ticket-hash worktree, persists manifest, and starts unfocused worker', () => {
  const { repo, env, planPath } = setup();
  const resolvedRepo = fs.realpathSync(repo);
  const result = run(['launch', '--cwd', repo, '--arguments', 'feature --ticket ACTION-1234 --plan ./plan.md'], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^launched: feature\n/);
  assert.match(result.stdout, /ticket: ACTION-1234\n/);
  assert.match(result.stdout, /branch: action-1234-a1b2\n/);
  assert.match(result.stdout, /agent: feature-action-1234-a1b2\n/);
  assert.match(result.stdout, /status: started\n$/);

  const worktree = path.join(env.ORCHESTRATE_WORKTREES_ROOT, 'repo', 'action-1234-a1b2');
  assert.ok(fs.existsSync(worktree));
  assert.match(result.stdout, new RegExp(`worktree: ${worktree.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));

  const projectRuns = path.join(env.ORCHESTRATE_RUNS_ROOT, 'repo');
  const runDirs = fs.readdirSync(projectRuns);
  assert.equal(runDirs.length, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRuns, runDirs[0], 'manifest.json'), 'utf8'));
  assert.equal(manifest.ticket, 'ACTION-1234');
  assert.equal(manifest.normalizedTicket, 'action-1234');
  assert.equal(manifest.branch, 'action-1234-a1b2');
  assert.equal(manifest.worktree, worktree);
  assert.equal(manifest.planPath, planPath);
  assert.equal(manifest.workspaceId, 'w-test');
  assert.equal(manifest.workerAgentName, 'feature-action-1234-a1b2');
  assert.equal(manifest.workerPrompt, `/feature --ticket ACTION-1234 --plan ${planPath}`);

  const herdrCalls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const create = herdrCalls.find((call) => call[0] === 'worktree' && call[1] === 'create');
  assert.deepEqual(create.slice(0, 4), ['worktree', 'create', '--cwd', resolvedRepo]);
  assert.ok(create.includes('--no-focus'));
  assert.ok(create.includes('--json'));
  assert.equal(create[create.indexOf('--branch') + 1], 'action-1234-a1b2');
  assert.equal(create[create.indexOf('--path') + 1], worktree);

  const start = herdrCalls.find((call) => call[0] === 'agent' && call[1] === 'start');
  assert.equal(start[2], 'feature-action-1234-a1b2');
  assert.equal(start[start.indexOf('--cwd') + 1], worktree);
  assert.equal(start[start.indexOf('--workspace') + 1], 'w-test');
  assert.ok(start.includes('--no-focus'));
  assert.ok(start.includes('OMP_ORCHESTRATE_RUN_ID=' + manifest.runId));
  const separator = start.indexOf('--');
  assert.deepEqual(start.slice(separator + 1), ['/fake/omp', `/feature --ticket ACTION-1234 --plan ${planPath}`]);
});
