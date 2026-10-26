'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtml(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/(?:&apos;|&#39;)/gi, "'")
    .replace(/&amp;/gi, '&');
}

function htmlAttr(attributes, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const match = String(attributes || '').match(pattern);
  return match ? decodeHtml(match[2]).trim() : '';
}

function hasMermaidClass(attributes) {
  const className = htmlAttr(attributes, 'class');
  return className.split(/\s+/).includes('mermaid');
}

function hasRawMermaidBlocks(html) {
  let found = false;
  html.replace(/<pre\b([^>]*)>[\s\S]*?<\/pre>/gi, (_match, attributes) => {
    if (hasMermaidClass(attributes)) found = true;
    return '';
  });
  return found;
}

function validateStepMarkup(html) {
  const source = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const stack = [];
  const divPattern = /<\/?div\b[^>]*>/gi;
  let match;
  const rejectMalformedStep = () => {
    throw new Error('HTML contains malformed .step markup; each .step must have one direct .step-marker and one direct .step-body');
  };

  while ((match = divPattern.exec(source))) {
    if (/^<\s*\//.test(match[0])) {
      const entry = stack.pop();
      if (!entry || !entry.classes.has('step')) continue;

      const markers = entry.directChildren.filter((child) => child.classes.has('step-marker'));
      const bodies = entry.directChildren.filter((child) => child.classes.has('step-body'));
      if (!entry.parent || !entry.parent.classes.has('steps') || markers.length !== 1 || bodies.length !== 1) {
        rejectMalformedStep();
      }
      continue;
    }

    const attributes = match[0].replace(/^<\s*div\b/i, '').replace(/>\s*$/, '');
    const classes = new Set(htmlAttr(attributes, 'class').split(/\s+/).filter(Boolean));
    const entry = { classes, parent: stack[stack.length - 1] || null, directChildren: [] };
    if (entry.parent) entry.parent.directChildren.push(entry);
    stack.push(entry);
  }

  if (stack.some((entry) => entry.classes.has('step'))) rejectMalformedStep();
}

