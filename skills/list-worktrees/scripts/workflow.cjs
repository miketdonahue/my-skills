#!/usr/bin/env node
'use strict';

const {
  getInventory,
  InventoryError,
  tokenize,
} = require('../../../lib/herdr-worktree-inventory.cjs');

function fail(message) {
  throw new InventoryError(message);
}

function parseArgs(args) {
  let repo = null;
  const searchParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo') {
      if (repo !== null) fail('duplicate option: --repo');
      repo = args[index + 1];
      if (!repo || repo.startsWith('--')) fail('missing value for --repo');
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) fail(`unexpected arguments: ${arg}`);
    searchParts.push(arg);
  }
  return { repo, search: searchParts.join(' ').trim() };
}

function parseInvocation(argv) {
  if (argv[0] !== 'invoke') return parseArgs(argv);
  const cwdIndex = argv.indexOf('--cwd');
  const argumentsIndex = argv.indexOf('--arguments');
  if (cwdIndex < 0 || argumentsIndex < 0 || cwdIndex + 1 >= argv.length || argumentsIndex + 1 >= argv.length) {
    fail('usage: workflow.cjs invoke --cwd <path> --arguments <arguments>');
  }
  const parsed = parseArgs(tokenize(argv[argumentsIndex + 1]));
  return { ...parsed, cwd: argv[cwdIndex + 1] };
}

function cell(value) {
  return String(value ?? '-').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatLastActive(timestamp) {
  if (timestamp === null || timestamp === undefined) return '-';
  return `${new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function filterByBranch(inventory, search) {
  const normalizedSearch = String(search || '').trim().toLocaleLowerCase();
  if (!normalizedSearch) return { ...inventory, search: '' };
  return {
    ...inventory,
    search: String(search).trim(),
    worktrees: inventory.worktrees.filter((worktree) => (
      String(worktree.branch || '(detached)').toLocaleLowerCase().includes(normalizedSearch)
    )),
  };
}

function format(inventory) {
  const lines = [
    `## Worktrees: ${inventory.repoName}${inventory.search ? ` (branch contains "${cell(inventory.search)}")` : ''}`,
    '',
    '| State | Last active | Workspace | Agent | Focused | Branch | Path |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const worktree of inventory.worktrees) {
    lines.push(`| ${[
      worktree.state,
      formatLastActive(worktree.lastActiveAt),
      worktree.workspaceId || '-',
      worktree.status || '-',
      worktree.focused ? 'yes' : 'no',
      worktree.branch || '(detached)',
      worktree.path,
    ].map(cell).join(' | ')} |`);
  }
  if (!inventory.worktrees.length) {
    lines.push(`| - | - | - | - | - | - | ${inventory.search ? 'No matching worktrees' : 'No managed Herdr worktrees'} |`);
  }
  lines.push('', 'Repository: `' + inventory.repo + '`', 'Managed root: `' + inventory.managedRoot + '`');
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseInvocation(argv);
  const inventory = filterByBranch(
    getInventory({ cwd: args.cwd || process.cwd(), repo: args.repo }),
    args.search,
  );
  process.stdout.write(`${format(inventory)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { __test: { filterByBranch, format, formatLastActive, main, parseArgs, parseInvocation } };
