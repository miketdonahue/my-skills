#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
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
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join('');
}

function writeNextAvailable(directory, baseName, content) {
  let candidate = path.join(directory, baseName);
  let suffix = 2;
  for (;;) {
    try {
      const fd = fs.openSync(candidate, 'wx', 0o600);
      try { fs.writeFileSync(fd, content, 'utf8'); } finally { fs.closeSync(fd); }
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      candidate = path.join(directory, baseName.replace(/\.html$/, '') + `-${suffix}.html`);
      suffix += 1;
    }
  }
}

function visibleStatus(html) {
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/(?:&apos;|&#39;)/gi, "'");
  const statuses = [...visible.matchAll(/Status:\s*(Aligned|Stalemate)/gi)].map((match) => {
    return match[1].toLowerCase() === 'aligned' ? 'Aligned' : 'Stalemate';
  });
  if (statuses.length === 0) return null;
  if (new Set(statuses).size !== 1) throw new Error('Final brainstorm contains conflicting status values');
  return statuses[0];
}

function validateCanonicalTemplate(html) {
  const required = [
    ['canonical template marker', /<html\b[^>]*data-template=["']omp-brainstorm-v2["']/i],
    ['decision hero', /data-section=["']decision["']/i],
    ['options section', /data-section=["']options["']/i],
    ['evidence section', /data-section=["']evidence["']/i],
    ['comparison table', /<table\b/i],
    ['expandable details', /<details\b/i],
  ];
  for (const [label, pattern] of required) {
    if (!pattern.test(html)) throw new Error(`Brainstorm HTML is missing the ${label}`);
  }
  if (/<!--\s*(?:TITLE|PROJECT|DATE|RECOMMENDATION|OPTION NAME|ONE-SENTENCE|COMPARISON ROWS|RISK ROWS|DIAGRAMS|OPTIONAL INLINE SVG DIAGRAMS)\b/i.test(html)) {
    throw new Error('Brainstorm HTML still contains canonical template placeholders');
  }
  if (hasRawMermaidBlocks(html)) {
    throw new Error('Brainstorm HTML still contains raw Mermaid; render to inline SVG before saving');
  }
}

try {
  const source = path.resolve(readOption('--source'));
  const project = slugify(readOption('--project'), 'project');
  const topic = slugify(readOption('--topic'), 'brainstorm');
  const outputRoot = path.resolve(
    process.env.OMP_BRAINSTORMS_DIR || path.join(os.homedir(), '.omp', 'brainstorms')
  );

  if (!fs.statSync(source).isFile()) {
    throw new Error(`Source is not a regular file: ${source}`);
  }

  const outputDirectory = path.join(outputRoot, project);
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

  const title = `Brainstorm: ${topic}`;
  const html = finalizeHtml(fs.readFileSync(source, 'utf8'), title);
  if (process.argv.includes('--canonical')) validateCanonicalTemplate(html);
  const status = visibleStatus(html);
  const baseName = `${localTimestamp()}-${topic}.html`;
  const destination = writeNextAvailable(outputDirectory, baseName, html);

  process.stdout.write(JSON.stringify({
    type: 'brainstorm-saved',
    path: destination,
    project,
    topic
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = 1;
}
