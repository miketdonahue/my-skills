#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
  throw new Error(message);
}

try {
  const args = process.argv.slice(2);
  const allowed = new Set(['--team', '--plan', '--cwd']);
  const seen = new Set();
  const values = {};

  if (args.length % 2 !== 0) {
    fail('Each option must have exactly one value');
  }

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!allowed.has(option)) fail('Unknown or misplaced option: ' + option);
    if (seen.has(option)) fail('Option may be provided only once: ' + option);
    seen.add(option);
    values[option] = args[index + 1];
  }

  const teamValue = values['--team'];
  const planValue = values['--plan'];
  const cwdValue = values['--cwd'] || process.cwd();

  if (!teamValue) fail('Missing required option: --team');
  if (!planValue) fail('Missing required option: --plan');
  if (teamValue !== 'wa' && teamValue !== 'con') {
    fail('Team must be wa or con');
  }

  const cwd = path.resolve(cwdValue);
  const planPath = path.resolve(cwd, planValue);
  const extension = path.extname(planPath).toLowerCase();
  if (extension !== '.md' && extension !== '.html') {
    fail('Plan must use the .md or .html extension');
  }

  let stat;
  try {
    stat = fs.statSync(planPath);
    fs.accessSync(planPath, fs.constants.R_OK);
  } catch (error) {
    fail('Plan is not readable: ' + planPath);
  }
  if (!stat.isFile()) fail('Plan is not a regular file: ' + planPath);
  if (stat.size === 0) fail('Plan is empty: ' + planPath);
  const planText = fs.readFileSync(planPath, 'utf8');
  if (/Plan Status:\s*Draft\b/.test(planText)) fail('Plan Status: Draft plans cannot become tickets');

  process.stdout.write(JSON.stringify({
    type: 'ticket-input',
    teamKey: teamValue.toUpperCase(),
    planPath,
    extension
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = 1;
}
