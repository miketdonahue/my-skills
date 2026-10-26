'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const WORKFLOW = path.resolve(__dirname, '..', 'scripts', 'workflow.cjs');
const { __test } = require(WORKFLOW);

function runWorkflow(args, options = {}) {
  return childProcess.spawnSync(process.execPath, [WORKFLOW, ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function git(cwd, args) {
  const result = childProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createRepo(root) {
  const remote = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(remote, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--bare', remote]);
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);
  return repo;
}

function createFakeHerdr(root, behavior = {}) {
  const bin = path.join(root, `herdr-fake-${Math.random().toString(36).slice(2)}.cjs`);
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
function statePath() {
  return process.env.HERDR_STATE;
}
function readState() {
  const file = statePath();
  if (!file || !fs.existsSync(file)) return { closed: false, workspace_id: 'w-test', open_count: 0 };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeState(state) {
  fs.writeFileSync(statePath(), JSON.stringify(state));
}
function workspaces() {
  const state = readState();
  if (state.closed) return [];
  const root = process.env.WORKTREE_ROOT;
  const items = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(full, '.git'))) {
        items.push({
          workspace_id: state.workspace_id || 'w-test',
          label: path.basename(full),
          focused: process.env.FAKE_WORKSPACE_FOCUSED === '1',
          worktree: { checkout_path: full, is_linked_worktree: true },
        });
      } else {
        walk(full);
      }
    }
  }
  walk(root);
  return items;
}
function panes() {
  if (process.env.FAKE_NO_REUSABLE_PANE) return [];
  const state = readState();
  state.pane_list_count = Number(state.pane_list_count || 0) + 1;
  writeState(state);
  if (state.pane_list_count <= Number(process.env.FAKE_PANE_LIST_EMPTY || 0)) return [];
  const workspace = workspaces()[0];
  if (!workspace) return [];
  const workspaceId = readState().workspace_id || 'w-test';
  return [{
    agent_status: 'unknown',
    pane_id: workspaceId + ':p1',
    tab_id: workspaceId + ':t1',
    workspace_id: workspaceId,
    cwd: workspace.worktree.checkout_path,
    foreground_cwd: workspace.worktree.checkout_path,
  }];
}
if (args[0] === 'worktree' && args[1] === 'create') {
  const cwd = value('--cwd');
  const branch = value('--branch');
  const target = value('--path');
  const result = childProcess.spawnSync('git', ['-C', cwd, 'worktree', 'add', '-b', branch, target, 'origin/main'], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status);
  }
  writeState({ closed: false, workspace_id: 'w-test', open_count: 0 });
  process.stdout.write(JSON.stringify({ result: { worktree: { path: target, branch, open_workspace_id: 'w-test' } } }));
  process.exit(0);
}
if (args[0] === 'worktree' && args[1] === 'open') {
  if (process.env.FAKE_OPEN_FAIL === '1') {
    process.stderr.write('fake worktree open failed');
    process.exit(1);
  }
  if (!value('--cwd')) {
    process.stderr.write('fake worktree open requires --cwd');
    process.exit(1);
  }
  const state = readState();
  state.closed = false;
  state.open_count = Number(state.open_count || 0) + 1;
  state.workspace_id = 'w-reopened-' + state.open_count;
  writeState(state);
  process.stdout.write(JSON.stringify({ result: { worktree: { open_workspace_id: state.workspace_id } } }));
  process.exit(0);
}
if (args[0] === 'workspace' && args[1] === 'close') {
  if (process.env.FAKE_CLOSE_FAIL === '1') {
    process.stderr.write('fake workspace close failed');
    process.exit(1);
  }
  const state = readState();
  state.closed = true;
  writeState(state);
  process.stdout.write(JSON.stringify({ result: { ok: true } }));
  process.exit(0);
}
if (args[0] === 'api' && args[1] === 'snapshot') {
  process.stdout.write(JSON.stringify({ result: { snapshot: { workspaces: workspaces(), agents: [] } } }));
  process.exit(0);
}
if (args[0] === 'tab' && args[1] === 'list') {
  const workspaceId = value('--workspace') || readState().workspace_id || 'w-test';
  process.stdout.write(JSON.stringify({ result: { tabs: [{ focused: true, tab_id: workspaceId + ':t1', workspace_id: workspaceId }] } }));
  process.exit(0);
}
if (args[0] === 'pane' && args[1] === 'list') {
  process.stdout.write(JSON.stringify({ result: { panes: panes() } }));
  process.exit(0);
}
if (args[0] === 'pane' && args[1] === 'process-info') {
  process.stdout.write(JSON.stringify({ result: { process_info: { foreground_processes: [{ name: 'zsh', argv0: 'zsh' }] } } }));
  process.exit(0);
}
if (args[0] === 'pane' && args[1] === 'run') {
  process.stdout.write(JSON.stringify({ result: { ok: true } }));
  process.exit(0);
}
if (args[0] === 'agent' && args[1] === 'get') {
  if (process.env.FAKE_AGENT_STATUS) {
    process.stdout.write(JSON.stringify({
      result: {
        agent: {
          agent_status: process.env.FAKE_AGENT_STATUS,
          pane_id: 'w-test:p1',
          tab_id: 'w-test:t1',
          workspace_id: readState().workspace_id || 'w-test',
        },
      },
    }));
    process.exit(0);
  } else {
    process.stderr.write(JSON.stringify({ error: { code: 'agent_not_found' } }));
    process.exit(1);
  }
}
if (args[0] === 'agent' && (args[1] === 'send' || args[1] === 'wait' || args[1] === 'start')) {
  process.stdout.write(JSON.stringify({ result: { ok: true } }));
  process.exit(0);
}
process.stderr.write('unexpected herdr args: ' + JSON.stringify(args));
process.exit(2);
`;
  fs.writeFileSync(bin, source, { mode: 0o700 });
  return bin;
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-schedule-test-'));
  const repo = createRepo(root);
  const herdr = createFakeHerdr(root);
  const env = {
    HERDR_LOG: path.join(root, 'herdr.log'),
    HERDR_STATE: path.join(root, 'herdr-state.json'),
    OMP_SCHEDULE_ROOT: path.join(root, 'schedule'),
    OMP_SCHEDULE_CRONTAB_FILE: path.join(root, 'crontab'),
    OMP_SCHEDULE_HERDR_BIN: herdr,
    OMP_SCHEDULE_OMP_BIN: '/fake/omp',
    WORKTREE_HERDR_BIN: herdr,
    WORKTREE_ROOT: path.join(root, 'worktrees'),
    WORKTREE_RANDOM_HEX: 'a1b2',
    WORKTREE_DISABLE_ENV_GUARD: '1',
    OMP_SCHEDULE_FORCE_ID: 'sch-abc123',
    SCHEDULE_REPO: repo,
  };
  return { root, repo, env };
}

function addEnabledSkill(root, env, skillName, include = true) {
  const skillsRoot = path.join(root, 'skills');
  fs.mkdirSync(path.join(skillsRoot, skillName), { recursive: true });
  fs.writeFileSync(path.join(skillsRoot, skillName, 'SKILL.md'), `---\nname: ${skillName}\n---\n`);
  env.OMP_SCHEDULE_SKILLS_ROOT = skillsRoot;
  env.OMP_SCHEDULE_CONFIG_PATH = path.join(root, 'config.yml');
  fs.writeFileSync(env.OMP_SCHEDULE_CONFIG_PATH, [
    'skills:',
    '  includeSkills:',
    ...(include ? [`    - ${skillName}`] : ['    - other-skill']),
    '',
  ].join('\n'));
}

function writeScheduledJob(env, worktree, overrides = {}) {
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Audit',
      cwd: env.SCHEDULE_REPO,
      worktree,
      branch: 'scheduled--audit-a1b2',
      agentName: 'sched-sch-abc123',
      prompt: 'Review it.',
      ...overrides,
    }],
  }));
}

function herdrCalls(env) {
  return fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

function createFailingCrontab(root) {
  const bin = path.join(root, 'crontab-fail.cjs');
  const source = `#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2);
if (args[0] === '-l') process.exit(1);
process.stderr.write('crontab: ' + args[0] + ': Operation not permitted\\n');
process.exit(1);
`;
  fs.writeFileSync(bin, source, { mode: 0o700 });
  return bin;
}

test('parse validates 24-hour time and weekly day', () => {
  assert.deepEqual(__test.parseScheduleArguments('--name audit --frequency weekly --day fri --time 17:30 --prompt "Do it"'), {
    name: 'audit',
    scheduleType: 'time',
    frequency: 'weekly',
    time: '17:30',
    day: 'fri',
    targetType: 'prompt',
    prompt: 'Do it',
  });
  assert.throws(() => __test.parseScheduleArguments('--name audit --frequency daily --time 5:30 --prompt "Do it"'), /24-hour/);
  assert.throws(() => __test.parseScheduleArguments('--name audit --frequency weekly --time 05:30 --prompt "Do it"'), /--day is required/);
});

test('parse accepts interval mode and rejects conflicting interval options', () => {
  assert.deepEqual(__test.parseScheduleArguments('--name audit --interval 15 --prompt "Check status"'), {
    name: 'audit',
    scheduleType: 'interval',
    intervalMinutes: 15,
    targetType: 'prompt',
    prompt: 'Check status',
  });
  assert.throws(() => __test.parseScheduleArguments('--name audit --interval 0 --prompt "Do it"'), /integer from 1 to 480/);
  assert.throws(() => __test.parseScheduleArguments('--name audit --interval 5.5 --prompt "Do it"'), /integer from 1 to 480/);
  assert.throws(() => __test.parseScheduleArguments('--name audit --interval 481 --prompt "Do it"'), /integer from 1 to 480/);
  assert.throws(() => __test.parseScheduleArguments('--name audit --interval 15 --time 09:00 --prompt "Do it"'), /exactly one/);
  assert.throws(() => __test.parseScheduleArguments('--name audit --interval 15 --frequency weekdays --prompt "Do it"'), /--frequency is not accepted/);
  assert.throws(() => __test.parseScheduleArguments('--name audit --interval 15 --day mon --prompt "Do it"'), /--day is not accepted/);
});

test('parse accepts skill target mode and rejects conflicting target options', () => {
  assert.deepEqual(__test.parseScheduleArguments('--name refine --interval 30 --skill gateway-steward'), {
    name: 'refine',
    scheduleType: 'interval',
    intervalMinutes: 30,
    targetType: 'skill',
    skillName: 'gateway-steward',
    skillArgs: '',
  });
  assert.deepEqual(__test.parseScheduleArguments('--name review --frequency weekly --day fri --time 16:30 --skill peer-review --skill-args "https://example.test/pr/1"'), {
    name: 'review',
    scheduleType: 'time',
    frequency: 'weekly',
    time: '16:30',
    day: 'fri',
    targetType: 'skill',
    skillName: 'peer-review',
    skillArgs: 'https://example.test/pr/1',
  });
  assert.equal(
    __test.parseScheduleArguments('--name refine --interval 30 --skill gateway-steward --skill-args "--dry-run"').skillArgs,
    '--dry-run',
  );
  assert.throws(() => __test.parseScheduleArguments('--name refine --interval 30 --prompt "Run" --skill gateway-steward'), /exactly one of --prompt or --skill/);
  assert.throws(() => __test.parseScheduleArguments('--name refine --interval 30 --skill-args "x" --prompt "Run"'), /--skill-args is only accepted/);
  assert.throws(() => __test.parseScheduleArguments('--name refine --interval 30 --skill-args "x"'), /--skill-args is only accepted/);
  assert.throws(() => __test.parseScheduleArguments('--name refine --interval 30 --skill ../bad'), /simple kebab-case/);
});

test('interval guard enforces the inclusive Pacific weekday window', () => {
  assert.equal(__test.intervalWindowSkipReason(new Date('2026-08-31T15:29:00Z')), 'outside interval time window');
  assert.equal(__test.intervalWindowSkipReason(new Date('2026-08-31T15:30:00Z')), null);
  assert.equal(__test.intervalWindowSkipReason(new Date('2026-08-31T23:30:00Z')), null);
  assert.equal(__test.intervalWindowSkipReason(new Date('2026-08-31T23:31:00Z')), 'outside interval time window');
  assert.equal(__test.intervalWindowSkipReason(new Date('2026-09-05T15:00:00Z')), 'outside interval weekday window');
});

test('--help prints usage and performs no mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-schedule-help-'));
  const env = {
    OMP_SCHEDULE_ROOT: path.join(root, 'schedule'),
    OMP_SCHEDULE_CRONTAB_FILE: path.join(root, 'crontab'),
  };
  const result = runWorkflow(['schedule', '--arguments', '--help'], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--frequency <value>/);
  assert.match(result.stdout, /--interval <minutes>/);
  assert.match(result.stdout, /--skill <skill-name>/);
  assert.match(result.stdout, /--skill-args/);
  assert.equal(fs.existsSync(env.OMP_SCHEDULE_CRONTAB_FILE), false);
  assert.equal(fs.existsSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json')), false);
});

test('interval schedule writes explicit weekday cron lines inside one owned block', () => {
  const { repo, env } = setup();
  const args = '--name "Status Check" --interval 15 --prompt "Check status."';
  const result = runWorkflow(['schedule', '--cwd', repo, '--arguments', args], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /frequency: every 15 minutes/);
  assert.match(result.stdout, /time: weekdays 08:30-16:30 America\/Los_Angeles/);

  const crontab = fs.readFileSync(env.OMP_SCHEDULE_CRONTAB_FILE, 'utf8');
  assert.match(crontab, /# OMP_SCHEDULE_BEGIN id=sch-abc123/);
  assert.match(crontab, /# OMP_SCHEDULE_END id=sch-abc123/);
  const commandLines = crontab.split('\n').filter((line) => line.includes('run --id'));
  assert.equal(commandLines.length, 33);
  assert.match(commandLines[0], /^30 8 \* \* 1-5 /);
  assert.match(commandLines[1], /^45 8 \* \* 1-5 /);
  assert.match(commandLines[2], /^0 9 \* \* 1-5 /);
  assert.match(commandLines.at(-1), /^30 16 \* \* 1-5 /);
  assert.equal(commandLines.some((line) => /^\d+ \d+ \* \* [067] /.test(line)), false);
  assert.equal(commandLines.some((line) => /^45 16 \* \* 1-5 /.test(line)), false);

  const job = JSON.parse(fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), 'utf8')).jobs[0];
  assert.equal(job.scheduleType, 'interval');
  assert.equal(job.intervalMinutes, 15);
  assert.equal(job.windowStart, '08:30');
  assert.equal(job.windowEnd, '16:30');
  assert.equal(job.windowDays, 'weekdays');
  assert.equal(job.timezone, 'America/Los_Angeles');
});

test('skill schedule validates installed and enabled skill before mutation', () => {
  const { root, repo, env } = setup();
  env.OMP_SCHEDULE_SKILLS_ROOT = path.join(root, 'skills');
  env.OMP_SCHEDULE_CONFIG_PATH = path.join(root, 'config.yml');
  fs.mkdirSync(env.OMP_SCHEDULE_SKILLS_ROOT, { recursive: true });
  fs.writeFileSync(env.OMP_SCHEDULE_CONFIG_PATH, 'skills:\n  includeSkills:\n    - gateway-steward\n');

  const missing = runWorkflow(['schedule', '--cwd', repo, '--arguments', '--name refine --interval 30 --skill gateway-steward'], { env });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /scheduled skill not found/);
  assert.equal(fs.existsSync(env.HERDR_LOG), false);
  assert.equal(fs.existsSync(env.OMP_SCHEDULE_CRONTAB_FILE), false);
  assert.equal(fs.existsSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json')), false);

  fs.mkdirSync(path.join(env.OMP_SCHEDULE_SKILLS_ROOT, 'gateway-steward'), { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_SKILLS_ROOT, 'gateway-steward', 'SKILL.md'), '---\nname: gateway-steward\n---\n');
  fs.writeFileSync(env.OMP_SCHEDULE_CONFIG_PATH, 'skills:\n  includeSkills:\n    - other-skill\n');

  const disabled = runWorkflow(['schedule', '--cwd', repo, '--arguments', '--name refine --interval 30 --skill gateway-steward'], { env });
  assert.equal(disabled.status, 1);
  assert.match(disabled.stdout, /not enabled in skills\.includeSkills/);
  assert.equal(fs.existsSync(env.HERDR_LOG), false);
  assert.equal(fs.existsSync(env.OMP_SCHEDULE_CRONTAB_FILE), false);
  assert.equal(fs.existsSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json')), false);
});

test('skill schedule creates metadata and cron while preserving owned block format', () => {
  const { root, repo, env } = setup();
  addEnabledSkill(root, env, 'gateway-steward');
  const args = '--name "Gateway Steward" --interval 30 --skill gateway-steward';
  const result = runWorkflow(['schedule', '--cwd', repo, '--arguments', args], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /frequency: every 30 minutes/);

  const crontab = fs.readFileSync(env.OMP_SCHEDULE_CRONTAB_FILE, 'utf8');
  assert.match(crontab, /# OMP_SCHEDULE_BEGIN id=sch-abc123/);
  assert.match(crontab, /# OMP_SCHEDULE_END id=sch-abc123/);
  assert.doesNotMatch(crontab, /gateway-steward/);

  const job = JSON.parse(fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), 'utf8')).jobs[0];
  assert.equal(job.targetType, 'skill');
  assert.equal(job.skillName, 'gateway-steward');
  assert.equal(job.skillArgs, '');
  assert.equal(job.skillInvocation, '/skill:gateway-steward');
  assert.equal(job.prompt, undefined);
});

test('cron install failure rolls back metadata and removes only the just-created scheduled worktree', () => {
  const { root, repo, env } = setup();
  delete env.OMP_SCHEDULE_CRONTAB_FILE;
  env.OMP_SCHEDULE_CRONTAB_BIN = createFailingCrontab(root);

  const args = '--name "Cron Failure" --interval 30 --prompt "Do it."';
  const result = runWorkflow(['schedule', '--cwd', repo, '--arguments', args], { env });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /blocked: cron/);
  assert.match(result.stdout, /Operation not permitted/);

  const expectedWorktree = path.join(root, 'worktrees', 'repo', 'scheduled--cron-failure-a1b2');
  assert.equal(fs.existsSync(expectedWorktree), false);
  assert.equal(git(repo, ['branch', '--list', 'scheduled--cron-failure-a1b2']), '');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), 'utf8')), {
    schemaVersion: 1,
    jobs: [],
  });
});

test('schedule creates scheduled worktree before adding an owned cron block', () => {
  const { root, repo, env } = setup();
  const args = '--name "Daily Audit" --frequency daily --time 09:05 --prompt "Review recent changes."';
  const result = runWorkflow(['schedule', '--cwd', repo, '--arguments', args], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /id: sch-abc123/);
  assert.match(result.stdout, /branch: scheduled--daily-audit-a1b2/);

  const crontab = fs.readFileSync(env.OMP_SCHEDULE_CRONTAB_FILE, 'utf8');
  assert.match(crontab, /# OMP_SCHEDULE_BEGIN id=sch-abc123/);
  assert.match(crontab, /^5 9 \* \* \*/m);
  assert.doesNotMatch(crontab, /Review recent changes/);

  const jobs = JSON.parse(fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), 'utf8')).jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].worktreeRequestName, 'scheduled--daily-audit');
  assert.equal(jobs[0].timezone, 'America/Los_Angeles');
  assert.equal(jobs[0].repo, 'repo');
  assert.equal(git(jobs[0].worktree, ['branch', '--show-current']), 'scheduled--daily-audit-a1b2');

  const herdrCalls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(herdrCalls.some((call) => call[0] === 'worktree' && call[1] === 'create'));
});

test('list shows only active schedule-owned jobs and warns on stale metadata', () => {
  const { env } = setup();
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [
      { id: 'sch-active', name: 'Active', frequency: 'daily', time: '09:00', timezone: 'America/Los_Angeles', prompt: 'Run active' },
      { id: 'sch-interval', name: 'Interval', scheduleType: 'interval', intervalMinutes: 15, windowStart: '08:30', windowEnd: '16:30', windowDays: 'weekdays', timezone: 'America/Los_Angeles', prompt: 'Run interval' },
      { id: 'sch-skill', name: 'Skill', scheduleType: 'interval', intervalMinutes: 30, windowStart: '08:30', windowEnd: '16:30', windowDays: 'weekdays', timezone: 'America/Los_Angeles', targetType: 'skill', skillName: 'gateway-steward', skillArgs: '--dry-run', prompt: undefined },
      { id: 'sch-stale', name: 'Stale', frequency: 'daily', time: '10:00', timezone: 'America/Los_Angeles', prompt: 'Run stale' },
    ],
  }));
  fs.writeFileSync(env.OMP_SCHEDULE_CRONTAB_FILE, '# OMP_SCHEDULE_BEGIN id=sch-active\n0 9 * * * command\n# OMP_SCHEDULE_END id=sch-active\n# OMP_SCHEDULE_BEGIN id=sch-interval\n30 8 * * 1-5 command\n# OMP_SCHEDULE_END id=sch-interval\n# OMP_SCHEDULE_BEGIN id=sch-skill\n30 8 * * 1-5 command\n# OMP_SCHEDULE_END id=sch-skill\n');

  const result = runWorkflow(['list'], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\| sch-active \| Active \| daily \| 09:00 America\/Los_Angeles \| Run active \|/);
  assert.match(result.stdout, /\| sch-interval \| Interval \| every 15 minutes \| weekdays 08:30-16:30 America\/Los_Angeles \| Run interval \|/);
  assert.match(result.stdout, /\| sch-skill \| Skill \| every 30 minutes \| weekdays 08:30-16:30 America\/Los_Angeles \| \/skill:gateway-steward --dry-run \|/);
  assert.doesNotMatch(result.stdout, /sch-stale \| Stale/);
  assert.match(result.stdout, /Warning: omitted 1 job/);
});

test('scheduled run closes a completed agent and starts a fresh workspace agent', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Audit',
      cwd: env.SCHEDULE_REPO,
      worktree,
      branch: 'scheduled--audit-a1b2',
      agentName: 'sched-sch-abc123',
      prompt: 'Review it.',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], { env: { ...env, FAKE_AGENT_STATUS: 'idle' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mode: fresh-pane/);

  const calls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.some((call) => call[0] === 'agent' && call[1] === 'send'), false);
  assert.equal(calls.some((call) => call[0] === 'workspace' && call[1] === 'close'), true);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'open'), true);
  const paneRuns = calls.filter((call) => call[0] === 'pane' && call[1] === 'run');
  assert.equal(paneRuns.length, 1);
  assert.equal(paneRuns[0][2], 'w-reopened-1:p1');
  assert.match(paneRuns[0][3], /Scheduled job "Audit" \(sch-abc123\)\n\nReview it\./);

  const job = JSON.parse(fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), 'utf8')).jobs[0];
  assert.equal(job.paneId, 'w-reopened-1:p1');
  assert.equal(job.tabId, 'w-reopened-1:t1');
  assert.match(job.agentName, /^sched-sch-abc123-\d{14}$/);
  assert.equal(job.runCount, 1);
  assert.equal(JSON.parse(fs.readFileSync(env.HERDR_STATE, 'utf8')).closed, false);
});

test('scheduled skill run closes a completed agent and starts a fresh workspace agent', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--refine-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Refine',
      cwd: env.SCHEDULE_REPO,
      targetType: 'skill',
      skillName: 'gateway-steward',
      skillArgs: '--dry-run',
      worktree,
      branch: 'scheduled--refine-a1b2',
      agentName: 'sched-sch-abc123',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], { env: { ...env, FAKE_AGENT_STATUS: 'idle' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mode: fresh-pane/);

  const calls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.some((call) => call[0] === 'agent' && call[1] === 'send'), false);
  assert.equal(calls.some((call) => call[0] === 'workspace' && call[1] === 'close'), true);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'open'), true);
  const paneRuns = calls.filter((call) => call[0] === 'pane' && call[1] === 'run');
  assert.equal(paneRuns.length, 1);
  assert.equal(paneRuns[0][2], 'w-reopened-1:p1');
  assert.match(paneRuns[0][3], /'\/skill:gateway-steward --dry-run'/);
  assert.doesNotMatch(paneRuns[0][3], /Scheduled job/);

  const job = JSON.parse(fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), 'utf8')).jobs[0];
  assert.equal(job.paneId, 'w-reopened-1:p1');
  assert.equal(job.tabId, 'w-reopened-1:t1');
  assert.match(job.agentName, /^sched-sch-abc123-\d{14}$/);
});

test('scheduled run skips a busy existing agent', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Audit',
      worktree,
      branch: 'scheduled--audit-a1b2',
      agentName: 'sched-sch-abc123',
      prompt: 'Review it.',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], { env: { ...env, FAKE_AGENT_STATUS: 'working' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /skipped: sch-abc123/);
  assert.match(result.stdout, /scheduled agent is working/);
  const calls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.some((call) => call[0] === 'workspace' && call[1] === 'close'), false);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'open'), false);
});

test('scheduled run recycles a done agent without deleting the Git worktree', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  writeScheduledJob(env, worktree, { paneId: 'w-test:p1', runCount: 1 });

  const result = runWorkflow(['run', '--id', 'sch-abc123'], { env: { ...env, FAKE_AGENT_STATUS: 'done' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mode: fresh-pane/);

  const calls = herdrCalls(env);
  const closeIndex = calls.findIndex((call) => call[0] === 'workspace' && call[1] === 'close');
  const openIndex = calls.findIndex((call) => call[0] === 'worktree' && call[1] === 'open');
  assert.ok(closeIndex >= 0);
  assert.ok(openIndex > closeIndex);
  const openCall = calls[openIndex];
  assert.equal(openCall[openCall.indexOf('--cwd') + 1], env.SCHEDULE_REPO);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'remove'), false);
  assert.equal(fs.existsSync(worktree), true);
  assert.equal(fs.existsSync(path.join(worktree, '.git')), true);
});

test('scheduled run waits for the reopened shell pane before starting the agent', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  writeScheduledJob(env, worktree, { paneId: 'w-test:p1', runCount: 1 });

  const result = runWorkflow(['run', '--id', 'sch-abc123'], {
    env: { ...env, FAKE_AGENT_STATUS: 'done', FAKE_PANE_LIST_EMPTY: '2' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mode: fresh-pane/);

  const calls = herdrCalls(env);
  assert.equal(calls.some((call) => call[0] === 'agent' && call[1] === 'start'), false);
  assert.deepEqual(
    calls.find((call) => call[0] === 'pane' && call[1] === 'run').slice(0, 3),
    ['pane', 'run', 'w-reopened-1:p1'],
  );
});

test('scheduled run skips blocked and unknown agents without closing them', () => {
  for (const status of ['blocked', 'unknown']) {
    const { env } = setup();
    const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
    writeScheduledJob(env, worktree, { paneId: 'w-test:p1', runCount: 1 });

    const result = runWorkflow(['run', '--id', 'sch-abc123'], { env: { ...env, FAKE_AGENT_STATUS: status } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`scheduled agent is ${status}`));
    const calls = herdrCalls(env);
    assert.equal(calls.some((call) => call[0] === 'workspace' && call[1] === 'close'), false);
    assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'open'), false);
  }
});

test('scheduled run skips a focused completed workspace', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  writeScheduledJob(env, worktree, { paneId: 'w-test:p1', runCount: 1 });

  const result = runWorkflow(['run', '--id', 'sch-abc123'], {
    env: { ...env, FAKE_AGENT_STATUS: 'done', FAKE_WORKSPACE_FOCUSED: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /scheduled workspace is focused/);
  const calls = herdrCalls(env);
  assert.equal(calls.some((call) => call[0] === 'workspace' && call[1] === 'close'), false);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'open'), false);
});

test('scheduled run fails closed when workspace close fails', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  writeScheduledJob(env, worktree, { paneId: 'w-test:p1', runCount: 1 });

  const result = runWorkflow(['run', '--id', 'sch-abc123'], {
    env: { ...env, FAKE_AGENT_STATUS: 'done', FAKE_CLOSE_FAIL: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /blocked: herdr/);
  assert.match(result.stdout, /fake workspace close failed/);
  const calls = herdrCalls(env);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'open'), false);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'remove'), false);
});

test('scheduled run remains closed when workspace reopen fails', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  writeScheduledJob(env, worktree, { paneId: 'w-test:p1', runCount: 1 });

  const result = runWorkflow(['run', '--id', 'sch-abc123'], {
    env: { ...env, FAKE_AGENT_STATUS: 'done', FAKE_OPEN_FAIL: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /blocked: herdr/);
  assert.match(result.stdout, /fake worktree open failed/);
  assert.equal(JSON.parse(fs.readFileSync(env.HERDR_STATE, 'utf8')).closed, true);
  const calls = herdrCalls(env);
  assert.equal(calls.some((call) => call[0] === 'pane' && call[1] === 'run'), false);
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'remove'), false);
});

test('scheduled run reuses the saved worktree shell pane when none exists', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Audit',
      worktree,
      branch: 'scheduled--audit-a1b2',
      agentName: 'sched-sch-abc123',
      prompt: 'Review it.',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mode: fresh-pane/);

  const calls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.some((call) => call[0] === 'worktree' && call[1] === 'create'), false);
  assert.equal(calls.some((call) => call[0] === 'tab' && call[1] === 'create'), false);
  assert.equal(calls.some((call) => call[0] === 'agent' && call[1] === 'start'), false);
  const paneRun = calls.find((call) => call[0] === 'pane' && call[1] === 'run');
  assert.ok(paneRun);
  assert.equal(paneRun[2], 'w-test:p1');
  assert.match(paneRun[3], /OMP_SCHEDULE_JOB_ID='sch-abc123'/);
  assert.match(paneRun[3], /Scheduled job "Audit" \(sch-abc123\)\n\nReview it\./);

  const job = JSON.parse(fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), 'utf8')).jobs[0];
  assert.equal(job.paneId, 'w-test:p1');
  assert.equal(job.tabId, 'w-test:t1');
});

test('scheduled run refuses to create a second pane when no reusable shell pane exists', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Audit',
      worktree,
      branch: 'scheduled--audit-a1b2',
      agentName: 'sched-sch-abc123',
      prompt: 'Review it.',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], { env: { ...env, FAKE_NO_REUSABLE_PANE: '1' } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no reusable shell pane found/);

  const calls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.some((call) => call[0] === 'agent' && call[1] === 'start'), false);
});

test('scheduled skill run starts new agent with exact slash invocation', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--refine-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Refine',
      scheduleType: 'interval',
      intervalMinutes: 30,
      windowStart: '08:30',
      windowEnd: '16:30',
      windowDays: 'weekdays',
      timezone: 'America/Los_Angeles',
      targetType: 'skill',
      skillName: 'gateway-steward',
      skillArgs: '',
      worktree,
      branch: 'scheduled--refine-a1b2',
      agentName: 'sched-sch-abc123',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], {
    env: { ...env, OMP_SCHEDULE_NOW: '2026-08-31T16:00:00Z' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mode: fresh-pane/);

  const calls = fs.readFileSync(env.HERDR_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.some((call) => call[0] === 'agent' && call[1] === 'start'), false);
  const paneRun = calls.find((call) => call[0] === 'pane' && call[1] === 'run');
  assert.ok(paneRun);
  assert.equal(paneRun[2], 'w-test:p1');
  assert.match(paneRun[3], /'\/skill:gateway-steward'/);
  assert.doesNotMatch(paneRun[3], /Scheduled job/);
});

test('interval scheduled run starts during allowed Pacific weekday window', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Audit',
      scheduleType: 'interval',
      intervalMinutes: 15,
      windowStart: '08:30',
      windowEnd: '16:30',
      windowDays: 'weekdays',
      timezone: 'America/Los_Angeles',
      worktree,
      branch: 'scheduled--audit-a1b2',
      agentName: 'sched-sch-abc123',
      prompt: 'Review it.',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], {
    env: { ...env, OMP_SCHEDULE_NOW: '2026-08-31T16:00:00Z' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /mode: fresh-pane/);
});

test('interval scheduled run skips outside Pacific weekday window before touching Herdr', () => {
  const { env } = setup();
  const worktree = path.join(env.WORKTREE_ROOT, 'repo', 'scheduled--audit-a1b2');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  fs.mkdirSync(env.OMP_SCHEDULE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'jobs.json'), JSON.stringify({
    schemaVersion: 1,
    jobs: [{
      id: 'sch-abc123',
      name: 'Audit',
      scheduleType: 'interval',
      intervalMinutes: 15,
      windowStart: '08:30',
      windowEnd: '16:30',
      windowDays: 'weekdays',
      timezone: 'America/Los_Angeles',
      worktree,
      branch: 'scheduled--audit-a1b2',
      agentName: 'sched-sch-abc123',
      prompt: 'Review it.',
    }],
  }));

  const result = runWorkflow(['run', '--id', 'sch-abc123'], {
    env: { ...env, OMP_SCHEDULE_NOW: '2026-09-05T15:00:00Z' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /skipped: sch-abc123/);
  assert.match(result.stdout, /outside interval weekday window/);
  assert.equal(fs.existsSync(env.HERDR_LOG), false);

  const events = fs.readFileSync(path.join(env.OMP_SCHEDULE_ROOT, 'runs', 'sch-abc123', 'events.jsonl'), 'utf8');
  assert.match(events, /outside interval weekday window/);
});
