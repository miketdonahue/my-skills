#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_REVIEWER_TURNS = 3;
const TURN_SEQUENCE = [
  ['main', 1],
  ['reviewer', 1],
  ['main', 2],
  ['reviewer', 2],
  ['main', 3],
  ['reviewer', 3],
];

function fail(message) {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exitCode = 1;
}

function option(name, required = true) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    if (required) throw new Error(`Missing required option: ${name}`);
    return null;
  }
  return process.argv[index + 1];
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function output(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function brainstormRoot() {
  return path.resolve(
    process.env.OMP_BRAINSTORMS_DIR || path.join(os.homedir(), '.omp', 'brainstorms')
  );
}

function assertChannelPath(channel) {
  const root = brainstormRoot();
  const relative = path.relative(root, channel);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Channel must be inside ${root}`);
  }
  if (path.extname(channel) !== '.md') {
    throw new Error(`Channel must be a Markdown file: ${channel}`);
  }
}

function readChannel(channel) {
  assertChannelPath(channel);
  if (!fs.existsSync(channel)) throw new Error(`Channel does not exist: ${channel}`);
  return fs.readFileSync(channel, 'utf8');
}

function turnHeaders(content) {
  return [...content.matchAll(/^## (Main|Reviewer) Turn ([1-3])$/gm)].map((match) => [
    match[1].toLowerCase(),
    Number(match[2]),
  ]);
}

function init() {
  const project = slugify(option('--project'), 'project');
  const draft = path.resolve(option('--draft'));
  const suppliedSession = option('--session', false);

  if (!fs.statSync(draft).isFile()) throw new Error(`Draft is not a regular file: ${draft}`);

  const session = suppliedSession || `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
  const channelDirectory = path.join(brainstormRoot(), project, 'adversarial-review');
  fs.mkdirSync(channelDirectory, { recursive: true, mode: 0o700 });

  const hash = crypto
    .createHash('sha256')
    .update(`${fs.realpathSync(draft)}\n${session}`)
    .digest('hex')
    .slice(0, 16);
  const channel = path.join(channelDirectory, `${hash}.md`);
  const content = [
    '# Adversarial Review Channel',
    '',
    '- **Status:** Pending',
    `- **Project:** ${project}`,
    `- **Draft:** \`${draft}\``,
    `- **Session:** ${session}`,
    `- **Channel hash:** ${hash}`,
    `- **Maximum reviewer turns:** ${MAX_REVIEWER_TURNS}`,
    '- **Protocol:** Main Turn 1 → Reviewer Turn 1 → Main Turn 2 → Reviewer Turn 2 → Main Turn 3 → Reviewer Turn 3',
    '',
  ].join('\n');

  const descriptor = fs.openSync(channel, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, content, { encoding: 'utf8' });
  } finally {
    fs.closeSync(descriptor);
  }

  output({ type: 'adversarial-review-initialized', project, session, hash, draft, channel });
}

function append() {
  const channel = path.resolve(option('--channel'));
  const role = option('--role').toLowerCase();
  const turn = Number(option('--turn'));
  const contentFile = path.resolve(option('--content-file'));

  if (!['main', 'reviewer'].includes(role)) throw new Error(`Invalid role: ${role}`);
  if (!Number.isInteger(turn) || turn < 1 || turn > MAX_REVIEWER_TURNS) {
    throw new Error(`Turn must be an integer from 1 to ${MAX_REVIEWER_TURNS}`);
  }
  if (!fs.statSync(contentFile).isFile()) {
    throw new Error(`Content file is not a regular file: ${contentFile}`);
  }

  const current = readChannel(channel);
  const headers = turnHeaders(current);
  const expected = TURN_SEQUENCE[headers.length];
  if (!expected) throw new Error('All six protocol turns have already been recorded');
  if (expected[0] !== role || expected[1] !== turn) {
    throw new Error(`Expected ${expected[0]} turn ${expected[1]}, received ${role} turn ${turn}`);
  }

  const content = fs.readFileSync(contentFile, 'utf8').trim();
  if (!content) throw new Error('Review entry cannot be empty');

  fs.appendFileSync(
    channel,
    `\n## ${role[0].toUpperCase() + role.slice(1)} Turn ${turn}\n\n${content}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  output({ type: 'adversarial-review-entry-appended', channel, role, turn });
}

function setStatus() {
  const channel = path.resolve(option('--channel'));
  const status = option('--status');
  const reasonFile = option('--reason-file', false);
  if (!['Pending', 'Aligned', 'Stalemate'].includes(status)) {
    throw new Error('Status must be Pending, Aligned, or Stalemate');
  }

  const current = readChannel(channel);
  if (status === 'Aligned' && !turnHeaders(current).some(([role]) => role === 'reviewer')) {
    throw new Error('Aligned status requires at least one reviewer turn');
  }
  const reason = reasonFile
    ? fs.readFileSync(path.resolve(reasonFile), 'utf8').trim()
    : '';
  if (reasonFile && !reason) throw new Error('Status reason cannot be empty');

  const entry = [
    '',
    '## Status Update',
    '',
    `- **Status:** ${status}`,
    reason ? `- **Reason:** ${reason.replace(/\n+/g, ' ')}` : null,
    '',
  ].filter(Boolean).join('\n');
  fs.appendFileSync(channel, entry, { encoding: 'utf8', mode: 0o600 });
  output({ type: 'adversarial-review-status-updated', channel, status });
}

try {
  const operation = process.argv[2];
  if (operation === 'init') init();
  else if (operation === 'append') append();
  else if (operation === 'status') setStatus();
  else throw new Error('Usage: adversarial-review-channel.cjs <init|append|status> [options]');
} catch (error) {
  fail(error.message);
}
