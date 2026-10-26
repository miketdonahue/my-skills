'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const skillDirectory = path.resolve(__dirname, '..');
const templatePath = path.join(skillDirectory, 'assets/template.html');
const scriptPath = path.join(skillDirectory, 'scripts/save-final-tech-doc.cjs');

test('tech-doc template keeps the minimal document contract and shared style hook', () => {
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /data-template="omp-tech-doc-v1"/);
  assert.match(template, /<style data-omp-plan-styles><\/style>/);
  assert.match(template, /<main class="content" id="main">/);
  assert.match(template, /<nav class="toc" aria-label="Technical document sections">/);
  assert.match(template, /<strong>Contents<\/strong>/);
  assert.match(template, /id="how-it-works"/);
  assert.match(template, /id="diagrams"/);
  assert.match(template, /id="user-journey"/);
  assert.match(template, /<pre class="mermaid" data-caption=/);
  assert.match(template, /<footer class="footer">Authored/);
  assert.equal(template.match(/<style\b/g).length, 1);
});

test('save-final-tech-doc renders Mermaid and saves only the HTML artifact', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-tech-doc-test-'));
  try {
    const sourcePath = path.join(temporaryDirectory, 'filled.html');
    const outputRoot = path.join(temporaryDirectory, 'tech-docs');
    const source = fs.readFileSync(templatePath, 'utf8')
      .replace('Technical Doc: <!-- TOPIC -->', 'Technical Doc: OAuth flow')
      .replace('<!-- DOCUMENT TITLE -->', 'How OAuth setup works')
      .replace('<!-- SMALL DESCRIPTION SUMMARY: what the feature does and who uses it -->', 'This explains how a user connects an account and receives a usable connection.')
      .replace('<!-- Plain-language explanation of the current behavior and its key boundary. -->', 'The setup route coordinates authorization, callback validation, and connection persistence.')
      .replace('<!-- State the main takeaway before the diagram. -->', 'The callback is the boundary where authorization becomes a stored connection.')
      .replace('<!-- Describe what the user sees while the system moves through the flow. -->', 'The user moves from starting setup to a success or recoverable failure state.')
      .replace('<!-- Initiating action and first observable response. -->', 'The user starts account setup and is sent to the provider.')
      .replace('<!-- Important system transition or decision. -->', 'The provider redirects back and the service validates the callback.')
      .replace('<!-- Final user-visible result, error, or retry behavior. -->', 'The user sees the connected account, or a clear error that allows retrying.')
      .replace('<!-- Month DD, YYYY -->', 'August 20, 2026');
    fs.writeFileSync(sourcePath, source, 'utf8');

    const stdout = execFileSync(process.execPath, [
      scriptPath,
      '--source', sourcePath,
      '--project', 'example-project',
      '--topic', 'oauth-flow',
      '--canonical'
    ], { encoding: 'utf8', env: { ...process.env, OMP_TECH_DOCS_DIR: outputRoot } });
    const result = JSON.parse(stdout);
    const html = fs.readFileSync(result.htmlPath, 'utf8');

    assert.equal(result.type, 'tech-doc-saved');
    assert.match(html, /data-template="omp-tech-doc-v1"/);
    assert.match(html, /data-omp-html-shared-styles/);
    assert.match(html, /data-omp-plan-styles/);
    assert.match(html, /data-omp-plan-nav/);
    assert.match(html, /data-omp-diagram-controls/);
    assert.match(html, /\.layout \{ max-width:1200px; margin:0 auto; padding:56px 32px 32px; display:grid; grid-template-columns:minmax\(0, 1fr\) 236px; gap:56px; \}/);
    assert.match(html, /\.toc \{ position:sticky; top:32px;/);
    assert.match(html, /\.content > \.doc-header:first-child \.section-label \{ margin-top:0; \}/);
    assert.match(html, /\.content > \.doc-header \+ \.section-label \{ margin-top:48px; \}/);
    assert.match(html, /<figure class="diagram mermaid-diagram"/);
    assert.doesNotMatch(html, /<pre class="mermaid"/);
    assert.doesNotMatch(html, /<!--\s*(?:TOPIC|DOCUMENT TITLE|SMALL DESCRIPTION|Month DD, YYYY)/);
    assert.match(html, /Authored August 20, 2026/);
    assert.equal(fs.readdirSync(path.join(outputRoot, 'example-project')).filter((name) => name.endsWith('.md')).length, 0);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
