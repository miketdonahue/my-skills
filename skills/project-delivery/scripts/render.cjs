#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const USAGE = 'node render.cjs --project <project.json> --output <new-output-stem> [--python <python3>] [--html-helper <html-document.cjs>]';
const STAGES = { implementation: 'Implementation', qa: 'QA / release gate', cutover: 'Cutover' };
const NARRATIVES = ['handoffsFile', 'stageMeaningsFile', 'staffingProofAuthorizationFile', 'relationDetailsFile', 'approvalDetailsFile'];
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mdText = value => String(value).replace(/([\\`*_{}\[\]()#+.!|<>~-])/g, '\\$1');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function fail(message) { throw new Error(message); }
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must be a nonempty single-line string`);
  return value;
}
function safeUrl(value, label) {
  text(value, label);
  if (/[\s\\<>"'`]/u.test(value) || /%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(value) || value.startsWith('//')) fail(`${label}: unsafe URL`);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    if (!/^https?:\/\//i.test(value)) fail(`${label}: only HTTP(S), relative or fragment links are supported`);
    const parsed = new URL(value);
    if (parsed.username || parsed.password) fail(`${label}: URL credentials are not supported`);
  }
  return value;
}
function args(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === '--help' && argv.length === 1) { console.log(USAGE); process.exit(0); }
    if (!['--project', '--output', '--python', '--html-helper'].includes(name) || options[name] || !argv[i + 1] || argv[i + 1].startsWith('--')) fail(USAGE);
    options[name] = argv[++i];
  }
  if (!options['--project'] || !options['--output']) fail(USAGE);
  return options;
}

// Use the original installed Markdown implementation, not a handwritten parser.
// Validate the generated fragments before adding trusted template/helper markup.
const PYTHON_RENDER = String.raw`
import json, re, sys
from html.parser import HTMLParser
from urllib.parse import urlsplit
try:
    import markdown
except ImportError:
    sys.exit('Required installed Python Markdown module is missing; choose --python with Markdown installed. No packages were installed.')

class SafeFragment(HTMLParser):
    tags = set('p h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code em strong a img hr br table thead tbody tr th td del s details summary dl dt dd sup sub'.split())
    void = {'img', 'hr', 'br'}
    attrs = {'a': {'href', 'title'}, 'img': {'src', 'alt', 'title'}, 'code': {'class'}, 'th': {'align', 'style'}, 'td': {'align', 'style'}, 'ol': {'start'}}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
    def handle_starttag(self, tag, attrs):
        if tag not in self.tags:
            raise ValueError('Unsupported or active HTML tag: ' + tag)
        seen = set()
        for key, value in attrs:
            if key in seen or key not in self.attrs.get(tag, set()) or value is None:
                raise ValueError('Unsupported HTML attribute: ' + tag + '.' + key)
            seen.add(key)
            if key in {'href', 'src'}:
                if (re.search(r'[\s\\<>"\x27\x60\x00-\x1f\x7f]', value)
                    or re.search(r'%0[0-9a-f]|%1[0-9a-f]|%7f', value, re.I)
                    or value.startswith('//')):
                    raise ValueError('Unsafe link: ' + value)
                parts = urlsplit(value)
                if parts.scheme and (parts.scheme.lower() not in {'http', 'https'} or not parts.netloc):
                    raise ValueError('Unsupported link scheme: ' + value)
                if parts.username or parts.password:
                    raise ValueError('URL credentials are not supported')
            if key == 'class' and not re.fullmatch(r'language-[A-Za-z0-9_+.-]+', value):
                raise ValueError('Only fenced-code language classes are supported')
            if key == 'align' and value not in {'left', 'right', 'center'}:
                raise ValueError('Unsupported alignment')
            if key == 'start' and not re.fullmatch(r'[0-9]+', value):
                raise ValueError('Invalid list start')
            if key == 'style' and not re.fullmatch(r'text-align: (?:left|right|center);', value):
                raise ValueError('Only table text alignment styles are supported')
        if tag not in self.void:
            self.stack.append(tag)
    def handle_startendtag(self, tag, attrs):
        if tag not in self.void:
            raise ValueError('Unsupported self-closing tag: ' + tag)
        self.handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            raise ValueError('Unbalanced HTML markup: ' + tag)
    def handle_comment(self, data):
        raise ValueError('Raw HTML comments are not supported')
    def handle_decl(self, data):
        raise ValueError('Raw HTML declarations are not supported')
    def unknown_decl(self, data):
        raise ValueError('Raw HTML declarations are not supported')
    def handle_pi(self, data):
        raise ValueError('Raw HTML processing instructions are not supported')

result = []
for item in json.load(sys.stdin):
    try:
        renderer = markdown.Markdown(extensions=['fenced_code', 'tables', 'sane_lists'])
        # Technical literals such as generic types are text, not raw HTML.
        # Disable only source HTML passthrough; generated Markdown markup and
        # fenced code still use the installed renderer and safety validation.
        renderer.preprocessors.deregister('html_block')
        renderer.inlinePatterns.deregister('html')
        fragment = renderer.convert(item['text'])
        parser = SafeFragment()
        parser.feed(fragment)
        parser.close()
        if parser.stack:
            raise ValueError('Unclosed HTML markup')
        result.append(fragment)
    except Exception as error:
        sys.exit(item['label'] + ': ' + str(error))
json.dump(result, sys.stdout)
`;

