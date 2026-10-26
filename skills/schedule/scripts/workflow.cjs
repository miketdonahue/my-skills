#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const SCHEDULE_ROOT = path.resolve(process.env.OMP_SCHEDULE_ROOT || path.join(HOME, '.omp', 'workflow-runs', 'schedule'));
const JOBS_PATH = path.join(SCHEDULE_ROOT, 'jobs.json');
const RUNS_ROOT = path.join(SCHEDULE_ROOT, 'runs');
const CRON_LOG_PATH = path.join(SCHEDULE_ROOT, 'cron.log');
const OMP_AGENT_ROOT = path.resolve(process.env.OMP_SCHEDULE_AGENT_ROOT || path.join(HOME, '.omp', 'agent'));
const SKILLS_ROOT = path.resolve(process.env.OMP_SCHEDULE_SKILLS_ROOT || path.join(OMP_AGENT_ROOT, 'skills'));
const OMP_CONFIG_PATH = path.resolve(process.env.OMP_SCHEDULE_CONFIG_PATH || path.join(OMP_AGENT_ROOT, 'config.yml'));
const WORKTREE_WORKFLOW = process.env.OMP_SCHEDULE_WORKTREE_WORKFLOW || path.join(HOME, '.omp', 'agent', 'skills', 'worktree', 'scripts', 'workflow.cjs');
const HERDR = process.env.OMP_SCHEDULE_HERDR_BIN || 'herdr';
const OMP = process.env.OMP_SCHEDULE_OMP_BIN || 'omp';
const CRONTAB = process.env.OMP_SCHEDULE_CRONTAB_BIN || 'crontab';
const TIMEZONE = 'America/Los_Angeles';
const CRON_PATH = '/Users/michael/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const OWNED_BEGIN = 'OMP_SCHEDULE_BEGIN';
const OWNED_END = 'OMP_SCHEDULE_END';
const INTERVAL_WINDOW_START = '08:30';
const INTERVAL_WINDOW_END = '16:30';
const INTERVAL_WINDOW_START_MINUTES = 8 * 60 + 30;
const INTERVAL_WINDOW_END_MINUTES = 16 * 60 + 30;
const INTERVAL_MAX_MINUTES = INTERVAL_WINDOW_END_MINUTES - INTERVAL_WINDOW_START_MINUTES;
const SHELL_PANE_DISCOVERY_ATTEMPTS = 10;
const SHELL_PANE_DISCOVERY_DELAY_MS = 250;

class WorkflowError extends Error {
  constructor(phase, reason) {
    super(reason);
    this.phase = phase;
  }
}

function fail(phase, reason) {
  throw new WorkflowError(phase, reason);
}

function intervalRangeMessage() {
  return `--interval must be an integer from 1 to ${INTERVAL_MAX_MINUTES} minutes`;
}

