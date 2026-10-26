'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.resolve(__dirname, '../scripts/save-final-plan.cjs');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('save-final-plan applies canonical plan visuals without replacing the plan layout', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-plan-test-'));
  try {
    const markdownSource = path.join(temporaryDirectory, 'plan.md');
    const htmlSource = path.join(temporaryDirectory, 'plan.html');
    const outputRoot = path.join(temporaryDirectory, 'plans');

    writeFile(markdownSource, [
      '# Example Plan',
      '',
      'Plan Status: Final',
      ''
    ].join('\n'));
    writeFile(htmlSource, [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<title>Old visual shell</title>',
      '<style>.topbar{position:sticky}.layout{display:grid;grid-template-columns:minmax(0,1fr) 250px}.content{box-shadow:0 14px 38px rgba(30,42,70,.08)}.content>p:nth-of-type(1){font-size:17px}.toc{position:sticky;top:78px}.toc a{font-weight:700}code{border:1px solid var(--border)}</style>',
      '<style data-omp-plan-styles>.toc{position:sticky;top:78px}.toc a{font-weight:700}</style>',
      '</head>',
      '<body>',
      '<a class="skip" href="#main">Skip to plan</a>',
      '<header class="topbar"><div class="topbar-inner"><div><span class="brand">OMP Implementation Plan</span> <span class="meta">project</span></div><button class="theme" id="theme-toggle" type="button">Theme</button></div></header>',
      '<div class="layout">',
      '<main class="content" id="main"><div class="status">Plan Status: Final</div><h1>Example Plan</h1><p>Plan Status: Final</p><h2 id="first">First section</h2><div class="table-wrap"><table><thead><tr><th>Column</th></tr></thead><tbody><tr><td><code>value</code></td></tr></tbody></table></div></main>',
      '<nav class="toc" aria-label="Plan sections"><strong>Contents</strong><a href="#first">First section</a></nav>',
      '</div>',
      '<script>(function(){var saved=localStorage.getItem("omp-plan-theme");if(saved==="dark")document.documentElement.classList.add("dark");}());</script>',
      '<script data-omp-html-theme>(function(){document.documentElement.classList.toggle("dark", false);}());</script>',
      '</body>',
      '</html>',
      ''
    ].join('\n'));

    const stdout = execFileSync(process.execPath, [
      script,
      '--mode', 'final',
      '--project', 'writer-monorepo',
      '--topic', 'example-plan',
      '--markdown-source', markdownSource,
      '--html-source', htmlSource
    ], {
      encoding: 'utf8',
      env: { ...process.env, OMP_PLANS_DIR: outputRoot }
    });
    const result = JSON.parse(stdout);
    const html = fs.readFileSync(result.htmlPath, 'utf8');

    assert.match(html, /data-omp-html-shared-styles/);
    assert.match(html, /data-omp-plan-styles/);
    assert.match(html, /\.layout \{ max-width:1200px; margin:0 auto; padding:56px 32px 32px; display:grid; grid-template-columns:minmax\(0, 1fr\) 236px; gap:56px; \}/);
    assert.match(html, /\.content \{ min-width:0; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; counter-reset:plan-task; \}/);
    assert.match(html, /\.toc \{ position:sticky; top:32px;[^}]*border-left:1px solid var\(--border\);[^}]*background:transparent; \}/);
    assert.match(html, /\.toc a\[aria-current="true"\] \{ border-left-color:var\(--accent\);/);
    assert.match(html, /a \{ color:var\(--accent\); \}/);
    assert.match(html, /\.toc a \{[^}]*font-weight:400;/);
    assert.match(html, /\.section-label \{ margin:88px 0 0; color:var\(--accent\);/);
    assert.match(html, /\.section-label \+ h2 \{ margin-top:4px; \}/);
    // Sections are separated by space and the accent number, never by a rule.
    assert.doesNotMatch(html, /\.content h2 \{[^}]*border-top/);
    assert.match(html, /\.content h3\[id\^="task-"\] \{ margin:76px 0 20px; padding:0; border:0;/);
    // Tasks and sections are both separated by space only.
    assert.doesNotMatch(html, /\.content h3\[id\^="task-"\] \{[^}]*border-top:/);
    assert.match(html, /\.content p:has\(> strong:only-child\) \{[^}]*font-size:var\(--text-sm\);/);
    assert.doesNotMatch(html, /\.content p:has\(> strong:only-child\) \{[^}]*text-transform:uppercase;/);
    assert.match(html, /\n    code \{ padding:2px 6px; border:0; border-radius:5px; background:var\(--surface-strong\);/);
    assert.match(html, /\.content td code, \.content th code \{/);
    assert.match(html, /\.content table \{ display:table; width:100%; max-width:none; margin:20px 0 30px; border-collapse:collapse; table-layout:auto;/);
    assert.match(html, /\.content \.table-wrap table \{ margin:0; \}/);
    assert.match(html, /\.content tbody tr:nth-child\(even\) td \{ background:var\(--surface\); \}/);
    assert.match(html, /\.content \.plan-meta \{[^}]*font-size:var\(--text-sm\); line-height:var\(--leading-sm\); font-weight:400; \}/);
    assert.match(html, /\.content \.plan-meta a \{ color:var\(--muted\); border-bottom:1px solid transparent;/);
    assert.doesNotMatch(html, /plan-meta-date|plan-meta-source/);
    assert.doesNotMatch(html, /\.content > ul:first-of-type/);
    assert.match(html, /data-omp-plan-nav/);
    assert.doesNotMatch(html, /\.content \{ padding:34px; \}/);
    assert.doesNotMatch(html, /\.content \{ padding:24px 18px; \}/);
    assert.doesNotMatch(html, /\.content>p:nth-of-type/);
    assert.doesNotMatch(html, /code\{border:1px solid var\(--border\)\}/);
    assert.doesNotMatch(html, /<header\b[^>]*class="topbar"/);
    assert.doesNotMatch(html, /<div\b[^>]*class="status"/);
    assert.doesNotMatch(html, /Plan Status:\s*Final/);
    assert.doesNotMatch(html, /localStorage\.getItem\("omp-plan-theme"\)/);
    assert.doesNotMatch(html, /id="theme-toggle"/);
    assert.match(html, /data-omp-html-theme/);
    assert.match(html, /prefers-color-scheme: dark/);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
