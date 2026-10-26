'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_MODEL = 'openai-codex/gpt-5.6-sol:high';
const BASE_MODEL = 'openai-codex/gpt-5.6-sol';
const COVERAGE_STATUSES = new Set([
  'reviewed',
  'generated-or-lockfile-reviewed',
  'blocked',
]);
const FINDING_COVERAGE = new Set([
  'novel',
  'active-bot-overlap',
  'resolved-or-outdated-bot-overlap',
]);

function fail(message) {
  throw new Error(message);
}

function parsePrUrl(raw) {
  const value = String(raw || '').trim();
  const match = value.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?$/);
  if (!match) {
    fail('a single GitHub pull-request URL is required');
  }
  return {
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
    owner: match[1],
    repo: match[2],
    pullNumber: Number(match[3]),
  };
}

function parseFlags(argv) {
  const command = argv[0];
  const flags = {};
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name || !name.startsWith('--') || value === undefined) {
      fail(`invalid arguments near ${name || '<end>'}`);
    }
    flags[name.slice(2)] = value;
  }
  return { command, flags };
}

function execFile(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    fail(`${command} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function validateModelListing(listing) {
  const text = String(listing || '');
  const hasProvider = /\bopenai-codex\b/.test(text);
  const hasModel = /\bgpt-5\.6-sol\b/.test(text);
  const hasHigh = /\bhigh\b/.test(text);
  if (!hasProvider || !hasModel || !hasHigh || /No models matching/i.test(text)) {
    fail(`${REQUIRED_MODEL} is unavailable in the current OMP model registry`);
  }
  return REQUIRED_MODEL;
}

function selectTopology(reviewableFiles, structural) {
  const count = Number(reviewableFiles);
  if (!Number.isInteger(count) || count < 0) {
    fail('reviewable file count must be a non-negative integer');
  }
  if (count <= 40) {
    return structural ? ['architecture'] : [];
  }
  return structural ? ['code-01', 'code-02', 'architecture'] : ['code-01', 'code-02'];
}

function flattenSlurp(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((page) => Array.isArray(page) ? page : [page]);
}

function runGhJson(args, options = {}) {
  const output = execFile(options.ghBin || 'gh', args, options);
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(`gh returned invalid JSON: ${error.message}`);
  }
}

function runGhText(args, options = {}) {
  return execFile(options.ghBin || 'gh', args, options);
}

function graphQlPage(query, variables, options = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    if (value === null || value === undefined) {
      continue;
    }
    const flag = typeof value === 'number' ? '-F' : '-f';
    args.push(flag, `${name}=${value}`);
  }
  return runGhJson(args, options);
}

function collectGraphQlPages(query, variables, selectConnection, options = {}) {
  const nodes = [];
  let cursor = null;
  const fetchPage = options.graphQlPage || graphQlPage;
  for (let page = 0; page < 100; page += 1) {
    const response = fetchPage(query, { ...variables, cursor }, options);
    const connection = selectConnection(response);
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
      fail('GitHub GraphQL response is missing the expected connection');
    }
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) {
      return nodes;
    }
    cursor = connection.pageInfo.endCursor;
    if (!cursor) {
      fail('GitHub GraphQL pagination did not return an end cursor');
    }
  }
  fail('GitHub GraphQL pagination exceeded 100 pages');
}

function isReviewBot(login) {
  const value = String(login || '').toLowerCase();
  if (!value || value === 'pullrequest[bot]') {
    return false;
  }
  return value.endsWith('[bot]') || [
    'cursor',
    'coderabbitai',
    'copilot',
    'codex',
    'github-actions',
  ].includes(value);
}

function linkedIssueRefs(body, defaultOwner, defaultRepo) {
  const refs = new Map();
  const text = String(body || '');
  for (const match of text.matchAll(/(?:^|[\s(])#(\d+)\b/g)) {
    const number = Number(match[1]);
    refs.set(`${defaultOwner}/${defaultRepo}#${number}`, {
      owner: defaultOwner,
      repo: defaultRepo,
      number,
    });
  }
  for (const match of text.matchAll(/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/g)) {
    const ref = { owner: match[1], repo: match[2], number: Number(match[3]) };
    refs.set(`${ref.owner}/${ref.repo}#${ref.number}`, ref);
  }
  return [...refs.values()];
}

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line startLine diffSide startDiffSide subjectType
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id fullDatabaseId author { login } body url path line startLine diffHunk
              outdated state createdAt
            }
          }
        }
      }
    }
  }
}`;

const THREAD_COMMENTS_QUERY = `
query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id fullDatabaseId author { login } body url path line startLine diffHunk
          outdated state createdAt
        }
      }
    }
  }
}`;

const CHECKS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      statusCheckRollup {
        contexts(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on CheckRun { name conclusion status detailsUrl }
            ... on StatusContext { context state targetUrl }
          }
        }
      }
    }
  }
}`;

