#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { finalizeHtml } = require('../../../lib/html-document.cjs');

function readOption(name, required = true) {
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

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join('');
}

function requireRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    throw new Error(`${label} is not readable: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label} is not a regular file: ${filePath}`);
  }
  if (stat.size === 0) {
    throw new Error(`${label} is empty: ${filePath}`);
  }
}

function nextAvailableBase(directory, requestedBase) {
  let base = requestedBase;
  let suffix = 2;
  while (fs.existsSync(path.join(directory, `${base}.md`)) || fs.existsSync(path.join(directory, `${base}.html`))) {
    base = `${requestedBase}-${suffix}`;
    suffix += 1;
  }
  return base;
}

function writeExclusive(filePath, content) {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

try {
  const mode = readOption('--mode', false) || 'final';
  if (!['draft', 'final'].includes(mode)) throw new Error(`Mode must be draft or final: ${mode}`);
  const project = slugify(readOption('--project'), 'project');
  const topic = slugify(readOption('--topic'), 'plan');
  const runId = readOption('--run-id', false);
  const markdownSource = path.resolve(readOption('--markdown-source'));
  const htmlSource = path.resolve(readOption('--html-source'));
  const brainstormSourceValue = readOption('--brainstorm-source', false);
  const brainstormSource = brainstormSourceValue ? path.resolve(brainstormSourceValue) : null;
  const outputRoot = path.resolve(
    process.env.OMP_PLANS_DIR || path.join(os.homedir(), '.omp', 'plans')
  );

  if (path.extname(markdownSource).toLowerCase() !== '.md') {
    throw new Error(`Markdown source must use the .md extension: ${markdownSource}`);
  }
  if (path.extname(htmlSource).toLowerCase() !== '.html') {
    throw new Error(`HTML source must use the .html extension: ${htmlSource}`);
  }

  requireRegularFile(markdownSource, 'Markdown source');
  requireRegularFile(htmlSource, 'HTML source');
  if (brainstormSource) {
    const extension = path.extname(brainstormSource).toLowerCase();
    if (extension !== '.md' && extension !== '.html') throw new Error(`Brainstorm source must use .md or .html: ${brainstormSource}`);
    requireRegularFile(brainstormSource, 'Brainstorm source');
  }

  const markdown = fs.readFileSync(markdownSource, 'utf8');
  const htmlSourceText = fs.readFileSync(htmlSource, 'utf8');
  const requiredStatus = mode === 'draft' ? 'Plan Status: Draft' : 'Plan Status: Final';
  if (!markdown.includes(requiredStatus) || !htmlSourceText.includes(requiredStatus)) {
    throw new Error(`Both plan sources must contain ${requiredStatus}`);
  }
  const html = finalizeHtml(htmlSourceText, `Implementation Plan: ${topic}`, {
    planStyles: true,
    removeFinalPlanStatus: mode === 'final'
  });
  if (mode === 'draft' && !runId) throw new Error('Draft mode requires --run-id');
  const outputDirectory = mode === 'draft'
    ? path.join(outputRoot, project, '.working', slugify(runId, 'run'))
    : path.join(outputRoot, project);
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

  const requestedBase = mode === 'draft' ? `${localTimestamp()}-${topic}` : `${localTimestamp()}-${topic}`;
  const base = nextAvailableBase(outputDirectory, requestedBase);
  const markdownPath = path.join(outputDirectory, `${base}.md`);
  const htmlPath = path.join(outputDirectory, `${base}.html`);
  let markdownCreated = false;

  try {
    writeExclusive(markdownPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    markdownCreated = true;
    writeExclusive(htmlPath, html);
  } catch (error) {
    if (markdownCreated) fs.unlinkSync(markdownPath);
    throw error;
  }

  process.stdout.write(JSON.stringify({
    type: 'plan-saved',
    project,
    topic,
    markdownPath,
    htmlPath
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = 1;
}
