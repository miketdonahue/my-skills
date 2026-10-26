#!/usr/bin/env node
'use strict';

const {
  getInventory,
  herdrCommand,
  InventoryError,
  resolveTarget,
  tokenize,
} = require('../../../lib/herdr-worktree-inventory.cjs');

function fail(message) {
  throw new InventoryError(message);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) fail(`missing value for ${name}`);
  return args[index + 1];
}

function parseArgs(args) {
  const repo = option(args, '--repo');
  const positional = args.filter((arg, index) => {
    if (arg === '--repo') return false;
    if (repo !== null && index === args.indexOf('--repo') + 1) return false;
    return !arg.startsWith('--');
  });
  const unknownFlags = args.filter((arg) => arg.startsWith('--') && arg !== '--repo');
  if (unknownFlags.length) fail(`unexpected arguments: ${unknownFlags.join(' ')}`);
  if (positional.length !== 1) fail('usage: /open-worktree <name|branch|absolute-path> [--repo <path>]');
  return { repo, target: positional[0] };
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

function resultLines(action, inventory, worktree) {
  return [
    `## ${action} worktree`,
    '',
    '- Repository: `' + inventory.repoName + '`',
    '- Worktree: `' + worktree.path + '`',
    '- Branch: `' + (worktree.branch || '(detached)') + '`',
    '- Workspace: `' + (worktree.workspaceId || '-') + '`',
    '- State: `' + worktree.state + '`',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseInvocation(argv);
  const inventory = getInventory({ cwd: args.cwd || process.cwd(), repo: args.repo });
  const worktree = resolveTarget(inventory, args.target);

  if (worktree.state === 'OPEN') {
    herdrCommand(['workspace', 'focus', worktree.workspaceId]);
    process.stdout.write(`${resultLines('Focused', inventory, worktree)}\n`);
    return;
  }

  const output = herdrCommand([
    'worktree',
    'open',
    '--cwd',
    inventory.repo,
    '--path',
    worktree.path,
    '--focus',
    '--json',
  ]);
  let opened;
  try {
    opened = JSON.parse(output)?.result?.worktree;
  } catch (error) {
    fail(`herdr worktree open returned invalid JSON: ${error.message}`);
  }
  const reopened = {
    ...worktree,
    open: true,
    state: 'OPEN',
    status: opened?.agent_status || 'idle',
    workspaceId: opened?.open_workspace_id || worktree.workspaceId,
  };
  process.stdout.write(`${resultLines('Opened', inventory, reopened)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { __test: { main, parseArgs, parseInvocation, resultLines } };