function findExecutable(name) {
  const result = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function findOmpChrome() {
  const root = path.join(os.homedir(), '.omp', 'puppeteer', 'chrome');
  if (!fs.existsSync(root)) return '';
  const result = spawnSync('find', [
    root,
    '-path',
    '*Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '-type',
    'f',
    '-print',
    '-quit'
  ], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function chromeExecutable() {
  return firstExisting([
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    findOmpChrome(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
  ]);
}

function mermaidConfig() {
  return {
    theme: 'base',
    themeVariables: {
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      primaryColor: '#f0efff',
      primaryBorderColor: '#9a85ff',
      primaryTextColor: '#15151a',
      lineColor: '#725cff',
      secondaryColor: '#fff7bf',
      tertiaryColor: '#ffffff',
      actorBkg: '#f0efff',
      actorBorder: '#9a85ff',
      actorTextColor: '#15151a',
      noteBkgColor: '#fff7bf',
      noteBorderColor: '#d6c343',
      noteTextColor: '#15151a',
      activationBkgColor: '#ecebff',
      activationBorderColor: '#725cff',
      sequenceNumberColor: '#ffffff'
    },
    sequence: {
      mirrorActors: true,
      messageAlign: 'center',
      useMaxWidth: false,
      wrap: false
    },
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true
    }
  };
}

function runMermaidCli(input, output, config, puppeteerConfig) {
  const cli = process.env.MERMAID_CLI || findExecutable('mmdc');
  const args = [
    '-i', input,
    '-o', output,
    '-c', config,
    '-p', puppeteerConfig,
    '-b', 'transparent'
  ];
  const command = cli || 'npx';
  const finalArgs = cli ? args : ['--yes', '@mermaid-js/mermaid-cli', ...args];
  const result = spawnSync(command, finalArgs, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || ''}`.trim().slice(-1800);
    throw new Error(`Mermaid render failed with exit ${result.status}: ${detail}`);
  }
}

function renderMermaid(source, index) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-mermaid-'));
  try {
    const input = path.join(temporaryDirectory, `diagram-${index}.mmd`);
    const output = path.join(temporaryDirectory, `diagram-${index}.svg`);
    const config = path.join(temporaryDirectory, 'mermaid-config.json');
    const puppeteerConfig = path.join(temporaryDirectory, 'puppeteer-config.json');
    fs.writeFileSync(input, `${source.trim()}\n`, 'utf8');
    fs.writeFileSync(config, `${JSON.stringify(mermaidConfig(), null, 2)}\n`, 'utf8');
    const executablePath = chromeExecutable();
    fs.writeFileSync(puppeteerConfig, `${JSON.stringify({
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }, null, 2)}\n`, 'utf8');
    runMermaidCli(input, output, config, puppeteerConfig);
    return themeMermaidSvg(fs.readFileSync(output, 'utf8'), index)
      .replace(/<\?xml[\s\S]*?\?>\s*/i, '')
      .replace(/<!DOCTYPE[\s\S]*?>\s*/i, '')
      .trim();
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function themeMermaidSvg(svg, index) {
  const colorMap = new Map([
    ['#15151a', 'var(--diagram-text)'],
    ['#000000', 'var(--diagram-text)'],
    ['#ffffff', 'var(--diagram-inverse-text)'],
    ['#f0efff', 'var(--diagram-node)'],
    ['#ecebff', 'var(--accent-soft)'],
    ['#edf2ae', 'var(--diagram-note)'],
    ['#eaeaea', 'var(--diagram-node)'],
    ['#9a85ff', 'var(--diagram-node-border)'],
    ['#666', 'var(--diagram-node-border)'],
    ['#666666', 'var(--diagram-node-border)'],
    ['#999', 'var(--diagram-lane)'],
    ['#999999', 'var(--diagram-lane)'],
    ['#725cff', 'var(--diagram-accent)'],
    ['#fff7bf', 'var(--diagram-note)'],
    ['#d6c343', 'var(--diagram-note-border)']
  ]);
  let themed = svg.replace(/\bmy-svg\b/g, `omp-mermaid-${index}`);
  for (const [from, to] of colorMap) {
    themed = themed.replace(new RegExp(escapeRegExp(from), 'gi'), to);
  }
  const rgbColorMap = new Map([
    ['240,239,255', 'var(--diagram-node)'],
    ['236,235,255', 'var(--accent-soft)'],
    ['237,242,174', 'var(--diagram-note)'],
    ['255,247,191', 'var(--diagram-note)'],
    ['214,195,67', 'var(--diagram-note-border)'],
    ['255,255,255', 'var(--diagram-inverse-text)']
  ]);
  themed = themed.replace(/rgb\(\s*(\d+)\s*(?:,\s*|\s+)(\d+)\s*(?:,\s*|\s+)(\d+)\s*\)/gi, (match, red, green, blue) => {
    return rgbColorMap.get(`${red},${green},${blue}`) || match;
  });
  return themed
    .replace(/(font-size\s*:\s*)(\d+(?:\.\d+)?)px/gi, (_match, prefix, size) => {
      return Number(size) < 13 ? `${prefix}13px` : `${prefix}${size}px`;
    })
    .replace(/(font-size=["'])(\d+(?:\.\d+)?)(px)?(["'])/gi, (_match, prefix, size, unit, suffix) => {
      return Number(size) < 13 ? `${prefix}13${unit || ''}${suffix}` : `${prefix}${size}${unit || ''}${suffix}`;
    })
    .replace(/\b(fill|stroke):black\b/gi, '$1:var(--diagram-text)')
    .replace(/\b(fill|stroke)="black"/gi, '$1="var(--diagram-text)"')
    .replace(/\b(fill|stroke):white\b/gi, '$1:var(--diagram-inverse-text)')
    .replace(/\b(fill|stroke)="white"/gi, '$1="var(--diagram-inverse-text)"')
    .replace(/rgba\(185,\s*185,\s*185,\s*1\)/gi, 'var(--diagram-shadow)');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mermaidFigure(svg, source, caption) {
  const figcaption = caption || 'Rendered Mermaid diagram.';
  return `<figure class="diagram mermaid-diagram" data-diagram="mermaid">
  <div class="diagram-toolbar" aria-label="Diagram controls">
    <button type="button" data-diagram-zoom="out" aria-label="Zoom out">-</button>
    <button type="button" data-diagram-zoom="fit">Fit</button>
    <button type="button" data-diagram-zoom="in" aria-label="Zoom in">+</button>
    <span data-diagram-zoom-value>100%</span>
  </div>
  <div class="mermaid-svg">${svg}</div>
  <figcaption>${escapeHtml(figcaption)}</figcaption>
  <details class="diagram-source"><summary>Source</summary><div class="details-body"><pre><code>${escapeHtml(source.trim())}</code></pre></div></details>
</figure>`;
}

function renderMermaidBlocks(html) {
  let index = 0;
  return html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (match, attributes, body) => {
    if (!hasMermaidClass(attributes)) return match;
    const source = decodeHtml(body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
    if (!source) throw new Error('Mermaid block is empty');
    const caption = htmlAttr(attributes, 'data-caption');
    index += 1;
    return mermaidFigure(renderMermaid(source, index), source, caption);
  });
}

function themeInlineMermaidSvgs(html) {
  let index = 0;
  return html.replace(/(<div\b[^>]*class=["'][^"']*\bmermaid-svg\b[^"']*["'][^>]*>)([\s\S]*?)(<\/div>)/gi, (match, open, body, close) => {
    if (!/<svg\b/i.test(body)) return match;
    index += 1;
    return `${open}${themeMermaidSvg(body, index)}${close}`;
  });
}

const sharedThemeTokens = {
  light: {
    'color-scheme': 'light dark',
    '--font': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    '--mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    '--bg': '#fff',
    '--surface': '#f7f7fb',
    '--surface-strong': '#f0efff',
    '--text': '#15151a',
    '--muted': '#5f606b',
    '--subtle': '#696a75',
    '--border': '#e1e2e8',
    '--accent': '#554dff',
    '--accent-soft': '#ecebff',
    '--good': '#067554',
    '--good-soft': '#dff8ee',
    '--warn': '#a85400',
    '--warn-soft': '#fff0d9',
    '--bad': '#b42318',
    '--bad-soft': '#ffe4e1',
    '--radius': '12px',
    '--code-bg': '#f7f7fb',
    '--code-text': '#15151a',
    '--code-border': '#e1e2e8',
    '--diagram-bg': '#fff',
    '--diagram-text': '#15151a',
    '--diagram-node': '#f0efff',
    '--diagram-node-border': '#9a85ff',
    '--diagram-lane': '#9a85ff',
    '--diagram-edge': '#15151a',
    '--diagram-accent': '#725cff',
    '--diagram-note': '#fff7bf',
    '--diagram-note-border': '#d6c343',
    '--diagram-inverse-text': '#fff',
    '--diagram-shadow': 'rgba(185,185,185,1)',
    '--text-2xs': '13px',
    '--text-xs': '14px',
    '--text-sm': '14px',
    '--text-base': '15px',
    '--text-lg': '16px',
    '--text-xl': '18px',
    '--text-2xl': '20px',
    '--text-3xl': '24px',
    '--text-4xl': '30px',
    '--text-5xl': '36px',
    '--leading-2xs': '18px',
    '--leading-xs': '22px',
    '--leading-sm': '22px',
    '--leading-base': '24px',
    '--leading-lg': '24px',
    '--leading-xl': '28px',
    '--leading-2xl': '28px',
    '--leading-3xl': '32px',
    '--leading-4xl': '36px'
  },
  dark: {
    '--bg': '#0e0f14',
    '--surface': '#191b24',
    '--surface-strong': '#222247',
    '--text': '#f6f7fb',
    '--muted': '#c0c2ce',
    '--subtle': '#8f93a5',
    '--border': '#303443',
    '--accent': '#8b88ff',
    '--accent-soft': '#25244f',
    '--good': '#54d6a5',
    '--good-soft': '#173b31',
    '--warn': '#ffbd6e',
    '--warn-soft': '#3d2b16',
    '--bad': '#ff8b83',
    '--bad-soft': '#42201e',
    '--code-bg': '#151526',
    '--code-text': '#f6f7fb',
    '--code-border': '#303443',
    '--diagram-bg': '#111218',
    '--diagram-text': '#f6f7fb',
    '--diagram-node': '#25244f',
    '--diagram-node-border': '#8b88ff',
    '--diagram-lane': '#8b88ff',
    '--diagram-edge': '#f6f7fb',
    '--diagram-accent': '#9d9aff',
    '--diagram-note': '#3d2b16',
    '--diagram-note-border': '#ffbd6e',
    '--diagram-inverse-text': '#0e0f14',
    '--diagram-shadow': 'rgba(0,0,0,.55)'
  }
};

function cssDeclarationBlock(selector, declarations, indent = '    ') {
  const body = Object.entries(declarations)
    .map(([name, value]) => `${indent}  ${name}:${value};`)
    .join('\n');
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

function sharedThemeCss(indent = '    ') {
  return [
    cssDeclarationBlock(':root', sharedThemeTokens.light, indent),
    cssDeclarationBlock('html.dark', sharedThemeTokens.dark, indent)
  ].join('\n');
}

function sharedThemeBlock(indent = '    ') {
  return [
    `${indent}/* OMP_THEME_START */`,
    sharedThemeCss(indent),
    `${indent}/* OMP_THEME_END */`
  ].join('\n');
}

function normalizeSharedThemeBlock(html) {
  return html.replace(
    /([ \t]*)\/\* OMP_THEME_START \*\/[\s\S]*?\/\* OMP_THEME_END \*\//g,
    (_match, indent) => sharedThemeBlock(indent)
  );
}

function sharedHtmlStyles() {
  return `<style data-omp-html-shared-styles>
${sharedThemeBlock()}
    html { font-size:var(--text-base); scroll-behavior:smooth; }
    body { background:var(--bg); color:var(--text); font-family:var(--font); font-size:var(--text-base); line-height:var(--leading-base); }
    code { padding:2px 6px; border:0; border-radius:5px; background:var(--surface-strong); color:var(--text); font-family:var(--mono); font-size:var(--text-sm); line-height:var(--leading-2xs); overflow-wrap:anywhere; }
    pre { overflow:auto; margin:16px 0; padding:18px; border:1px solid var(--code-border); border-radius:var(--radius); background:var(--code-bg); color:var(--code-text); font-family:var(--mono); font-size:13px; line-height:20px; }
    pre code { padding:0; border:0; border-radius:0; background:transparent; color:inherit; font:inherit; overflow-wrap:normal; }
    table { width:100%; margin:20px 0 30px; border-collapse:collapse; font-size:var(--text-sm); line-height:var(--leading-sm); }
    th { padding:13px 14px; color:var(--subtle); font-size:var(--text-2xs); line-height:var(--leading-2xs); letter-spacing:0; text-align:left; border-bottom:1px solid var(--border); }
    td { padding:14px; color:var(--muted); vertical-align:top; border-bottom:1px solid var(--border); }
    tr:last-child td { border-bottom:0; } tr:hover td { background:var(--surface); }
    .steps { display:flex; flex-direction:column; gap:0; min-width:0; }
    .step { display:grid; grid-template-columns:minmax(30px, 30px) minmax(0, 1fr); gap:16px; width:100%; min-width:0; align-items:start; }
    .step-marker { display:flex; flex-direction:column; align-items:center; min-width:0; }
    .step-body { min-width:0; }
    svg { max-width:100%; height:auto; }
    .diagram { margin:24px 0; padding:0; overflow:hidden; border:1px solid var(--border); border-radius:var(--radius); background:linear-gradient(180deg, var(--surface), var(--bg)); }
    .diagram svg { display:block; width:100%; min-width:0; max-width:none; height:auto; }
    .diagram figcaption { padding:10px 18px 0; color:var(--muted); font-size:var(--text-sm); line-height:var(--leading-sm); }
    .mermaid-diagram { --diagram-zoom:1; background:var(--diagram-bg); }
    .diagram-toolbar { display:flex; align-items:center; gap:6px; padding:10px 12px; border-bottom:1px solid var(--border); background:var(--surface); }
    .diagram-toolbar button { min-width:30px; height:28px; padding:0 9px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); cursor:pointer; font:700 var(--text-xs)/1 var(--font); }
    .diagram-toolbar button:hover { border-color:var(--accent); color:var(--accent); background:var(--accent-soft); }
    .diagram-toolbar span { margin-left:2px; color:var(--muted); font-size:var(--text-xs); line-height:var(--leading-xs); font-weight:700; }
    .mermaid-diagram .mermaid-svg { max-width:100%; min-width:0; max-height:72vh; padding:18px; overflow:auto; overscroll-behavior:contain; touch-action:none; cursor:grab; }
    .mermaid-diagram .mermaid-svg.is-dragging { cursor:grabbing; user-select:none; }
    .mermaid-diagram .mermaid-svg svg { width:calc(100% * var(--diagram-zoom)); min-width:0; margin:0 auto; max-width:none; color:var(--diagram-text); background:transparent !important; }
    .mermaid-diagram .mermaid-svg svg rect.rect { fill:var(--diagram-node) !important; }
    .mermaid-diagram .mermaid-svg svg rect.note { fill:var(--diagram-note) !important; }
    .mermaid-diagram .mermaid-svg svg .activation0, .mermaid-diagram .mermaid-svg svg .activation1, .mermaid-diagram .mermaid-svg svg .activation2 { fill:var(--accent-soft) !important; }
    .mermaid-diagram details { margin:14px 18px 18px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); }
    .mermaid-diagram summary { padding:12px 16px; cursor:pointer; font-weight:700; }
    .mermaid-diagram .details-body { padding:0 16px 16px; color:var(--muted); }
    .mermaid-diagram pre { max-height:45vh; margin:0; border:0; border-radius:0; background:transparent; color:var(--code-text); white-space:pre; }
    @media (max-width:760px) {
      .mermaid-diagram .mermaid-svg { max-height:68vh; }
    }
  </style>`;
}

function planHtmlStyles() {
  return `<style data-omp-plan-styles>
    *, *::before, *::after { box-sizing:border-box; }
    html { font-size:var(--text-base); scroll-behavior:smooth; }
    body { margin:0; max-width:none; padding:0; background:var(--bg); color:var(--text); font-family:var(--font); font-size:var(--text-base); line-height:var(--leading-base); }
    a { color:var(--accent); }
    button { font:inherit; }
    .skip { position:absolute; left:-9999px; }
    .skip:focus { left:12px; top:12px; z-index:40; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); }

    /* Reading shell: one measured content column plus a contents rail. */
    .layout { max-width:1200px; margin:0 auto; padding:56px 32px 32px; display:grid; grid-template-columns:minmax(0, 1fr) 236px; gap:56px; }
    .layout > * { min-width:0; }
    .content { min-width:0; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; counter-reset:plan-task; }
    .footer { max-width:1200px; margin:0 auto; padding:22px 32px 56px; color:var(--muted); font-size:var(--text-sm); line-height:var(--leading-sm); }

    /* Contents rail */
    .toc { position:sticky; top:32px; align-self:start; max-width:100%; max-height:calc(100vh - 64px); overflow:auto; padding:6px 0 2px; border:0; border-left:1px solid var(--border); border-radius:0; background:transparent; }
    .toc strong { display:block; margin:0 0 12px 17px; color:var(--accent); font-size:var(--text-2xs); line-height:var(--leading-2xs); font-weight:800; letter-spacing:0; }
    .toc a { display:block; max-width:100%; margin-left:-1px; padding:10px 0 10px 16px; border-left:2px solid transparent; color:var(--muted); font-size:var(--text-sm); line-height:var(--leading-sm); font-weight:400; text-decoration:none; overflow-wrap:anywhere; }
    .toc a:hover { border-left-color:var(--border); color:var(--accent); }
    .toc a[aria-current="true"] { border-left-color:var(--accent); color:var(--text); font-weight:700; }

    /* Heading scale: section-label divs provide numbered eyebrows (e.g. "01 · Decision"). */
    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 { color:var(--text); letter-spacing:0; }
    .content h1 { max-width:30ch; margin:0 0 12px; font-size:var(--text-5xl); line-height:1.05; text-wrap:balance; }
    .section-label { margin:88px 0 0; color:var(--accent); font-size:var(--text-2xs); line-height:var(--leading-2xs); font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    .content > .section-label:first-of-type { margin-top:0; }
    .content > .doc-header:first-child .section-label { margin-top:0; }
    .content > .doc-header + .section-label { margin-top:48px; }
    .section-label + h1 { margin-top:6px; }
    .content h2 { margin:88px 0 20px; font-size:var(--text-3xl); line-height:var(--leading-3xl); scroll-margin-top:28px; text-wrap:balance; }
    .content .section-label + h2 { margin-top:4px; }
    .content h3 { margin:36px 0 12px; font-size:var(--text-2xl); line-height:var(--leading-2xl); scroll-margin-top:28px; }
    .content h4 { margin:26px 0 8px; font-size:var(--text-lg); line-height:var(--leading-lg); }
    .content h5 { margin:22px 0 6px; font-size:var(--text-base); line-height:var(--leading-base); }
    .content h6 { margin:20px 0 6px; color:var(--subtle); font-size:var(--text-sm); line-height:var(--leading-sm); }
    .content h2 + h3, .content h3 + h4, .content h4 + h5 { margin-top:18px; }

    /* Body copy */
    .content p { max-width:72ch; margin:0 0 16px; }
    .content strong { color:var(--text); font-weight:700; }
    .content ul, .content ol { max-width:76ch; margin:14px 0 20px; padding-left:22px; }
    .content li { margin:8px 0; }
    .content li::marker { color:var(--subtle); }
    .content li > ul, .content li > ol { margin:8px 0 6px; }
    .content li > p { margin:0 0 8px; }

    /* Source line: quiet brainstorm credit directly under the title. */
    .content .plan-meta { max-width:none; margin:0; color:var(--subtle); font-size:var(--text-sm); line-height:var(--leading-sm); font-weight:400; }
    .content .plan-meta a { color:var(--muted); border-bottom:1px solid transparent; text-decoration:none; overflow-wrap:anywhere; }
    .content .plan-meta a:hover { color:var(--accent); border-bottom-color:var(--accent); }

    /* Inline label paragraphs ("Create/modify", "Tests", "Commands") become micro labels. */
    .content p:has(> strong:only-child) { margin:30px 0 8px; color:var(--muted); font-size:var(--text-sm); line-height:var(--leading-sm); letter-spacing:0; }
    .content p:has(> strong:only-child) strong { color:inherit; font-weight:800; }

    /* Task boundaries: space alone separates tasks, no rules. */
    .content h3[id^="task-"] { margin:76px 0 20px; padding:0; border:0; background:transparent; font-size:var(--text-2xl); line-height:var(--leading-2xl); scroll-margin-top:28px; }
    .content h2 + h3[id^="task-"] { margin-top:32px; }
    .content h3[id^="task-"] + p, .content h3[id^="task-"] + ul, .content h3[id^="task-"] + ol { margin-top:14px; }

    /* Code: the inline chip comes from the shared layer; only block spacing is plan-specific. */
    .content pre { margin:18px 0 26px; padding:18px 20px; overflow:auto; scrollbar-width:thin; scrollbar-color:var(--border) transparent; border:1px solid var(--code-border); border-radius:var(--radius); background:var(--code-bg); color:var(--code-text); font-family:var(--mono); font-size:13px; line-height:20px; tab-size:2; }
    .content pre code { padding:0; border:0; border-radius:0; background:transparent; color:inherit; font:inherit; overflow-wrap:normal; }
    .content h4 + pre, .content p + pre, .content p:has(> strong:only-child) + pre { margin-top:12px; }

    /* Tables: full-width, scannable, no forced horizontal scroll on desktop. */
    .content .table-wrap { margin:20px 0 30px; overflow:auto; overscroll-behavior-x:contain; scrollbar-width:thin; scrollbar-color:var(--border) transparent; border:1px solid var(--border); border-radius:var(--radius); background:var(--bg); }
    .content table { display:table; width:100%; max-width:none; margin:20px 0 30px; border-collapse:collapse; table-layout:auto; font-size:var(--text-base); line-height:var(--leading-base); }
    .content .table-wrap table { margin:0; }
    .content th { padding:12px 16px; color:var(--muted); font-size:var(--text-2xs); line-height:var(--leading-2xs); font-weight:800; letter-spacing:0; text-align:left; background:var(--surface-strong); border-bottom:1px solid var(--border); }
    .content td { padding:14px 16px; color:var(--muted); vertical-align:top; border-bottom:1px solid var(--border); }
    .content td + td, .content th + th { border-left:1px solid var(--border); }
    .content tbody tr:nth-child(even) td { background:var(--surface); }
    .content tbody tr:last-child td { border-bottom:0; }
    .content tbody tr:hover td { background:var(--surface-strong); }
    .content td:first-child { color:var(--text); font-weight:500; }
    .content td code, .content th code { padding:0; border-radius:0; background:transparent; color:inherit; font-size:var(--text-sm); }
    .content td p, .content td ul, .content td ol { max-width:none; }
    .content td ul, .content td ol { margin:6px 0; padding-left:18px; }
    .content td > :last-child { margin-bottom:0; }

    /* Emphasis blocks */
    .content blockquote { max-width:76ch; margin:24px 0; padding:18px 22px; border-left:3px solid var(--accent); border-radius:0 var(--radius) var(--radius) 0; background:var(--surface); color:var(--text); }
    .content blockquote > :last-child { margin-bottom:0; }
    .content details { margin:18px 0; overflow:hidden; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); }
    .content details[open] { border-color:var(--accent); }
    .content summary { display:flex; align-items:center; gap:10px; padding:14px 18px; cursor:pointer; font-size:var(--text-sm); line-height:var(--leading-sm); font-weight:700; list-style:none; }
    .content summary::-webkit-details-marker { display:none; }
    .content summary::before { content:"+"; color:var(--accent); font-size:var(--text-lg); line-height:1; }
    .content details[open] summary::before { content:"-"; }
    .content .details-body { padding:0 20px 20px; color:var(--muted); }

    /* Embedded documents use article rhythm, not page-level section spacing. */
    .content .details-body { font-size:var(--text-base); line-height:1.65; }
    .content .details-body p { max-width:70ch; margin:0 0 16px; overflow-wrap:anywhere; }
    .content .details-body h1 { max-width:none; margin:24px 0 16px; font-size:var(--text-2xl); line-height:1.3; }
    .content .details-body h2 { margin:28px 0 12px; font-size:var(--text-xl); line-height:1.35; }
    .content .details-body h3, .content .details-body h3[id^="task-"] { margin:24px 0 10px; font-size:var(--text-lg); line-height:1.4; }
    .content .details-body h4, .content .details-body h5, .content .details-body h6 { margin:20px 0 8px; font-size:var(--text-base); line-height:1.5; }
    .content .details-body ul, .content .details-body ol { max-width:72ch; margin:12px 0 18px; padding-left:24px; }
    .content .details-body li { margin:6px 0; overflow-wrap:anywhere; }
    .content .details-body li > p { margin:0 0 6px; }
    .content .details-body li > ul, .content .details-body li > ol { margin:6px 0; }
    .content .details-body p:has(> strong:only-child) { margin:20px 0 8px; font-size:var(--text-base); line-height:1.5; }
    .content .details-body pre, .content .details-body .table-wrap { margin:16px 0 24px; }
    .content .details-body blockquote { margin:20px 0; }
    .content .details-body .description-meta { max-width:none; margin:0 0 16px; color:var(--subtle); font-size:var(--text-sm); line-height:1.5; }
    .content .details-body .description-meta code { padding:0; border:0; background:transparent; color:inherit; font-size:inherit; overflow-wrap:anywhere; }
    .content .details-body > :first-child { margin-top:0; }
    .content .details-body > :last-child { margin-bottom:0; }
    .content hr { margin:44px 0; border:0; border-top:1px solid var(--border); }
    .content small, .content figcaption { font-size:var(--text-sm); line-height:var(--leading-sm); }

    /* Diagrams keep the shared figure treatment. */
    .content .diagram { margin:24px 0 30px; }
    .content .mermaid-diagram details { margin:14px 18px 18px; }
    .content .mermaid-diagram pre { max-height:45vh; margin:0; padding:18px; overflow:auto; border:0; border-radius:0; background:transparent; color:var(--code-text); white-space:pre; }

    @media (max-width:1100px) {
      .layout { grid-template-columns:minmax(0, 1fr) 208px; gap:40px; padding-left:24px; padding-right:24px; }
      .footer { padding-left:24px; padding-right:24px; }
    }
    @media (max-width:940px) {
      .layout { grid-template-columns:1fr; gap:28px; padding-top:40px; }
      .toc { position:relative; top:auto; order:-1; display:flex; flex-wrap:wrap; gap:8px; max-height:none; padding:16px 18px; border:1px solid var(--border); border-radius:var(--radius); }
      .toc strong { flex:0 0 100%; margin:0 0 2px; }
      .toc a { margin:0; padding:10px 12px; border:1px solid var(--border); border-radius:999px; font-weight:700; }
      .toc a:hover, .toc a[aria-current="true"] { border-color:var(--accent); background:var(--accent-soft); }
    }
    @media (max-width:760px) {
      .layout { padding:24px 18px 24px; }
      .footer { padding:20px 18px 48px; }
      .content h1 { max-width:none; font-size:var(--text-4xl); line-height:var(--leading-4xl); }
      .section-label { margin:48px 0 0; }
      .content h2 { margin-top:48px; }
      .content h3[id^="task-"] { margin-top:48px; }
      .content blockquote { max-width:none; }
      .content summary { padding:12px 14px; }
      .content table { min-width:560px; }
      .content th, .content td { padding:12px; }
      .content td code { overflow-wrap:anywhere; word-break:break-word; }
    }
    @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
    @media print {
      .toc, .skip { display:none; }
      .layout { display:block; max-width:none; padding:0; }
      .footer { max-width:none; padding:16px 0 0; }
      .content h2, .content h3 { break-after:avoid; }
      .content h3[id^="task-"] { break-inside:avoid; }
      .content pre, .content .table-wrap, .content .diagram { break-inside:avoid; }
      .content details { border-color:var(--border); }
    }
  </style>`;
}

function diagramScript() {
  return `<script data-omp-diagram-controls>
    (function () {
      var levels = [0.75, 1, 1.25, 1.5, 2];
      function setZoom(figure, zoom) {
        figure.dataset.zoom = String(zoom);
        figure.style.setProperty('--diagram-zoom', String(zoom));
        var label = figure.querySelector('[data-diagram-zoom-value]');
        if (label) label.textContent = Math.round(zoom * 100) + '%';
      }
      function nextZoom(current, direction) {
        if (direction === 'fit') return 1;
        if (direction === 'in') {
          for (var i = 0; i < levels.length; i += 1) if (levels[i] > current) return levels[i];
          return levels[levels.length - 1];
        }
        for (var j = levels.length - 1; j >= 0; j -= 1) if (levels[j] < current) return levels[j];
        return levels[0];
      }
      document.addEventListener('click', function (event) {
        var button = event.target.closest && event.target.closest('[data-diagram-zoom]');
        if (!button) return;
        var figure = button.closest('.mermaid-diagram');
        if (!figure) return;
        var current = parseFloat(figure.dataset.zoom || '1') || 1;
        setZoom(figure, nextZoom(current, button.getAttribute('data-diagram-zoom')));
      });
      document.querySelectorAll('.mermaid-diagram').forEach(function (figure) {
        setZoom(figure, parseFloat(figure.dataset.zoom || '1') || 1);
      });
      // Pointer-drag panning on .mermaid-svg containers (Figma-style canvas drag).
      (function () {
        var active = null;
        function onDown(event) {
          var svg = event.target.closest && event.target.closest('.mermaid-svg');
          if (!svg || event.button !== 0) return;
          active = {
            el: svg,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            scrollX: svg.scrollLeft,
            scrollY: svg.scrollTop,
            cursor: svg.style.cursor,
            userSelect: svg.style.userSelect
          };
          svg.classList.add('is-dragging');
          svg.style.cursor = 'grabbing';
          svg.style.userSelect = 'none';
          if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        function onMove(event) {
          if (!active) return;
          if (event.pointerId !== active.pointerId) return;
          active.el.scrollLeft = active.scrollX - (event.clientX - active.startX);
          active.el.scrollTop = active.scrollY - (event.clientY - active.startY);
          event.preventDefault();
        }
        function onUp(event) {
          if (!active) return;
          if (event.pointerId !== active.pointerId) return;
          if (active.el.releasePointerCapture) active.el.releasePointerCapture(event.pointerId);
          active.el.classList.remove('is-dragging');
          active.el.style.cursor = active.cursor;
          active.el.style.userSelect = active.userSelect;
          active = null;
        }
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
      }());
    }());
  </script>`;
}

function planNavScript() {
  return `<script data-omp-plan-nav>
    (function () {
      var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
      var sections = [];
      links.forEach(function (link) {
        var id = decodeURIComponent(link.getAttribute('href').slice(1));
        var node = id ? document.getElementById(id) : null;
        if (node) sections.push({ link: link, node: node });
      });
      if (sections.length === 0) return;
      var active = null;
      function update() {
        var edge = 140;
        var current = sections[0];
        for (var i = 0; i < sections.length; i += 1) {
          if (sections[i].node.getBoundingClientRect().top <= edge) current = sections[i];
        }
        if (current.link === active) return;
        if (active) active.removeAttribute('aria-current');
        active = current.link;
        active.setAttribute('aria-current', 'true');
      }
      var queued = false;
      function schedule() {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(function () { queued = false; update(); });
      }
      update();
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
    }());
  </script>`;
}

function themeScript() {
  return `<script data-omp-html-theme>
    (function () {
      var root = document.documentElement;
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      function applyTheme(isDark) { root.classList.toggle('dark', isDark); }
      function handleThemeChange(event) { applyTheme(event.matches); }
      applyTheme(media.matches);
      if (media.addEventListener) media.addEventListener('change', handleThemeChange);
      else if (media.addListener) media.addListener(handleThemeChange);
    }());
  </script>`;
}

function staticDocument(content, title, options = {}) {
  const maxWidth = options.maxWidth || '1100px';
  return `<!doctype html>
<html lang="en" data-template="omp-html-document-v1">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${sharedHtmlStyles()}
  <style>
    body { max-width:${maxWidth}; margin:0 auto; padding:2rem; }
    h1, h2, h3, h4, h5, h6 { color:var(--text); letter-spacing:0; }
    h1 { font-size:var(--text-5xl); line-height:1.05; margin:0 0 1rem; }
    h2 { font-size:var(--text-3xl); line-height:var(--leading-3xl); margin:2rem 0 .75rem; }
    h3 { font-size:var(--text-2xl); line-height:var(--leading-2xl); margin:1.5rem 0 .5rem; }
    h4 { font-size:var(--text-lg); line-height:var(--leading-lg); margin:1.25rem 0 .5rem; }
    h5 { font-size:var(--text-base); line-height:var(--leading-base); margin:1rem 0 .4rem; }
    h6 { font-size:var(--text-sm); line-height:var(--leading-sm); margin:1rem 0 .4rem; }
    p, ul, ol { font-size:var(--text-base); line-height:var(--leading-base); }
    small, figcaption { font-size:var(--text-sm); line-height:var(--leading-sm); }
    @media (max-width:760px) {
      body { padding:1.25rem; }
      h1 { font-size:var(--text-4xl); line-height:var(--leading-4xl); }
    }
  </style>
</head>
<body>
${content}
${themeScript()}
</body>
</html>
`;
}

function ensureSharedStyles(html) {
  if (/data-template=["']omp-brainstorm-v2["']/i.test(html)) {
    return html;
  }
  if (/data-omp-html-shared-styles/i.test(html)) {
    return html.replace(/<style\b[^>]*data-omp-html-shared-styles[^>]*>[\s\S]*?<\/style>/i, sharedHtmlStyles());
  }
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${sharedHtmlStyles()}\n</head>`);
  }
  return html;
}

