#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_RUNTIME = path.resolve(__dirname, 'local-runtime.cjs');
const { readSlackCredentials } = require(LOCAL_RUNTIME);
const SLACK_API = 'https://slack.com/api';
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_POLL_MS = 5000;

function fail(message) {
  throw new Error(message);
}

function arg(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    if (required) fail(`missing required option: ${name}`);
    return null;
  }
  return args[index + 1];
}

function redact(text) {
  return String(text)
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[REDACTED_SLACK_TOKEN]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

function localRuntime(checkout) {
  const result = childProcess.spawnSync(process.execPath, [LOCAL_RUNTIME, 'status', '--checkout', checkout], {
    encoding: 'utf8',
  });
  if (result.status !== 0) fail(redact(result.stderr || result.stdout || 'local Slack runtime is unavailable'));
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail('local Slack runtime returned invalid JSON');
  }
}

async function slackCall(token, method, params) {
  const body = new URLSearchParams(params);
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) fail(`Slack API ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.ok) fail(`Slack API ${method} failed: ${payload.error || 'unknown_error'}`);
  return payload;
}

function isNewer(message, afterTs) {
  return Number.parseFloat(message.ts || '0') > Number.parseFloat(afterTs);
}

function matches(message, request) {
  const text = message.text || '';
  if (request.expectText !== undefined && text !== request.expectText) return false;
  if (Array.isArray(request.expectContains) && !request.expectContains.every(value => text.includes(value))) return false;
  if (request.expectRegex !== undefined && !new RegExp(request.expectRegex, request.expectRegexFlags || '').test(text)) return false;
  if (Array.isArray(request.expectFiles)) {
    const files = Array.isArray(message.files) ? message.files : [];
    if (!request.expectFiles.every(expected => files.some(file => file.name === expected || file.title === expected))) return false;
  }
  return true;
}

function hasAssertion(request) {
  return typeof request.expectText === 'string'
    || (Array.isArray(request.expectContains) && request.expectContains.length > 0)
    || (typeof request.expectRegex === 'string' && request.expectRegex.length > 0)
    || (Array.isArray(request.expectFiles) && request.expectFiles.length > 0);
}

async function findReply(token, channelId, rootTs, zoeUserId, request) {
  const timeout = Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0 ? request.timeoutMs : DEFAULT_TIMEOUT_MS;
  const pollMs = Number.isSafeInteger(request.pollIntervalMs) && request.pollIntervalMs > 0 ? request.pollIntervalMs : DEFAULT_POLL_MS;
  const deadline = Date.now() + timeout;
  let lastMessages = [];
  while (Date.now() < deadline) {
    let payload;
    try {
      payload = await slackCall(token, 'conversations.replies', { channel: channelId, ts: rootTs, limit: '100' });
      lastMessages = Array.isArray(payload.messages) ? payload.messages : [];
    } catch {
      // Some Slack app configurations deliver a bot reply as a top-level DM.
      // Fall back to history while retaining the sent-message timestamp bound.
      payload = await slackCall(token, 'conversations.history', { channel: channelId, oldest: rootTs, inclusive: 'false', limit: '100' });
      lastMessages = Array.isArray(payload.messages) ? payload.messages : [];
    }
    const reply = lastMessages.find(message => isNewer(message, rootTs) && message.user === zoeUserId && matches(message, request));
    if (reply) return reply;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  let permalink = 'unavailable';
  try {
    permalink = (await slackCall(token, 'chat.getPermalink', { channel: channelId, message_ts: rootTs })).permalink || permalink;
  } catch {}
  const authors = lastMessages.map(message => `${message.user || message.bot_id || 'unknown'}:${(message.text || '').slice(0, 120)}`).join(' | ');
  fail(`Zoe did not produce the expected DM reply before timeout for run ${request.runId}. Thread: ${permalink}. Last replies: ${redact(authors || 'none')}`);
}

async function runCase(checkout, request) {
  if (!request || typeof request.prompt !== 'string' || !request.prompt.trim()) fail('Slack QA case requires a non-empty prompt');
  if (!hasAssertion(request)) {
    fail('Slack QA case requires expectText, expectContains, expectRegex, or expectFiles');
  }
  const runId = crypto.randomUUID();
  const runtime = localRuntime(checkout);
  if (runtime.mode !== 'local' || !runtime.zoeUserId || !runtime.ports?.gateway) fail('local Slack runtime is not ready for Slack QA');
  const { qaUserToken: token } = readSlackCredentials(checkout);
  const opened = await slackCall(token, 'conversations.open', { users: runtime.zoeUserId });
  const channelId = opened.channel?.id;
  if (!channelId) fail('Slack did not return a direct-message channel for Zoe');
  const posted = await slackCall(token, 'chat.postMessage', {
    channel: channelId,
    text: request.prompt,
    metadata: JSON.stringify({
      event_type: 'omp_slack_qa',
      event_payload: { run_id: runId },
    }),
  });
  const rootTs = posted.ts || posted.message?.ts;
  if (!rootTs) fail('Slack did not return the direct-message timestamp');
  const reply = await findReply(token, channelId, rootTs, runtime.zoeUserId, { ...request, runId });
  let permalink = 'unavailable';
  try {
    permalink = (await slackCall(token, 'chat.getPermalink', { channel: channelId, message_ts: reply.ts })).permalink || permalink;
  } catch {}
  return {
    ok: true,
    runId,
    channelId,
    messageTs: rootTs,
    replyTs: reply.ts,
    replyText: reply.text || '',
    permalink,
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'run') fail('usage: direct-message.cjs run --checkout <primary-checkout>');
  const checkout = path.resolve(arg(args, '--checkout'));
  const input = fs.readFileSync(0, 'utf8');
  let request;
  try { request = JSON.parse(input); } catch { fail('Slack QA case input must be valid JSON'); }
  process.stdout.write(`${JSON.stringify(await runCase(checkout, request))}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${redact(error.message)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { __test: { hasAssertion, matches, redact } };