function main() {
  const options = args(process.argv.slice(2));
  const manifestPath = path.resolve(options['--project']);
  const root = path.dirname(manifestPath);
  const project = record(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), 'project');
  text(project.title, 'title');
  if (!Array.isArray(project.developers) || !project.developers.length) fail('developers must be a nonempty array');
  if (!Array.isArray(project.tickets) || !project.tickets.length) fail('tickets must be a nonempty array');
  if (project.externalTickets !== undefined && !Array.isArray(project.externalTickets)) fail('externalTickets must be an array when supplied');
  const developers = new Map();
  const htmlIds = new Set(['main', 'how-to-use', 'developer-queues', 'dependency-overview', 'dependency-reference', 'ticket-descriptions', 'delivery-evidence', 'staffing-proof-authorization', 'native-relation-details', 'approval-context']);
  for (const developer of project.developers) {
    record(developer, 'developer');
    if (typeof developer.id !== 'string' || !ID.test(developer.id) || developers.has(developer.id)) fail('Developer IDs must be unique safe identifiers');
    text(developer.name, `developer ${developer.id}.name`);
    if (developer.focus !== undefined) text(developer.focus, `developer ${developer.id}.focus`);
    developers.set(developer.id, developer);
    htmlIds.add(`developer-${developer.id}`);
  }
  const fragments = [];
  function markdownFragment(source, label) {
    const index = fragments.length;
    fragments.push({ text: source, label });
    return { source, index };
  }
  function fileFragment(filename, label) {
    text(filename, label);
    const absolute = path.resolve(root, filename);
    const source = fs.readFileSync(absolute, 'utf8');
    if (!source.trim()) fail(`${label} is empty`);
    return markdownFragment(source, absolute);
  }
  const tickets = new Map();
  for (const ticket of project.tickets) {
    record(ticket, 'ticket');
    if (typeof ticket.id !== 'string' || !ID.test(ticket.id) || tickets.has(ticket.id) || htmlIds.has(ticket.id)) fail('Ticket IDs must be unique safe identifiers and not collide with template anchors');
    text(ticket.title, `${ticket.id}.title`);
    if (!developers.has(ticket.developer)) fail(`${ticket.id}: unknown primary developer`);
    if (!Object.hasOwn(STAGES, ticket.stage)) fail(`${ticket.id}: stage must be implementation, qa or cutover`);
    if (ticket.displayId !== undefined) text(ticket.displayId, `${ticket.id}.displayId`);
    if (ticket.url !== undefined) safeUrl(ticket.url, `${ticket.id}.url`);
    tickets.set(ticket.id, { ...ticket, external: false, description: fileFragment(ticket.descriptionFile, `${ticket.id}.descriptionFile`) });
    htmlIds.add(ticket.id);
  }
  for (const ticket of project.externalTickets || []) {
    record(ticket, 'external ticket');
    if (typeof ticket.id !== 'string' || !ID.test(ticket.id) || tickets.has(ticket.id) || htmlIds.has(ticket.id)) fail('External ticket IDs must be unique safe identifiers and not collide with other tickets or template anchors');
    text(ticket.title, `${ticket.id}.title`);
    if (Object.hasOwn(ticket, 'developer') || Object.hasOwn(ticket, 'stage')) fail(`${ticket.id}: external tickets must not declare developer or stage`);
    if (ticket.displayId !== undefined) text(ticket.displayId, `${ticket.id}.displayId`);
    if (ticket.url !== undefined) safeUrl(ticket.url, `${ticket.id}.url`);
    tickets.set(ticket.id, { ...ticket, external: true, description: fileFragment(ticket.descriptionFile, `${ticket.id}.descriptionFile`) });
    htmlIds.add(ticket.id);
  }
  const prerequisites = record(project.prerequisites, 'prerequisites');
  if (Object.keys(prerequisites).length !== tickets.size || Object.keys(prerequisites).some(id => !tickets.has(id))) fail('prerequisites must contain exactly every internal and external ticket ID');
  for (const [id, parents] of Object.entries(prerequisites)) {
    if (!Array.isArray(parents) || parents.some(p => typeof p !== 'string' || !tickets.has(p) || p === id) || new Set(parents).size !== parents.length) fail(`${id}: invalid, self, unknown or duplicate prerequisite`);
  }
  const waves = [];
  const done = new Set();
  while (done.size < tickets.size) {
    const ready = [...tickets.keys()].filter(id => !done.has(id) && prerequisites[id].every(p => done.has(p)));
    if (!ready.length) fail('Dependency cycle');
    waves.push(ready);
    ready.forEach(id => done.add(id));
  }
  const ordered = waves.flat();
  const waveById = new Map(waves.flatMap((wave, index) => wave.map(id => [id, index + 1])));
  const narrativeFiles = record(project.narratives, 'narratives');
  const narratives = Object.fromEntries(NARRATIVES.map(key => [key, fileFragment(narrativeFiles[key], `narratives.${key}`)]));
  const start = markdownFragment('## Start here: follow a developer queue\n\n**The numbered table is a dependency map, not a day-by-day schedule.** Read the grouped queues first to see each person\'s proposed focus order; use the global table afterward to check dependencies.\n\n1. Choose a developer below. Each internal ticket appears under exactly one primary developer. External prerequisites appear in the global reference, not in team queues.\n2. Take ready work in that queue. To land it, complete its own acceptance and every ticket listed under **Can land after**, plus applicable deployment/authorization gates. Earlier preparation on prerequisite stacks is allowed.\n3. If another developer or external owner must deliver an input, prepare or review while waiting. Do not implement a missing sibling ticket or wait for every unrelated ticket in an earlier numbered wave.\n\n**These are proposed lanes, not tracker assignments.** Queue position is a suggested staffing sequence, not an extra dependency or a duration/equal-workload estimate. QA scenario ownership and protected operational steps are specified in the staffing and authorization details below.', 'start-here');
  const guidance = markdownFragment('The table below retains the full dependency-wave view, including external prerequisites and their full dependency chains. For an individual developer\'s work, start with their queue above. Open a complete ticket description below or use its tracker link in the queue.\n\n**You do not complete all sequential gates first.** Direct prerequisites are the authoritative landing rule. A sequential gate occurs at its position in the graph and waits for its own listed inputs; it is not a global prerequisite for all parallel work. Parallel branches can proceed once their own prerequisites are delivered. Order numbers group dependency waves, not blanket barriers. Preparation on prerequisite stacks is allowed, but is not implementation landing.\n\n**Graph-ready is not simultaneously staffed.** Execution mode describes the dependency graph only. Shared owners and limited staffing can serialize independent branches. External prerequisites are labeled **External owner (not staffed)** and receive no team queue or staffing allocation. Resource readiness remains conditional on delivery of external inputs; their appearance in this guide never implies completion. Publishing tickets does not satisfy implementation prerequisites or establish product readiness.', 'dependency-guidance');
  const result = spawnSync(options['--python'] || 'python3', ['-c', PYTHON_RENDER], { input: JSON.stringify(fragments), encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) fail((result.stderr || result.stdout || 'Markdown rendering failed').trim());
  const rendered = JSON.parse(result.stdout);
  const html = fragment => rendered[fragment.index];
  const label = id => tickets.get(id).displayId || id;
  const developerName = id => tickets.get(id).external ? 'External owner (not staffed)' : developers.get(tickets.get(id).developer).name;
  const stageLabel = id => tickets.get(id).external ? 'External prerequisite' : STAGES[tickets.get(id).stage];
  const link = (id, external = false) => {
    const ticket = tickets.get(id);
    return `<a href="${escapeHtml(external && ticket.url ? ticket.url : '#' + id)}">${escapeHtml(label(id) + ' - ' + ticket.title)}</a>`;
  };
  const mdLink = (id, external = false) => `[${mdText(label(id) + ' - ' + tickets.get(id).title)}](${external && tickets.get(id).url ? tickets.get(id).url.replace(/[()|\[\]]/g, c => '%' + c.charCodeAt(0).toString(16)) : '#' + id})`;
  function table(headers, rows, attributes = '') {
    return `<table${attributes}><thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function mdTable(headers, rows) {
    return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(row => '| ' + row.join(' | ') + ' |').join('\n')}`;
  }
  const md = [`# ${mdText(project.title)}`, start.source, '## Work grouped by developer'];
  const queues = [];
  for (const developer of developers.values()) {
    const queue = ordered.filter(id => !tickets.get(id).external && tickets.get(id).developer === developer.id);
    const headers = ['Queue', 'Ticket', 'Can land after', 'Delivery stage'];
    const rows = queue.map((id, index) => [String(index + 1), link(id, true), prerequisites[id].map(p => `<a href="#${p}">${escapeHtml(label(p))}</a> (${escapeHtml(developerName(p))})`).join('; ') || 'No ticket prerequisites', STAGES[tickets.get(id).stage]]);
    queues.push(`<section id="developer-${developer.id}"><h3>${escapeHtml(developer.name)}</h3>${developer.focus ? '<p>' + escapeHtml(developer.focus) + '</p>' : ''}${table(headers, rows, ` class="developer-queue" data-developer="${developer.id}"`)}</section>`);
    md.push(`### ${mdText(developer.name)}`, developer.focus ? mdText(developer.focus) : '', mdTable(headers, queue.map((id, index) => [String(index + 1), mdLink(id, true), prerequisites[id].map(p => `[${mdText(label(p))}](#${p}) (${mdText(developerName(p))})`).join('; ') || 'No ticket prerequisites', STAGES[tickets.get(id).stage]])));
  }
  const globalHeaders = ['Order', 'Delivery', 'Direct prerequisites', 'Delivery stage', 'Execution mode', 'Developer'];
  const mode = id => waves[waveById.get(id) - 1].length > 1 ? 'Parallel branch' : 'Sequential gate';
  const globalRows = ordered.map(id => [String(waveById.get(id)), link(id), escapeHtml(prerequisites[id].map(label).join(', ') || 'None'), stageLabel(id), mode(id), escapeHtml(developerName(id))]);
  md.push(narratives.handoffsFile.source, '## Global dependency reference', guidance.source, mdTable(globalHeaders, ordered.map(id => [String(waveById.get(id)), mdLink(id), mdText(prerequisites[id].map(label).join(', ') || 'None'), stageLabel(id), mode(id), mdText(developerName(id))])), narratives.stageMeaningsFile.source, '## Complete ticket descriptions');
  const descriptions = [];
  for (const ticket of tickets.values()) {
    const summary = `${label(ticket.id)} - ${ticket.title}${ticket.external ? ' (External prerequisite)' : ''}`;
    const digest = sha256(ticket.description.source);
    const ownership = ticket.external ? '<p>External owner (not staffed). Delivery remains an external prerequisite; completion is not inferred.</p>' : '';
    descriptions.push(`<details id="${ticket.id}"><summary>${escapeHtml(summary)}</summary><div class="details-body">${ownership}<p class="description-meta">Description SHA-256: <code>${digest}</code></p>${html(ticket.description)}</div></details>`);
    md.push(`<a id="${ticket.id}"></a>\n\n### ${mdText(summary)}${ticket.external ? '\n\nExternal owner (not staffed). Delivery remains an external prerequisite; completion is not inferred.' : ''}\n\nDescription SHA-256: \`${digest}\``, ticket.description.source);
  }
  for (const [key, title] of [['staffingProofAuthorizationFile', 'Staffing, proof partition and operational authorization'], ['relationDetailsFile', 'Exact native relation details'], ['approvalDetailsFile', 'Publication approval context']]) md.push(`## ${title}`, narratives[key].source);
  const slots = { TITLE: `<h1>${escapeHtml(project.title)}</h1>`, START_HERE: html(start), DEVELOPER_QUEUES: queues.join('\n'), HANDOFFS: html(narratives.handoffsFile), DEPENDENCY_GUIDANCE: html(guidance), DEPENDENCY_TABLE: table(globalHeaders, globalRows, ' id="dependency-overview"'), STAGE_MEANINGS: html(narratives.stageMeaningsFile), TICKET_DESCRIPTIONS: descriptions.join('\n'), STAFFING_PROOF_AUTHORIZATION: html(narratives.staffingProofAuthorizationFile), RELATION_DETAILS: html(narratives.relationDetailsFile), APPROVAL_DETAILS: html(narratives.approvalDetailsFile) };
  slots.DOCUMENT_TITLE = escapeHtml(project.title);
  slots.AUTHORED_DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  slots.DEVELOPER_NAVIGATION = [...developers.values()].map(developer => `<a href="#developer-${developer.id}">${escapeHtml(developer.name)}</a>`).join('\n');
  const template = fs.readFileSync(path.join(__dirname, '../assets/template.html'), 'utf8');
  const body = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(slots, key)) fail(`Unknown template slot: ${key}`);
    return slots[key];
  }).replace(/<table\b[^>]*>/g, match => '<div class="table-wrap">' + match).replace(/<\/table>/g, '</table></div>');
  const helperPath = path.resolve(options['--html-helper'] || path.join(os.homedir(), '.omp/agent/lib/html-document.cjs'));
  if (!fs.existsSync(helperPath)) fail(`Required OMP HTML helper is missing: ${helperPath}`);
  const helper = require(helperPath);
  const document = helper.finalizeHtml(body, project.title, { planStyles: true });
  const stem = path.resolve(options['--output']);
  if (/\.(?:md|html)$/i.test(stem)) fail('--output is a new basename without .md or .html');
  const outputs = [[stem + '.md', md.filter(Boolean).join('\n\n') + '\n'], [stem + '.html', document]];
  // Reserve both paths before writing. Never rewrite approval files or inputs.
  const opened = [];
  try {
    for (const [filename] of outputs) opened.push({ filename, fd: fs.openSync(filename, 'wx') });
    outputs.forEach(([, content], index) => fs.writeFileSync(opened[index].fd, content, 'utf8'));
  } catch (error) {
    for (const entry of opened) {
      fs.closeSync(entry.fd);
      fs.unlinkSync(entry.filename);
    }
    throw error;
  }
  for (const entry of opened) fs.closeSync(entry.fd);
  console.log(JSON.stringify({ markdown: outputs[0][0], html: outputs[1][0], tickets: tickets.size, staffedTickets: project.tickets.length, externalTickets: (project.externalTickets || []).length, developers: developers.size, dependencyWaves: waves.length }, null, 2));
}

try { main(); } catch (error) { console.error(`render: ${error.message}`); process.exitCode = 1; }