function removeLegacyPlanShellStyles(html) {
  return html.replace(/<style\b(?![^>]*data-omp-)[^>]*>[\s\S]*?<\/style>/gi, (match) => {
    if (/\.topbar\b/.test(match) && /\.layout\b/.test(match) && /\.content\b/.test(match) && /\.toc\b/.test(match)) {
      return '';
    }
    return match;
  });
}

function ensurePlanStyles(html) {
  if (/data-omp-plan-styles/i.test(html)) {
    return html.replace(/<style\b[^>]*data-omp-plan-styles[^>]*>[\s\S]*?<\/style>/i, planHtmlStyles());
  }
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${planHtmlStyles()}\n</head>`);
  }
  return `${planHtmlStyles()}\n${html}`;
}

function removePlanTemplateChrome(html) {
  return html
    .replace(/<header\b(?=[^>]*\bclass=["'][^"']*\btopbar\b[^"']*["'])[^>]*>[\s\S]*?<\/header>\s*/gi, '')
    .replace(/<div\b(?=[^>]*\bclass=["'][^"']*\bstatus\b[^"']*["'])[^>]*>[\s\S]*?<\/div>\s*/gi, '')
    .replace(/<button\b(?=[^>]*\bid=["']theme-toggle["'])(?=[^>]*\bclass=["'][^"']*\btheme\b[^"']*["'])[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<button\b(?=[^>]*\bclass=["'][^"']*\btheme\b[^"']*["'])(?=[^>]*\bid=["']theme-toggle["'])[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?(?:omp-plan-theme|theme-toggle)[\s\S]*?<\/script>\s*/gi, '');
}

function removeFinalPlanStatus(html) {
  return html.replace(/<p\b[^>]*>\s*Plan Status:\s*Final\s*<\/p>\s*/gi, '');
}

function removeAutomaticThemeScript(html) {
  return html.replace(/<script\b[^>]*data-omp-html-theme[^>]*>[\s\S]*?<\/script>\s*/gi, '');
}

function refreshDiagramScript(html) {
  return html.replace(/<script\b[^>]*data-omp-diagram-controls[^>]*>[\s\S]*?<\/script>\s*/gi, diagramScript());
}

function ensureThemeScript(html) {
  if (/data-omp-html-theme/i.test(html) || /data-template=["']omp-brainstorm-v2["']/i.test(html) || /omp-plan-theme/i.test(html)) {
    return html;
  }
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${themeScript()}\n</body>`);
  }
  return `${html}\n${themeScript()}\n`;
}