function completeThreadComments(thread, options = {}) {
  if (!thread.comments || !thread.comments.pageInfo || !thread.comments.pageInfo.hasNextPage) {
    return thread;
  }
  const extra = collectGraphQlPages(
    THREAD_COMMENTS_QUERY,
    { id: thread.id },
    (response) => response.data && response.data.node && response.data.node.comments,
    options,
  );
  const existingIds = new Set(thread.comments.nodes.map((comment) => comment.id));
  const comments = thread.comments.nodes.concat(extra.filter((comment) => !existingIds.has(comment.id)));
  return { ...thread, comments: { nodes: comments, pageInfo: { hasNextPage: false, endCursor: null } } };
}

function sanitizePull(pull) {
  return {
    url: pull.html_url,
    number: pull.number,
    title: pull.title,
    body: pull.body || '',
    author: pull.user && pull.user.login,
    labels: (pull.labels || []).map((label) => label.name),
    baseRefName: pull.base && pull.base.ref,
    baseRefOid: pull.base && pull.base.sha,
    headRefName: pull.head && pull.head.ref,
    headRefOid: pull.head && pull.head.sha,
    draft: Boolean(pull.draft),
    mergeable: pull.mergeable,
    state: pull.state,
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeCollection(outputDir, collection) {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  writeJson(path.join(outputDir, 'review-context.json'), collection.reviewContext);
  writeJson(path.join(outputDir, 'bot-inventory.json'), collection.botInventory);
  writeJson(path.join(outputDir, 'collection-manifest.json'), collection.manifest);
}

function collectPullRequest(url, outputDir, options = {}) {
  const parsed = parsePrUrl(url);
  const slug = `repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}`;
  const pull = runGhJson(['api', slug], options);
  const diff = runGhText(['api', slug, '-H', 'Accept: application/vnd.github.v3.diff'], options);
  const files = flattenSlurp(runGhJson(['api', `${slug}/files`, '--paginate', '--slurp'], options));
  const commits = flattenSlurp(runGhJson(['api', `${slug}/commits`, '--paginate', '--slurp'], options));
  const issueComments = flattenSlurp(runGhJson([
    'api',
    `repos/${parsed.owner}/${parsed.repo}/issues/${parsed.pullNumber}/comments`,
    '--paginate',
    '--slurp',
  ], options));
  const variables = { owner: parsed.owner, repo: parsed.repo, number: parsed.pullNumber };
  const threads = collectGraphQlPages(
    REVIEW_THREADS_QUERY,
    variables,
    (response) => response.data.repository.pullRequest.reviewThreads,
    options,
  ).map((thread) => completeThreadComments(thread, options));
  const checks = collectGraphQlPages(
    CHECKS_QUERY,
    variables,
    (response) => {
      const rollup = response.data.repository.pullRequest.statusCheckRollup;
      return rollup ? rollup.contexts : { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    },
    options,
  );
  const linkedIssues = linkedIssueRefs(pull.body, parsed.owner, parsed.repo).map((ref) => ({
    ...ref,
    issue: runGhJson(['api', `repos/${ref.owner}/${ref.repo}/issues/${ref.number}`], options),
  }));
  const sanitizedPull = sanitizePull(pull);
  const reviewContext = {
    pull: sanitizedPull,
    diff,
    files,
    commits,
    linkedIssues,
    checks,
  };
  const botThreads = threads.map((thread) => ({
    ...thread,
    comments: {
      ...thread.comments,
      nodes: thread.comments.nodes.filter((comment) => isReviewBot(comment.author && comment.author.login)),
    },
  })).filter((thread) => thread.comments.nodes.length > 0);
  const botInventory = {
    reviewThreads: botThreads,
    issueComments: issueComments.filter((comment) => isReviewBot(comment.user && comment.user.login)),
  };
  const manifest = {
    owner: parsed.owner,
    repo: parsed.repo,
    pullNumber: parsed.pullNumber,
    url: parsed.url,
    headSha: sanitizedPull.headRefOid,
    baseSha: sanitizedPull.baseRefOid,
    changedFiles: files
      .filter((file) => file.status !== 'removed')
      .map((file) => ({ path: file.filename, status: file.status })),
  };
  const collection = { reviewContext, botInventory, manifest };
  writeCollection(outputDir, collection);
  return collection;
}

function materializeFixture(fixturePath, outputDir) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!fixture.reviewContext || !fixture.botInventory || !fixture.manifest) {
    fail('fixture must contain reviewContext, botInventory, and manifest');
  }
  writeCollection(outputDir, fixture);
  return fixture;
}

function validateBlindIsolation(reviewContext) {
  const serialized = JSON.stringify(reviewContext);
  const forbidden = ['reviewThreads', 'botInventory', 'issueComments'];
  for (const key of forbidden) {
    if (serialized.includes(`\"${key}\"`)) {
      fail(`blind review context contains forbidden bot field ${key}`);
    }
  }
  return true;
}

function validateCoverage(manifest, coverage, expectedHead) {
  if (!manifest || !coverage || manifest.headSha !== expectedHead || coverage.reviewedSha !== expectedHead) {
    fail('coverage SHA does not match the reviewed head');
  }
  const expected = (manifest.changedFiles || []).map((file) => file.path);
  const records = Array.isArray(coverage.files) ? coverage.files : [];
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record.path !== 'string' || !COVERAGE_STATUSES.has(record.status)) {
      fail('coverage contains an invalid record');
    }
    if (seen.has(record.path)) {
      fail(`coverage contains duplicate path ${record.path}`);
    }
    seen.add(record.path);
  }
  const missing = expected.filter((file) => !seen.has(file));
  const extra = [...seen].filter((file) => !expected.includes(file));
  if (missing.length || extra.length) {
    fail(`coverage mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }
  return {
    reviewed: records.filter((record) => record.status === 'reviewed').length,
    generated: records.filter((record) => record.status === 'generated-or-lockfile-reviewed').length,
    blocked: records.filter((record) => record.status === 'blocked').length,
  };
}

function filterNovelComment(input) {
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const prompts = Array.isArray(input.prompts) ? input.prompts : [];
  for (const item of findings.concat(prompts)) {
    if (!FINDING_COVERAGE.has(item.coverage)) {
      fail('every finding and prompt must have a valid coverage label');
    }
  }
  return {
    findings: findings.filter((finding) => finding.coverage === 'novel'),
    prompts: prompts.filter((prompt) => prompt.coverage === 'novel'),
  };
}

function verifyHead(url, expectedSha, options = {}) {
  const parsed = parsePrUrl(url);
  const pull = options.fetchPull
    ? options.fetchPull(parsed)
    : runGhJson([
      'api',
      `repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}`,
    ], options);
  const currentSha = pull.head && pull.head.sha;
  if (!currentSha) {
    fail(`PR head is unavailable for ${expectedSha}`);
  }
  if (currentSha !== expectedSha && !options.allowChanged) {
    fail(`PR head changed from ${expectedSha} to ${currentSha || '<missing>'}`);
  }
  return currentSha;
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    fail(`--${name} is required`);
  }
  return flags[name];
}

function main(argv) {
  const { command, flags } = parseFlags(argv);
  if (command === 'preflight') {
    const parsed = parsePrUrl(requireFlag(flags, 'arguments'));
    const cwd = path.resolve(requireFlag(flags, 'cwd'));
    if (!fs.existsSync(cwd)) {
      fail(`working directory does not exist: ${cwd}`);
    }
    const ompBin = flags['omp-bin'] || 'omp';
    const listing = execFile(ompBin, ['models', 'gpt-5.6-sol'], { cwd });
    validateModelListing(listing);
    return { ...parsed, cwd, requiredModel: REQUIRED_MODEL };
  }
  if (command === 'topology') {
    return {
      supplements: selectTopology(
        Number(requireFlag(flags, 'reviewable-files')),
        requireFlag(flags, 'structural') === 'true',
      ),
    };
  }
  if (command === 'collect') {
    const collection = collectPullRequest(
      requireFlag(flags, 'url'),
      path.resolve(requireFlag(flags, 'output-dir')),
      { ghBin: flags['gh-bin'] || 'gh' },
    );
    validateBlindIsolation(collection.reviewContext);
    return {
      outputDir: path.resolve(flags['output-dir']),
      headSha: collection.manifest.headSha,
      changedFiles: collection.manifest.changedFiles.length,
      botThreads: collection.botInventory.reviewThreads.length,
    };
  }
  if (command === 'materialize-fixture') {
    const fixture = materializeFixture(
      path.resolve(requireFlag(flags, 'fixture')),
      path.resolve(requireFlag(flags, 'output-dir')),
    );
    validateBlindIsolation(fixture.reviewContext);
    return { outputDir: path.resolve(flags['output-dir']), headSha: fixture.manifest.headSha };
  }
  if (command === 'validate-coverage') {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(requireFlag(flags, 'manifest')), 'utf8'));
    const coverage = JSON.parse(fs.readFileSync(path.resolve(requireFlag(flags, 'coverage')), 'utf8'));
    return validateCoverage(manifest, coverage, requireFlag(flags, 'head-sha'));
  }
  if (command === 'filter-comment') {
    const input = JSON.parse(fs.readFileSync(path.resolve(requireFlag(flags, 'input')), 'utf8'));
    return filterNovelComment(input);
  }
  if (command === 'verify-head') {
    const reviewedSha = requireFlag(flags, 'head-sha');
    const headSha = verifyHead(requireFlag(flags, 'url'), reviewedSha, {
      ghBin: flags['gh-bin'] || 'gh',
      allowChanged: true,
    });
    return { reviewedSha, headSha, changed: headSha !== reviewedSha };
  }
  fail(`unknown command ${command || '<missing>'}`);
}

if (require.main === module) {
  try {
    const result = main(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Blocked: peer-review ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BASE_MODEL,
  REQUIRED_MODEL,
  collectGraphQlPages,
  filterNovelComment,
  isReviewBot,
  linkedIssueRefs,
  materializeFixture,
  parsePrUrl,
  selectTopology,
  validateBlindIsolation,
  validateCoverage,
  validateModelListing,
  verifyHead,
};