function mkdir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeAtomic(file, value) {
  mkdir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, value, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, value) {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(file, value) {
  mkdir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`, { mode: 0o600 });
}

function option(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) {
    if (required) fail('parse', `missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}

function rawOption(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    if (required) fail('parse', `missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}

function tokenize(raw) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const character of String(raw || '')) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }

  if (quote) fail('parse', 'unterminated quote in arguments');
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function parseScheduleArguments(raw) {
  const tokens = tokenize(raw);
  if (tokens.includes('--help')) return { help: true };

  const parsed = {};
  const accepted = new Set(['--name', '--frequency', '--time', '--interval', '--day', '--prompt', '--skill', '--skill-args']);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!accepted.has(token)) fail('parse', `unsupported argument: ${token}`);
    if (Object.prototype.hasOwnProperty.call(parsed, token)) fail('parse', `duplicate option: ${token}`);
    if (
      index + 1 >= tokens.length
      || (tokens[index + 1].startsWith('--') && (token !== '--skill-args' || accepted.has(tokens[index + 1])))
    ) {
      fail('parse', `missing value for ${token}`);
    }
    parsed[token] = tokens[index + 1];
    index += 1;
  }

  const name = String(parsed['--name'] || '').trim();
  const frequency = String(parsed['--frequency'] || '').trim().toLowerCase();
  const time = String(parsed['--time'] || '').trim();
  const interval = String(parsed['--interval'] || '').trim();
  const day = parsed['--day'] ? String(parsed['--day']).trim().toLowerCase() : null;
  const prompt = String(parsed['--prompt'] || '').trim();
  const skillName = String(parsed['--skill'] || '').trim();
  const hasSkillArgs = Object.prototype.hasOwnProperty.call(parsed, '--skill-args');
  const skillArgs = hasSkillArgs ? String(parsed['--skill-args']).trim() : '';

  if (!name) fail('parse', 'missing required option: --name');
  if (hasSkillArgs && !skillName) fail('parse', '--skill-args is only accepted when --skill is used');
  if (prompt && skillName) fail('parse', 'use exactly one of --prompt or --skill');
  if (!prompt && !skillName) fail('parse', 'missing required target: --prompt or --skill');
  if (skillName && !/^[a-z][a-z0-9-]*$/.test(skillName)) {
    fail('parse', '--skill must be a simple kebab-case OMP skill name');
  }

  const target = skillName
    ? { targetType: 'skill', skillName, skillArgs }
    : { targetType: 'prompt', prompt };
  if (time && interval) fail('parse', 'use exactly one of --time or --interval');
  if (!time && !interval) fail('parse', 'missing required option: --time or --interval');

  if (interval) {
    if (frequency) fail('parse', '--frequency is not accepted when --interval is used');
    if (day) fail('parse', '--day is not accepted when --interval is used');
    if (!/^[1-9]\d*$/.test(interval)) fail('parse', intervalRangeMessage());
    const intervalMinutes = Number(interval);
    if (intervalMinutes < 1 || intervalMinutes > INTERVAL_MAX_MINUTES) {
      fail('parse', intervalRangeMessage());
    }
    return {
      name,
      scheduleType: 'interval',
      intervalMinutes,
      ...target,
    };
  }

  if (!frequency) fail('parse', 'missing required option: --frequency');
  if (!['daily', 'weekly', 'weekdays', 'monthly'].includes(frequency)) {
    fail('parse', '--frequency must be one of daily, weekly, weekdays, monthly');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    fail('parse', '--time must use 24-hour HH:MM, for example 09:00 or 17:30');
  }
  if (frequency === 'weekly' && !day) fail('parse', '--day is required when --frequency weekly');
  if (frequency !== 'weekly' && day) fail('parse', '--day is only accepted when --frequency weekly');
  if (day && !Object.prototype.hasOwnProperty.call(dayNumbers, day)) {
    fail('parse', '--day must be one of mon, tue, wed, thu, fri, sat, sun');
  }

  return { name, scheduleType: 'time', frequency, time, day, ...target };
}

const dayNumbers = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function helpText() {
  return [
    'Usage:',
    '  /schedule --name <name> --frequency <daily|weekly|weekdays|monthly> --time HH:MM [--day <mon|tue|wed|thu|fri|sat|sun>] --prompt "<prompt>"',
    '  /schedule --name <name> --frequency <daily|weekly|weekdays|monthly> --time HH:MM [--day <mon|tue|wed|thu|fri|sat|sun>] --skill <skill-name> [--skill-args "<args>"]',
    '  /schedule --name <name> --interval <minutes> --prompt "<prompt>"',
    '  /schedule --name <name> --interval <minutes> --skill <skill-name> [--skill-args "<args>"]',
    '',
    'Flags:',
    '  --help                       Show this help and make no changes.',
    '  --name <name>                Human-readable job name. Creates a scheduled--<job-slug> worktree.',
    '  --frequency <value>          One of: daily, weekly, weekdays, monthly.',
    '  --time HH:MM                 24-hour Pacific local time for fixed-time jobs.',
    '  --interval <minutes>         Run every N minutes on weekdays from 08:30 through 16:30 Pacific. Integer 1-480.',
    '  --day <value>                Required only for weekly. One of: mon, tue, wed, thu, fri, sat, sun.',
    '  --prompt "<prompt>"          Prompt OMP runs on each schedule.',
    '  --skill <skill-name>         Installed and enabled OMP skill to run on each schedule.',
    '  --skill-args "<args>"        Optional arguments passed to the scheduled skill.',
    '',
    'Rules:',
    '  --time and --interval are mutually exclusive.',
    '  --interval mode does not accept --frequency or --day.',
    '  --prompt and --skill are mutually exclusive.',
    '  --skill-args requires --skill.',
    '',
    'Examples:',
    '  /schedule --name nightly-audit --frequency daily --time 21:00 --prompt "Review today\'s repo changes and summarize risks."',
    '  /schedule --name status-check --interval 15 --prompt "Check the repo and summarize anything needing attention."',
    '  /schedule --name gateway-steward --interval 30 --skill gateway-steward',
    '  /schedule --name weekly-review --frequency weekly --day fri --time 16:30 --skill peer-review --skill-args "https://github.com/org/repo/pull/123"',
  ].join('\n');
}

function slugifyName(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!slug) fail('parse', '--name must contain at least one letter or digit');
  return slug;
}

function cronExpression({ frequency, time, day }) {
  const [hour, minute] = time.split(':');
  if (frequency === 'daily') return `${Number(minute)} ${Number(hour)} * * *`;
  if (frequency === 'weekdays') return `${Number(minute)} ${Number(hour)} * * 1-5`;
  if (frequency === 'weekly') return `${Number(minute)} ${Number(hour)} * * ${dayNumbers[day]}`;
  if (frequency === 'monthly') return `${Number(minute)} ${Number(hour)} 1 * *`;
  fail('parse', `unsupported frequency: ${frequency}`);
}

function intervalCronExpressions(intervalMinutes) {
  const expressions = [];
  for (let minuteOfDay = INTERVAL_WINDOW_START_MINUTES; minuteOfDay <= INTERVAL_WINDOW_END_MINUTES; minuteOfDay += intervalMinutes) {
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    expressions.push(`${minute} ${hour} * * 1-5`);
  }
  return expressions;
}

function cronExpressions(parsed) {
  if (parsed.scheduleType === 'interval') return intervalCronExpressions(parsed.intervalMinutes);
  return [cronExpression(parsed)];
}

function scheduleType(job) {
  return job.scheduleType || 'time';
}

function frequencyDisplay(job) {
  if (scheduleType(job) === 'interval') return `every ${job.intervalMinutes} minutes`;
  if (job.frequency === 'weekly') return `weekly ${job.day}`;
  return job.frequency;
}

function timeDisplay(job) {
  if (scheduleType(job) === 'interval') {
    return `${job.windowDays || 'weekdays'} ${job.windowStart || INTERVAL_WINDOW_START}-${job.windowEnd || INTERVAL_WINDOW_END} ${job.timezone || TIMEZONE}`;
  }
  return `${job.time} ${job.timezone}`;
}

function targetType(job) {
  return job.targetType || 'prompt';
}

function skillInvocation(job) {
  if (job.skillInvocation) return job.skillInvocation;
  const suffix = String(job.skillArgs || '').trim();
  return suffix ? `/skill:${job.skillName} ${suffix}` : `/skill:${job.skillName}`;
}

function targetDisplay(job) {
  if (targetType(job) === 'skill') return skillInvocation(job);
  return job.prompt;
}

function scheduledMessage(job) {
  if (targetType(job) === 'skill') return skillInvocation(job);
  return `Scheduled job "${job.name}" (${job.id})\n\n${job.prompt}`;
}

function run(args, options = {}) {
  const result = childProcess.spawnSync(args[0], args.slice(1), {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status === 0) return result.stdout.trim();
  return {
    failed: true,
    reason: (result.stderr || result.stdout || result.error?.message || `command failed: ${args.join(' ')}`).trim(),
  };
}

function mustRun(phase, args, options = {}) {
  const result = run(args, options);
  if (typeof result === 'string') return result;
  fail(phase, result.reason);
}

function maybeRun(args, options = {}) {
  return run(args, options);
}

function gitRoot(cwd) {
  return mustRun('repo', ['git', 'rev-parse', '--show-toplevel'], { cwd });
}

function gitWorktreePaths(repo) {
  const output = mustRun('repo', ['git', '-C', repo, 'worktree', 'list', '--porcelain']);
  const paths = new Set();
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) paths.add(realpathIfExists(line.slice('worktree '.length)));
  }
  return paths;
}

function localBranches(repo) {
  const output = mustRun('repo', ['git', '-C', repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return new Set(output.split('\n').map((line) => line.trim()).filter(Boolean));
}

function isLinkedWorktree(cwd) {
  const gitDir = mustRun('repo', ['git', 'rev-parse', '--path-format=absolute', '--git-dir'], { cwd });
  const gitCommon = mustRun('repo', ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  const superproject = maybeRun(['git', 'rev-parse', '--show-superproject-working-tree'], { cwd });
  const hasSuperproject = typeof superproject === 'string' && superproject.trim() !== '';
  return gitDir !== gitCommon && !hasSuperproject;
}

function loadStore() {
  if (!fs.existsSync(JOBS_PATH)) return { schemaVersion: 1, jobs: [] };
  const parsed = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf8'));
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.jobs)) {
    fail('state', `invalid jobs file: ${JOBS_PATH}`);
  }
  return parsed;
}

function saveStore(store) {
  writeJsonAtomic(JOBS_PATH, store);
}

function includedSkills() {
  if (!fs.existsSync(OMP_CONFIG_PATH)) fail('skill', `OMP config not found: ${OMP_CONFIG_PATH}`);
  const lines = fs.readFileSync(OMP_CONFIG_PATH, 'utf8').split('\n');
  const skills = new Set();
  let inSkills = false;
  let inIncludeSkills = false;
  let skillsIndent = -1;
  let includeIndent = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (trimmed === 'skills:') {
      inSkills = true;
      inIncludeSkills = false;
      skillsIndent = indent;
      includeIndent = -1;
      continue;
    }

    if (inSkills && indent <= skillsIndent && /^[A-Za-z0-9_-]+:/.test(trimmed)) {
      inSkills = false;
      inIncludeSkills = false;
    }

    if (!inSkills) continue;

    if (trimmed === 'includeSkills:') {
      inIncludeSkills = true;
      includeIndent = indent;
      continue;
    }

    if (inIncludeSkills && indent <= includeIndent && /^[A-Za-z0-9_-]+:/.test(trimmed)) {
      inIncludeSkills = false;
      continue;
    }

    if (inIncludeSkills) {
      const match = /^-\s+["']?([a-z][a-z0-9-]*)["']?\s*$/.exec(trimmed);
      if (match) skills.add(match[1]);
    }
  }

  return skills;
}

function validateScheduledSkill(skillName) {
  const skillPath = path.join(SKILLS_ROOT, skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) fail('skill', `scheduled skill not found: ${skillName}`);
  if (!includedSkills().has(skillName)) fail('skill', `scheduled skill is not enabled in skills.includeSkills: ${skillName}`);
}

function getCrontab() {
  const testFile = process.env.OMP_SCHEDULE_CRONTAB_FILE;
  if (testFile) {
    if (!fs.existsSync(testFile)) return '';
    return fs.readFileSync(testFile, 'utf8');
  }

  const result = childProcess.spawnSync(CRONTAB, ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status === 0) return result.stdout;
  return '';
}

function setCrontab(content) {
  const testFile = process.env.OMP_SCHEDULE_CRONTAB_FILE;
  const normalized = content.endsWith('\n') || content === '' ? content : `${content}\n`;
  if (testFile) {
    writeAtomic(testFile, normalized);
    return;
  }

  const tmp = path.join(os.tmpdir(), `omp-schedule-crontab-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, normalized, { mode: 0o600 });
  try {
    const result = childProcess.spawnSync(CRONTAB, [tmp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) fail('cron', (result.stderr || result.stdout || 'crontab update failed').trim());
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function cronIds(content) {
  const ids = new Set();
  for (const line of String(content || '').split('\n')) {
    const match = new RegExp(`^# ${OWNED_BEGIN} id=([a-zA-Z0-9_-]+)$`).exec(line.trim());
    if (match) ids.add(match[1]);
  }
  return ids;
}

function removeOwnedBlock(content, id) {
  const lines = String(content || '').split('\n');
  const next = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === `# ${OWNED_BEGIN} id=${id}`) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === `# ${OWNED_END} id=${id}`) {
      skipping = false;
      continue;
    }
    if (!skipping) next.push(line);
  }
  return next.join('\n').replace(/\n+$/g, '');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function cronBlock(job) {
  const command = [
    `PATH=${shellQuote(CRON_PATH)}`,
    '/usr/bin/env',
    'node',
    shellQuote(__filename),
    'run',
    '--id',
    shellQuote(job.id),
    '>>',
    shellQuote(CRON_LOG_PATH),
    '2>&1',
  ].join(' ');
  const expressions = Array.isArray(job.cronExpressions) && job.cronExpressions.length > 0
    ? job.cronExpressions
    : [job.cronExpression];
  return [
    `# ${OWNED_BEGIN} id=${job.id}`,
    ...expressions.map((expression) => `${expression} ${command}`),
    `# ${OWNED_END} id=${job.id}`,
  ].join('\n');
}

function upsertCronBlock(content, job) {
  const without = removeOwnedBlock(content, job.id);
  const prefix = without.trim() ? `${without.trim()}\n\n` : '';
  return `${prefix}${cronBlock(job)}\n`;
}

function parseReadyOutput(output) {
  const parsed = {};
  for (const line of String(output || '').trim().split('\n')) {
    const index = line.indexOf(': ');
    if (index > 0) parsed[line.slice(0, index)] = line.slice(index + 2);
  }
  for (const key of ['repo', 'worktree', 'branch', 'status']) {
    if (!parsed[key]) fail('worktree', `worktree helper did not return ${key}`);
  }
  if (parsed.status !== 'ready') fail('worktree', `worktree helper returned status ${parsed.status}`);
  return parsed;
}

function generateId(existingJobs) {
  const forced = process.env.OMP_SCHEDULE_FORCE_ID;
  if (forced) {
    if (!/^sch-[a-f0-9]{6}$/i.test(forced)) fail('parse', 'OMP_SCHEDULE_FORCE_ID must match sch-xxxxxx');
    return forced.toLowerCase();
  }

  const existing = new Set(existingJobs.map((job) => job.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `sch-${crypto.randomBytes(3).toString('hex')}`;
    if (!existing.has(id)) return id;
  }
  fail('state', 'could not generate a unique schedule id');
}

function snapshot() {
  const output = mustRun('herdr', [HERDR, 'api', 'snapshot']);
  const parsed = JSON.parse(output);
  return parsed.result?.snapshot || parsed.snapshot || parsed.result || parsed;
}

function realpathIfExists(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function findWorkspaceForWorktree(snap, worktreePath) {
  const workspace = findWorkspaceRecordForWorktree(snap, worktreePath);
  return workspace?.workspace_id || null;
}

function findWorkspaceRecordForWorktree(snap, worktreePath) {
  const target = realpathIfExists(worktreePath);
  for (const workspace of snap.workspaces || []) {
    const checkout = workspace.worktree?.checkout_path;
    if (checkout && realpathIfExists(checkout) === target) return workspace;
  }
  return null;
}

function cleanupCreatedWorktree(repoRoot, worktree, beforeWorktreePaths, beforeBranches, expectedPrefix) {
  const branch = worktree.branch || '';
  const worktreePath = worktree.worktree || '';
  const basename = path.basename(worktreePath);
  const pathKey = realpathIfExists(worktreePath);

  if (!branch.startsWith(`${expectedPrefix}-`) || !basename.startsWith(`${expectedPrefix}-`)) return false;
  if (beforeBranches.has(branch) || beforeWorktreePaths.has(pathKey)) return false;

  try {
    const workspaceId = findWorkspaceForWorktree(snapshot(), worktreePath);
    if (workspaceId) {
      maybeRun([HERDR, 'worktree', 'remove', '--workspace', workspaceId, '--force', '--json']);
    }
  } catch {}

  if (fs.existsSync(worktreePath)) {
    maybeRun(['git', '-C', repoRoot, 'worktree', 'remove', '--force', worktreePath]);
  }
  if (!beforeBranches.has(branch)) {
    maybeRun(['git', '-C', repoRoot, 'branch', '-D', branch]);
  }
  return true;
}

function findWorkspaceId(openResult) {
  if (!openResult || typeof openResult !== 'object') return null;
  if (typeof openResult.open_workspace_id === 'string') return openResult.open_workspace_id;
  if (typeof openResult.workspace_id === 'string') return openResult.workspace_id;
  for (const value of Object.values(openResult)) {
    const found = findWorkspaceId(value);
    if (found) return found;
  }
  return null;
}

function tabsForWorkspace(workspaceId) {
  const output = mustRun('herdr', [HERDR, 'tab', 'list', '--workspace', workspaceId]);
  const parsed = parseJsonCommand('herdr', output);
  return parsed.result?.tabs || parsed.tabs || [];
}

function tabIdForWorkspace(workspaceId) {
  const tabs = tabsForWorkspace(workspaceId);
  const focused = tabs.find((tab) => tab.focused && tab.tab_id);
  return focused?.tab_id || tabs.find((tab) => tab.tab_id)?.tab_id || null;
}

function panesForWorkspace(workspaceId) {
  const output = mustRun('herdr', [HERDR, 'pane', 'list', '--workspace', workspaceId]);
  const parsed = parseJsonCommand('herdr', output);
  return parsed.result?.panes || parsed.panes || [];
}

function samePath(a, b) {
  return realpathIfExists(a) === realpathIfExists(b);
}

function paneHasAgent(pane) {
  return Boolean(
    pane.agent
      || pane.agent_session
      || pane.display_agent
      || (pane.agent_status && pane.agent_status !== 'unknown'),
  );
}

function paneProcessInfo(paneId) {
  const output = mustRun('herdr', [HERDR, 'pane', 'process-info', '--pane', paneId]);
  const parsed = parseJsonCommand('herdr', output);
  return parsed.result?.process_info || parsed.process_info || null;
}

function isShellProcess(process) {
  const name = path.basename(String(process?.name || process?.argv0 || ''));
  return ['bash', 'fish', 'sh', 'zsh'].includes(name);
}

function isIdleShellPane(paneId) {
  const info = paneProcessInfo(paneId);
  const foreground = info?.foreground_processes || [];
  return foreground.length <= 1 && isShellProcess(foreground[0]);
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function reusablePaneForPlacement(placement, job, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const pane of panesForWorkspace(placement.workspaceId)) {
      if (!pane.pane_id) continue;
      const cwd = pane.foreground_cwd || pane.cwd;
      if (!cwd || !samePath(cwd, job.worktree)) continue;
      if (paneHasAgent(pane)) continue;
      if (isIdleShellPane(pane.pane_id)) return pane;
    }
    if (attempt + 1 < attempts) sleepSync(SHELL_PANE_DISCOVERY_DELAY_MS);
  }
  return null;
}

function parseJsonCommand(phase, output) {
  try {
    return JSON.parse(output);
  } catch {
    fail(phase, `command returned invalid JSON: ${output}`);
  }
}

function openWorkspace(job) {
  let snap = snapshot();
  const existing = findWorkspaceForWorktree(snap, job.worktree);
  if (existing) return existing;

  const repoCwd = job.cwd || job.repoRoot || process.cwd();

  const output = mustRun('herdr', [
    HERDR,
    'worktree',
    'open',
    '--cwd',
    repoCwd,
    '--path',
    job.worktree,
    '--label',
    job.branch,
    '--no-focus',
    '--json',
  ]);
  const parsed = parseJsonCommand('herdr', output);
  const workspaceId = findWorkspaceId(parsed);
  if (workspaceId) return workspaceId;

  snap = snapshot();
  const reopened = findWorkspaceForWorktree(snap, job.worktree);
  if (reopened) return reopened;
  fail('herdr', `could not open Herdr workspace for ${job.worktree}`);
}

function openWorkspacePlacement(job) {
  const workspaceId = openWorkspace(job);
  return { workspaceId, tabId: tabIdForWorkspace(workspaceId) };
}

function closeWorkspace(workspaceId) {
  mustRun('herdr', [HERDR, 'workspace', 'close', workspaceId]);
}

function getAgent(agentName) {
  const result = childProcess.spawnSync(HERDR, ['agent', 'get', agentName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = (result.stdout || result.stderr || result.error?.message || '').trim();
  const parsed = parseJsonCommand('herdr', output);
  if (parsed.error?.code === 'agent_not_found') return null;
  if (result.status !== 0) fail('herdr', output || `command failed: ${HERDR} agent get ${agentName}`);
  return parsed.result?.agent || parsed.agent || parsed.result || parsed;
}

function getScheduledAgent(job) {
  const byName = getAgent(job.agentName);
  if (byName) return { agent: byName, target: job.agentName };
  if (job.paneId) {
    const byPane = getAgent(job.paneId);
    if (byPane) return { agent: byPane, target: job.paneId };
  }
  return { agent: null, target: job.agentName };
}

function agentStatus(agent) {
  return agent.agent_status || agent.status || agent.state || agent.result?.agent_status || agent.result?.state || 'unknown';
}

function isTerminalAgentStatus(status) {
  return status === 'idle' || status === 'done';
}

function hasPriorRun(job) {
  return Number(job.runCount || 0) > 0 || Boolean(job.paneId);
}

function nextAgentName(job, runId) {
  return `sched-${job.id}-${runId}`;
}

function resetWorkspaceState(job, runId) {
  job.workspaceId = null;
  job.tabId = null;
  job.paneId = null;
  job.agentName = nextAgentName(job, runId);
  job.updatedAt = new Date().toISOString();
}

function skipScheduledRun(job, runId, reason) {
  appendJsonl(runLogPath(job.id), { event: 'skipped', runId, reason });
  return `skipped: ${job.id}\nreason: ${reason}`;
}

function reconcileScheduledWorkspace(job, store, runId) {
  const workspace = findWorkspaceRecordForWorktree(snapshot(), job.worktree);
  if (!workspace) {
    resetWorkspaceState(job, runId);
    saveStore(store);
    return { fresh: true };
  }

  const scheduledAgent = getScheduledAgent(job);
  if (!scheduledAgent.agent) {
    if (!hasPriorRun(job)) {
      resetWorkspaceState(job, runId);
      saveStore(store);
      return { fresh: true };
    }
    if (workspace.focused) return { skip: skipScheduledRun(job, runId, 'scheduled workspace is focused') };
    closeWorkspace(workspace.workspace_id);
    resetWorkspaceState(job, runId);
    saveStore(store);
    appendJsonl(runLogPath(job.id), {
      event: 'closed',
      runId,
      reason: 'scheduled agent not found after prior run',
      workspaceId: workspace.workspace_id,
    });
    return { fresh: true };
  }

  const status = agentStatus(scheduledAgent.agent);
  if (status === 'working' || status === 'blocked' || status === 'unknown') {
    return { skip: skipScheduledRun(job, runId, `scheduled agent is ${status}`) };
  }
  if (!isTerminalAgentStatus(status)) {
    return { skip: skipScheduledRun(job, runId, `scheduled agent has unsupported status: ${status}`) };
  }
  if (workspace.focused) return { skip: skipScheduledRun(job, runId, 'scheduled workspace is focused') };

  closeWorkspace(workspace.workspace_id);
  resetWorkspaceState(job, runId);
  saveStore(store);
  appendJsonl(runLogPath(job.id), {
    event: 'closed',
    runId,
    reason: `scheduled agent is ${status}`,
    workspaceId: workspace.workspace_id,
  });
  return { fresh: true };
}

function paneRunCommand(job, runId) {
  return [
    'cd',
    shellQuote(job.worktree),
    '&&',
    `OMP_SCHEDULE_JOB_ID=${shellQuote(job.id)}`,
    `OMP_SCHEDULE_RUN_ID=${shellQuote(runId)}`,
    shellQuote(OMP),
    shellQuote(scheduledMessage(job)),
  ].join(' ');
}

function startAgentInPane(paneId, job, runId) {
  mustRun('herdr', [HERDR, 'pane', 'run', paneId, paneRunCommand(job, runId)]);
}

function runLogPath(jobId) {
  return path.join(RUNS_ROOT, jobId, 'events.jsonl');
}

function lockPath(jobId) {
  return path.join(os.tmpdir(), `omp-schedule-${jobId}.lock`);
}

function acquireLock(jobId) {
  const file = lockPath(jobId);
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return () => {
      try {
        if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.unlinkSync(file);
      } catch {}
    };
  } catch (error) {
    return null;
  }
}

function pacificNowParts(now = new Date(process.env.OMP_SCHEDULE_NOW || Date.now())) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    weekday: String(parts.weekday || '').toLowerCase(),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function intervalWindowSkipReason(now = new Date(process.env.OMP_SCHEDULE_NOW || Date.now())) {
  const parts = pacificNowParts(now);
  const weekdays = new Set(['mon', 'tue', 'wed', 'thu', 'fri']);
  if (!weekdays.has(parts.weekday)) return 'outside interval weekday window';

  const minuteOfDay = parts.hour * 60 + parts.minute;
  if (minuteOfDay < INTERVAL_WINDOW_START_MINUTES || minuteOfDay > INTERVAL_WINDOW_END_MINUTES) {
    return 'outside interval time window';
  }
  return null;
}

function scheduleCommand(args) {
  const raw = rawOption(args, '--arguments', false) || '';
  const parsed = parseScheduleArguments(raw);
  if (parsed.help) return helpText();
  if (parsed.targetType === 'skill') validateScheduledSkill(parsed.skillName);

  const cwd = path.resolve(option(args, '--cwd', false) || process.cwd());
  if (isLinkedWorktree(cwd)) {
    fail('worktree', '/schedule must run from a primary repo checkout so it can create a dedicated scheduled-- worktree');
  }

  const repoRoot = fs.realpathSync(gitRoot(cwd));
  const repo = path.basename(repoRoot);
  const jobSlug = slugifyName(parsed.name);
  const worktreeRequestName = `scheduled--${jobSlug}`;
  const store = loadStore();
  const currentCrontab = getCrontab();
  const activeIds = cronIds(currentCrontab);
  const duplicate = store.jobs.find((job) => job.repoRoot === repoRoot && job.jobSlug === jobSlug && activeIds.has(job.id));
  if (duplicate) fail('state', `active scheduled job already exists for ${parsed.name}: ${duplicate.id}`);

  const beforeWorktreePaths = gitWorktreePaths(repoRoot);
  const beforeBranches = localBranches(repoRoot);
  const worktreeOutput = mustRun('worktree', [
    process.execPath,
    WORKTREE_WORKFLOW,
    'create',
    '--cwd',
    repoRoot,
    '--name',
    worktreeRequestName,
  ]);
  const worktree = parseReadyOutput(worktreeOutput);
  const id = generateId(store.jobs);
  const expressions = cronExpressions(parsed);
  const agentName = `sched-${id}`;
  const createdAt = new Date().toISOString();
  const workspaceId = (() => {
    try {
      return findWorkspaceForWorktree(snapshot(), worktree.worktree);
    } catch {
      return null;
    }
  })();
  const job = {
    schemaVersion: 1,
    id,
    name: parsed.name,
    jobSlug,
    repo,
    repoRoot,
    cwd: fs.realpathSync(cwd),
    workspaceId,
    worktreeRequestName,
    branch: worktree.branch,
    worktree: worktree.worktree,
    scheduleType: parsed.scheduleType,
    frequency: parsed.frequency,
    day: parsed.day,
    time: parsed.time,
    intervalMinutes: parsed.intervalMinutes,
    windowStart: parsed.scheduleType === 'interval' ? INTERVAL_WINDOW_START : undefined,
    windowEnd: parsed.scheduleType === 'interval' ? INTERVAL_WINDOW_END : undefined,
    windowDays: parsed.scheduleType === 'interval' ? 'weekdays' : undefined,
    timezone: TIMEZONE,
    targetType: parsed.targetType,
    prompt: parsed.prompt,
    skillName: parsed.skillName,
    skillArgs: parsed.skillArgs,
    skillInvocation: parsed.targetType === 'skill' ? skillInvocation(parsed) : undefined,
    cronExpression: expressions[0],
    cronExpressions: expressions,
    agentName,
    runCount: 0,
    createdAt,
    updatedAt: createdAt,
  };

  const previousStore = loadStore();
  const nextStore = { schemaVersion: 1, jobs: [...previousStore.jobs, job] };
  saveStore(nextStore);
  try {
    setCrontab(upsertCronBlock(currentCrontab, job));
  } catch (error) {
    saveStore(previousStore);
    cleanupCreatedWorktree(repoRoot, worktree, beforeWorktreePaths, beforeBranches, worktreeRequestName);
    throw error;
  }

  return [
    `scheduled: ${job.name}`,
    `id: ${job.id}`,
    `frequency: ${frequencyDisplay(job)}`,
    `time: ${timeDisplay(job)}`,
    `worktree: ${job.worktree}`,
    `branch: ${job.branch}`,
    'status: active',
  ].join('\n');
}

function runCommand(args) {
  const id = option(args, '--id');
  const store = loadStore();
  const job = store.jobs.find((item) => item.id === id);
  if (!job) fail('state', `scheduled job not found: ${id}`);
  if (!fs.existsSync(job.worktree)) fail('worktree', `scheduled worktree is missing: ${job.worktree}`);

  const release = acquireLock(id);
  if (!release) {
    appendJsonl(runLogPath(id), { event: 'skipped', reason: 'lock-held' });
    return `skipped: ${id}\nreason: previous scheduled run is still active`;
  }

  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  try {
    if (scheduleType(job) === 'interval') {
      const skipReason = intervalWindowSkipReason();
      if (skipReason) {
        appendJsonl(runLogPath(id), { event: 'skipped', runId, reason: skipReason });
        return `skipped: ${id}\nreason: ${skipReason}`;
      }
    }

    const lifecycle = reconcileScheduledWorkspace(job, store, runId);
    if (lifecycle.skip) return lifecycle.skip;

    const placement = openWorkspacePlacement(job);

    const pane = reusablePaneForPlacement(placement, job, SHELL_PANE_DISCOVERY_ATTEMPTS);
    if (!pane) {
      fail('herdr', `no reusable shell pane found for scheduled worktree ${job.worktree}; refusing to create a second pane`);
    }
    if (pane) {
      startAgentInPane(pane.pane_id, job, runId);
      job.workspaceId = placement.workspaceId;
      job.tabId = pane.tab_id || placement.tabId;
      job.paneId = pane.pane_id;
      job.runCount = Number(job.runCount || 0) + 1;
      job.updatedAt = new Date().toISOString();
      saveStore(store);
      appendJsonl(runLogPath(id), { event: 'started', runId, mode: 'fresh-pane', workspaceId: placement.workspaceId, tabId: job.tabId, paneId: pane.pane_id, agentName: job.agentName });
      return `started: ${id}\nmode: fresh-pane`;
    }

  } finally {
    release();
  }
}

function truncateCell(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function tableCell(value) {
  return truncateCell(value).replace(/\|/g, '\\|');
}

function listCommand() {
  const store = loadStore();
  const current = getCrontab();
  const activeIds = cronIds(current);
  const active = store.jobs.filter((job) => activeIds.has(job.id));
  const missing = store.jobs.filter((job) => !activeIds.has(job.id));
  const lines = [
    '| id | name | frequency | time | prompt |',
    '| --- | --- | --- | --- | --- |',
    ...active.map((job) => `| ${tableCell(job.id)} | ${tableCell(job.name)} | ${tableCell(frequencyDisplay(job))} | ${tableCell(timeDisplay(job))} | ${tableCell(targetDisplay(job))} |`),
  ];
  if (active.length === 0) lines.push('|  |  |  |  |  |');
  if (missing.length > 0) {
    lines.push('');
    lines.push(`Warning: omitted ${missing.length} job(s) present in metadata without active cron markers.`);
  }
  return lines.join('\n');
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'schedule') return scheduleCommand(args);
  if (command === 'run') return runCommand(args);
  if (command === 'list') return listCommand(args);
  if (command === 'help') return helpText();
  if (command === 'parse') return JSON.stringify(parseScheduleArguments(rawOption(args, '--arguments', false) || ''));
  fail('parse', 'usage: workflow.cjs schedule|run|list|help|parse ...');
}

if (require.main === module) {
  try {
    const output = main();
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    if (error instanceof WorkflowError) {
      process.stdout.write(`blocked: ${error.phase}\nreason: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`blocked: internal\nreason: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  __test: {
    cronExpression,
    cronExpressions,
    cronIds,
    frequencyDisplay,
    helpText,
    intervalCronExpressions,
    intervalWindowSkipReason,
    parseReadyOutput,
    parseScheduleArguments,
    pacificNowParts,
    removeOwnedBlock,
    slugifyName,
    tableCell,
    timeDisplay,
    tokenize,
    upsertCronBlock,
  },
};