function ensureDiagramScript(html) {
  if (/data-omp-diagram-controls/i.test(html)) {
    return refreshDiagramScript(html);
  }
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${diagramScript()}\n</body>`);
  }
  return `${html}\n${diagramScript()}\n`;
}

function ensurePlanNavScript(html) {
  if (/data-omp-plan-nav/i.test(html)) {
    return html;
  }
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${planNavScript()}\n</body>`);
  }
  return `${html}\n${planNavScript()}\n`;
}

function finalizeHtml(content, title, options = {}) {
  const trimmed = content.trimStart().toLowerCase();
  let html = trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
    ? content
    : staticDocument(content, title, options);
  if (options.planStyles) html = removeLegacyPlanShellStyles(html);
  html = normalizeSharedThemeBlock(html);
  html = ensureSharedStyles(html);
  if (options.planStyles) html = ensurePlanStyles(html);
  if (options.planStyles) html = removePlanTemplateChrome(html);
  if (options.removeFinalPlanStatus) html = removeFinalPlanStatus(html);
  if (options.planStyles) html = removeAutomaticThemeScript(html);
  html = ensureThemeScript(html);
  html = renderMermaidBlocks(html);
  html = themeInlineMermaidSvgs(html);
  html = ensureDiagramScript(html);
  if (options.planStyles) html = ensurePlanNavScript(html);
  validateStepMarkup(html);
  if (options.rejectRawMermaid !== false && hasRawMermaidBlocks(html)) {
    throw new Error('HTML still contains raw Mermaid; render to inline SVG before saving');
  }
  return html.endsWith('\n') ? html : `${html}\n`;
}

module.exports = {
  escapeHtml,
  finalizeHtml,
  hasRawMermaidBlocks,
  validateStepMarkup,
  normalizeSharedThemeBlock,
  planHtmlStyles,
  planNavScript,
  renderMermaidBlocks,
  refreshDiagramScript,
  sharedHtmlStyles,
  sharedThemeBlock,
  sharedThemeCss,
  sharedThemeTokens,
  staticDocument,
  themeMermaidSvg
};
