#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOCAL_RUNTIME = path.resolve(__dirname, 'local-runtime.cjs');
const DEFAULT_RUN_ROOT = path.join(os.homedir(), '.omp', 'workflow-runs', 'slack-qa');

function fail(message) {
  throw new Error(message);
}

function redact(text) {
  return String(text)
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, '[REDACTED_SLACK_TOKEN]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args[index + 1].startsWith('--')) fail(`missing required option: ${name}`);
  return args[index + 1];
}

function parsePrUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('Slack QA requires a valid GitHub pull request URL'); }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash) {
    fail('Slack QA requires a github.com pull request URL');
  }
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/);
  if (!match) fail('Slack QA requires a URL in the form https://github.com/OWNER/REPOSITORY/pull/NUMBER');
  return {
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
  };
}

function run(args, options = {}) {
  const result = childProcess.spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    cwd: options.cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status === 0) return result.stdout;
  if (result.error?.code === 'ENOENT') fail(`${args[0]} is not installed`);
  fail(redact((result.stderr || result.stdout || result.error?.message || 'command failed').trim()));
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const stat = fs.statSync(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) fail(`unsafe Slack QA run directory: ${directory}`);
}

function inspectLocalRuntime(checkout) {
  const result = childProcess.spawnSync(process.execPath, [LOCAL_RUNTIME, 'status', '--checkout', checkout], { encoding: 'utf8' });
  if (result.status !== 0) fail(redact(result.stderr || result.stdout || 'local Slack runtime is unavailable'));
  try { return JSON.parse(result.stdout); } catch { fail('local Slack runtime returned invalid JSON'); }
}

function inspectPr(pr) {
  const metadataText = run(['gh', 'pr', 'view', pr.url, '--json', 'number,title,body,url,headRefName,baseRefName,files']);
  let metadata;
  try { metadata = JSON.parse(metadataText); } catch { fail('GitHub returned invalid pull request metadata'); }
  const diff = run(['gh', 'pr', 'diff', pr.url]);
  if (!diff.trim()) fail('GitHub pull request has an empty diff');
  return { metadata, diff };
}

function assertBranchMatchesPr(runtime, metadata) {
  const expectedBranch = metadata.headRefName ? `${metadata.headRefName}-local` : '';
  if (!expectedBranch || runtime.branch !== expectedBranch) {
    fail(`local branch ${runtime.branch || 'unknown'} does not match pull request head ${metadata.headRefName || 'unknown'}`);
  }
}

function writeArtifact(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function main() {
  const args = process.argv.slice(2);
  if (args.filter(value => value === '--pr').length !== 1 || args.filter(value => value === '--checkout').length !== 1 || args.length !== 4) {
    fail('usage: prepare.cjs --pr <github-pr-url> --checkout <primary-checkout>');
  }
  const pr = parsePrUrl(option(args, '--pr'));
  const checkout = path.resolve(option(args, '--checkout'));
  const runtime = inspectLocalRuntime(checkout);
  if (runtime.mode !== 'local' || runtime.checkout !== fs.realpathSync(checkout)) fail('local Slack runtime is not ready for Slack QA');
  const remote = run(['git', '-C', checkout, 'remote', 'get-url', 'origin']).trim();
  const remoteMatch = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!remoteMatch || remoteMatch[1].toLowerCase() !== pr.owner.toLowerCase() || remoteMatch[2].toLowerCase() !== pr.repo.toLowerCase()) {
    fail(`pull request repository ${pr.owner}/${pr.repo} does not match the local checkout origin`);
  }
  const inspected = inspectPr(pr);
  if (Number(inspected.metadata.number) !== pr.number) fail('GitHub returned a different pull request than requested');
  assertBranchMatchesPr(runtime, inspected.metadata);

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-pr-${pr.number}`;
  const runDirectory = path.resolve(process.env.SLACK_QA_RUN_ROOT || DEFAULT_RUN_ROOT, runId);
  ensurePrivateDirectory(path.dirname(runDirectory));
  ensurePrivateDirectory(runDirectory);
  const metadataPath = path.join(runDirectory, 'pull-request.json');
  const diffPath = path.join(runDirectory, 'pull-request.diff');
  const planPath = path.join(runDirectory, 'test-plan.md');
  writeArtifact(metadataPath, JSON.stringify({ ...inspected.metadata, requestedUrl: pr.url, owner: pr.owner, repo: pr.repo, number: pr.number }, null, 2));
  writeArtifact(diffPath, inspected.diff);
  process.stdout.write(`${JSON.stringify({
    runId,
    runDirectory,
    planPath,
    metadataPath,
    diffPath,
    pullRequest: { url: pr.url, owner: pr.owner, repo: pr.repo, number: pr.number, title: inspected.metadata.title || '' },
    runtime,
  })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${redact(error.message)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { __test: { assertBranchMatchesPr, parsePrUrl } };
