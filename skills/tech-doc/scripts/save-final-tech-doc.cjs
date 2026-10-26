#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finalizeHtml, hasRawMermaidBlocks } = require('../../../lib/html-document.cjs');

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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function writeExclusive(filePath, content) {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function nextAvailable(directory, baseName) {
  let candidate = path.join(directory, `${baseName}.html`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${baseName}-${suffix}.html`);
    suffix += 1;
  }
  return candidate;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setTitle(html, title) {
  if (!/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    throw new Error('Tech-doc HTML is missing a title element');
  }
  return html.replace(/(<title\b[^>]*>)[\s\S]*?(<\/title>)/i, `$1${escapeHtml(title)}$2`);
}

function validateTemplate(html) {
  const required = [
    ['tech-doc template marker', /<html\b[^>]*data-template=["']omp-tech-doc-v1["']/i],
    ['document main', /<main\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*id=["']main["']/i],
    ['Contents sidebar', /<nav\b[^>]*class=["'][^"']*\btoc\b[^"']*["'][^>]*>[\s\S]*?<strong>Contents<\/strong>/i],
    ['how-it-works section', /id=["']how-it-works["']/i],
    ['diagrams section', /id=["']diagrams["']/i],
    ['user journey section', /id=["']user-journey["']/i],
    ['dated footer', /<footer\b[^>]*class=["'][^"']*\bfooter\b[^"']*["'][^>]*>[\s\S]*?Authored/i]
  ];
  for (const [label, pattern] of required) {
    if (!pattern.test(html)) throw new Error(`Tech-doc HTML is missing the ${label}`);
  }
  if (/<!--\s*(?:TOPIC|DOCUMENT TITLE|SMALL DESCRIPTION|Plain-language|State the main takeaway|Describe what the user sees|Initiating action|Important system transition|Final user-visible|Month DD, YYYY)\b/i.test(html)) {
    throw new Error('Tech-doc HTML still contains template placeholders');
  }
  if (!/<figure\b[^>]*class=["'][^"']*\bdiagram\b/i.test(html)) {
    throw new Error('Tech-doc HTML is missing a rendered diagram');
  }
  if (hasRawMermaidBlocks(html)) {
    throw new Error('Tech-doc HTML still contains raw Mermaid; render to inline SVG before saving');
  }
}

try {
  const source = path.resolve(readOption('--source'));
  const project = slugify(readOption('--project'), 'project');
  const topic = slugify(readOption('--topic'), 'technical-doc');
  const outputRoot = path.resolve(process.env.OMP_TECH_DOCS_DIR || path.join(os.homedir(), '.omp', 'tech-docs'));

  if (!fs.statSync(source).isFile()) throw new Error(`Source is not a regular file: ${source}`);
  const title = `Technical Doc: ${topic}`;
  const sourceHtml = setTitle(fs.readFileSync(source, 'utf8'), title);
  const html = finalizeHtml(sourceHtml, title, { planStyles: true });
  if (process.argv.includes('--canonical')) validateTemplate(html);

  const outputDirectory = path.join(outputRoot, project);
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const destination = nextAvailable(outputDirectory, `${localTimestamp()}-${topic}`);
  writeExclusive(destination, html);

  process.stdout.write(JSON.stringify({
    type: 'tech-doc-saved',
    project,
    topic,
    htmlPath: destination,
    bytes: fs.statSync(destination).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = 1;
}
