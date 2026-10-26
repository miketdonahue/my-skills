'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  finalizeHtml,
  normalizeSharedThemeBlock,
  planHtmlStyles,
  sharedHtmlStyles,
  sharedThemeBlock,
  themeMermaidSvg
} = require('./html-document.cjs');

test('shared document styles and template theme blocks use the same generated tokens', () => {
  const shared = sharedThemeBlock();
  const styles = sharedHtmlStyles();

  assert.match(shared, /\/\* OMP_THEME_START \*\//);
  assert.match(shared, /--accent:#554dff;/);
  assert.match(shared, /--accent:#8b88ff;/);
  assert.match(shared, /--text-base:15px;/);
  assert.match(shared, /--text-2xs:13px;/);
  assert.match(styles, /data-omp-html-shared-styles/);
  assert.match(styles, /\/\* OMP_THEME_START \*\//);
  assert.match(styles, /--diagram-inverse-text:#0e0f14;/);
});

test('brainstorm template theme marker normalizes through the shared theme abstraction', () => {
  const templatePath = path.resolve(__dirname, '../skills/brainstorm/assets/template.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  const normalized = normalizeSharedThemeBlock(template);

  assert.match(template, /\/\* OMP_THEME_START \*\//);
  assert.match(normalized, /--font:ui-sans-serif, system-ui, -apple-system/);
  assert.match(normalized, /--diagram-shadow:rgba\(0,0,0,.55\);/);
  assert.doesNotMatch(normalized, /--bg: #fff/);
});

test('finalization refreshes stale shared style blocks', () => {
  const html = finalizeHtml([
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<style data-omp-html-shared-styles>/* OMP_THEME_START */:root{--accent:red}/* OMP_THEME_END */ th { text-transform:uppercase; font-size:12px; }</style>',
    '</head>',
    '<body><main><h1>Plan</h1><p>Plan Status: Final</p></main></body>',
    '</html>'
  ].join('\n'), 'Plan');

  assert.match(html, /\/\* OMP_THEME_START \*\//);
  assert.match(html, /--accent:#554dff;/);
  assert.doesNotMatch(html, /--accent:red/);
  assert.doesNotMatch(html, /th \{ text-transform:uppercase; font-size:12px; \}/);
  assert.match(html, /\n\s*th \{[^}]*font-size:var\(--text-2xs\);[^}]*letter-spacing:0;/);
});

test('finalization refreshes stale diagram controls so generated docs keep drag panning', () => {
  const html = finalizeHtml([
    '<!doctype html>',
    '<html lang="en">',
    '<head><title>Diagram</title></head>',
    '<body>',
    '<figure class="diagram mermaid-diagram">',
    '<div class="diagram-toolbar"><button data-diagram-zoom="in">+</button><span data-diagram-zoom-value>100%</span></div>',
    '<div class="mermaid-svg"><svg width="2000" height="800" viewBox="0 0 2000 800"></svg></div>',
    '</figure>',
    '<script data-omp-diagram-controls>(function () { var levels = [1]; }());</script>',
    '</body>',
    '</html>'
  ].join('\n'), 'Diagram');

  assert.equal(html.match(/data-omp-diagram-controls/g).length, 1);
  assert.match(html, /Pointer-drag panning on \.mermaid-svg containers/);
  assert.match(html, /setPointerCapture/);
  assert.match(html, /releasePointerCapture/);
  assert.doesNotMatch(html, /var levels = \[1\]/);
});

test('Mermaid SVG theming enforces the generated document minimum text size', () => {
  const themed = themeMermaidSvg([
    '<svg>',
    '<style>.small{font-size:12px}.large{font-size:18px}</style>',
    '<text font-size="11">Tiny</text>',
    '<text font-size="11px">Tiny px</text>',
    '</svg>'
  ].join(''), 1);

  assert.match(themed, /font-size:13px/);
  assert.match(themed, /font-size:18px/);
  assert.match(themed, /font-size="13"/);
  assert.match(themed, /font-size="13px"/);
  assert.doesNotMatch(themed, /font-size:12px/);
  assert.doesNotMatch(themed, /font-size="11/);
});

test('the write-plan template finalizes into the canonical plan layer', () => {
  const templatePath = path.resolve(__dirname, '../skills/write-plan/assets/template.html');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /<style data-omp-plan-styles><\/style>/);
  assert.equal(template.match(/<style\b/g).length, 1);
  assert.match(template, /<div class="layout">/);
  assert.match(template, /<main class="content" id="main">/);
  assert.match(template, /<nav class="toc" aria-label="Plan sections">/);
  assert.match(template, /<h3 id="task-1-short-imperative-title">/);
  assert.match(template, /<p class="plan-meta">Brainstorm: <a href="file:\/\//);
  // The brainstorm credit follows the title; the footer carries only the authored date.
  assert.ok(template.indexOf('<h1>') < template.indexOf('class="plan-meta"'));
  assert.match(template, /<footer class="footer">Authored /);
  assert.doesNotMatch(template, /Brainstorm source/);
  assert.doesNotMatch(template, /<li>Project:/);
  assert.doesNotMatch(template, /<li>Decision:/);
  assert.doesNotMatch(template, /Source brainstorm/);

  const html = finalizeHtml(
    template.replace(/<pre class="mermaid"[\s\S]*?<\/pre>/, '<p>diagram</p>'),
    'Implementation Plan: example',
    { planStyles: true, removeFinalPlanStatus: true }
  );

  assert.match(html, /data-omp-html-shared-styles/);
  assert.match(html, /data-omp-plan-nav/);
  assert.doesNotMatch(html, /<style data-omp-plan-styles><\/style>/);
  assert.doesNotMatch(html, /Plan Status:\s*Final/);

  const planStyleBlock = html.match(/<style data-omp-plan-styles>[\s\S]*?<\/style>/)[0];
  assert.equal(planStyleBlock, planHtmlStyles());
  // Plan rules stay scoped so they win regardless of style-block order in head.
  for (const selector of ['pre', 'table', 'th', 'td']) {
    assert.match(planStyleBlock, new RegExp(`\\.content ${selector} \\{`));
    assert.doesNotMatch(planStyleBlock, new RegExp(`\\n    ${selector} \\{`));
  }
  assert.doesNotMatch(planStyleBlock, /\n    code \{/);
});

test('brainstorm and plan documents share one inline code chip style', () => {
  const codeRule = /^\s*code \{[^}]*\}$/m;
  const preCodeRule = /^\s*pre code \{[^}]*\}$/m;
  const shared = sharedHtmlStyles();
  const template = fs.readFileSync(
    path.resolve(__dirname, '../skills/brainstorm/assets/template.html'),
    'utf8'
  );

  const sharedCode = shared.match(codeRule)[0].trim();
  const sharedPreCode = shared.match(preCodeRule)[0].trim();

  assert.match(sharedCode, /background:var\(--surface-strong\); color:var\(--text\);/);
  assert.match(sharedCode, /padding:2px 6px; border:0; border-radius:5px;/);
  assert.equal(template.match(codeRule)[0].trim(), sharedCode);
  assert.equal(template.match(preCodeRule)[0].trim(), sharedPreCode);
  // The plan layer inherits the chip instead of redefining it.
  assert.doesNotMatch(planHtmlStyles(), /\.content code \{/);
  assert.match(planHtmlStyles(), /\.content td code, \.content th code \{/);
});

test('generated document styles keep body text at least 13px and avoid forced uppercase outside section labels', () => {
  const shared = sharedHtmlStyles();
  const plan = planHtmlStyles();
  const combined = `${shared}\n${plan}`;

  assert.match(combined, /--text-2xs:13px;/);
  assert.doesNotMatch(combined, /font-size:12px/);
  assert.match(plan, /\.section-label \{[^}]*text-transform:uppercase;/);
  assert.doesNotMatch(plan, /\.content p:has\(> strong:only-child\) \{[^}]*text-transform:uppercase;/);
  assert.doesNotMatch(plan, /\.content th \{[^}]*text-transform:uppercase;/);
  assert.doesNotMatch(plan, /\.toc strong \{[^}]*text-transform:uppercase;/);
  assert.doesNotMatch(shared, /\nth \{[^}]*text-transform:uppercase;/);
});

test('generated document styles give direct tables vertical breathing room', () => {
  const shared = sharedHtmlStyles();
  const plan = planHtmlStyles();
  const template = fs.readFileSync(
    path.resolve(__dirname, '../skills/brainstorm/assets/template.html'),
    'utf8'
  );

  assert.match(shared, /\n\s*table \{[^}]*margin:20px 0 30px;/);
  assert.match(plan, /\.content table \{[^}]*margin:20px 0 30px;/);
  assert.match(plan, /\.content \.table-wrap table \{ margin:0; \}/);
  assert.match(template, /\n\s*table \{[^}]*margin:20px 0 30px;/);
});

test('generated step lists keep every item in a flexible full-width body column', () => {
  const shared = sharedHtmlStyles();
  const template = fs.readFileSync(
    path.resolve(__dirname, '../skills/brainstorm/assets/template.html'),
    'utf8'
  );

  for (const styles of [shared, template]) {
    assert.match(styles, /\.step \{[^}]*grid-template-columns:minmax\(30px, 30px\) minmax\(0, 1fr\);/);
    assert.match(styles, /\.step \{[^}]*width:100%;[^}]*min-width:0;/);
    assert.match(styles, /\.step-body \{[^}]*min-width:0;/);
  }
});

test('finalization rejects malformed step markup before saving a broken layout', () => {
  const malformed = [
    '<!doctype html>',
    '<html><head></head><body>',
    '<div class="steps">',
    '<div class="step"><div class="step-marker"><div class="step-number">4</div><div class="step-body"><h4>Broken step</h4><p>Body nested in marker.</p></div></div></div>',
    '</div>',
    '</body></html>'
  ].join('');

  assert.throws(
    () => finalizeHtml(malformed, 'Broken steps'),
    /malformed \.step markup/
  );
});
