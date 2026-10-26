# Rendering a developer-first execution guide

## Contents

- Purpose and boundaries
- Local prerequisites
- CLI
- Manifest schema
- One content source, two representations
- Markdown and content safety
- Integration checks to run separately

## Purpose and boundaries

`scripts/render.cjs` produces a new Markdown execution guide and its HTML counterpart from one `project.json`, full ticket descriptions and explicit narrative files. It does not publish tickets, assign users, certify source coverage, approve changes or assert verification results. Run the graph/coverage validator and independent semantic reviews separately. Rendering success is not project, product or tracker acceptance.

The slash command first reads one `.md` or `.html` source proposal and authors the new ticket drafts and local manifest. This helper renders that manifest, not the original HTML proposal. Its `--project <project.json>` flag is an internal file argument, distinct from the slash command's optional `--project <Linear-project-URL>` destination. Do not pass a Linear URL to this helper or require a Linear destination for local rendering.

The bundled `assets/template.html` preserves the supplied guide's developer queues, dependency reference and complete ticket content inside the canonical OMP reading shell used by tech-doc and write-plan: full HTML document, `.layout`, `main.content#main`, a responsive `nav.toc`, a skip link and `.footer`. `assets/template-provenance.json` records the original content provenance and the shell correction. The template contains only the shared `data-omp-plan-styles` placeholder, never copied theme CSS.

Do not include reader-facing links to internal approval packages, raw API payload files or hash manifests in guidance or narrative inputs. Keep them in the run's evidence inventory; use plain code filenames if needed, not clickable links. In particular, do not copy the historical CG guide's approval-artifact link row. Actual published ticket links and working in-document anchors remain appropriate.

Ticket disclosures use the shared `.details-body` article-prose rules, not page-title or page-section typography: compact heading hierarchy, normal paragraph/list rhythm, readable line lengths and contained tables/code. Keep `.description-meta` on the description fingerprint paragraph so it stays secondary and wraps safely. These rules live in the canonical HTML helper and affect only embedded disclosure bodies; do not add a separate skill-specific typography stylesheet.

The footer follows the other OMP HTML templates: a muted `Authored Month D, YYYY` line in `.footer`, with no skill-name tagline. The renderer fills the authored-date slot from its local generation date.

## Local prerequisites

- Node.js with CommonJS support.
- An installed Python 3 interpreter with the `Markdown` package. The original generator's renderer, Python Markdown 3.11.2, was found installed during skill creation. The renderer uses its `fenced_code`, `tables` and `sane_lists` extensions. No package installation is attempted. A missing interpreter/module is an actionable prerequisite, not a reason to invent a parser.
- OMP's existing `~/.omp/agent/lib/html-document.cjs`. An explicit `--html-helper` path can select that helper in another installation. The actual call is:

```javascript
helper.finalizeHtml(body, project.title, {
  planStyles: true
});
```

The template supplies the canonical structural shell; the helper supplies its base styles, theme, light/dark code styles and navigation behavior. Both are required: `main.content` alone leaves the shared margin reset without the padded reading layout. Do not substitute a bare main fragment or a maxWidth override. Keep section labels, working Contents links and `.details-body` padding inside disclosures. The skill adds no competing CSS or scripts. Ordinary fenced `mermaid` blocks remain code fences and do not trigger optional external tooling or installs.

## CLI

```text
node render.cjs --project <project.json> --output <new-output-stem> [--python <python3>] [--html-helper <html-document.cjs>]
```

Example smoke command for the integrating agent, after saving the schema and referenced files below:

```bash
node "$HOME/.omp/agent/skills/project-delivery/scripts/render.cjs" \
  --project /absolute/path/to/project.json \
  --output /absolute/path/to/execution-guide-001
```

This writes `execution-guide-001.md` and `execution-guide-001.html` and prints JSON with absolute `markdown` and `html` paths, total `tickets`, internal `staffedTickets`, `externalTickets`, developer count and dependency-wave count. `--output` is a basename without `.md` or `.html`; its parent directory must already exist. Relative manifest/output CLI paths resolve against the caller's working directory. All description and narrative file paths resolve against the directory containing `project.json`, never the skill directory or current session.

Both output paths are reserved with exclusive creation before writing either document. If either already exists, the command fails without overwriting it. Use a new versioned basename to refresh presentation. There is no overwrite or HTML-only mode, and no write to descriptions, tracker payloads, receipts, approval snapshots or the manifest. Both outputs always use the same input snapshot. Never use this renderer to replace an approved publication payload: the generated Markdown is an execution guide, not an API mutation package.

Failures print `render: <reason>` to stderr and exit nonzero. No successful output-path report is printed on failure. Missing files, invalid JSON, missing dependencies, unsafe content and graph/ownership errors are reported before output creation.

## Manifest schema

This is a complete minimal one-developer example. Add developers and tickets without changing code. Ticket IDs are illustrative local identifiers, not claims about a real tracker. For skill-authored manifests, developer IDs must be `A`, `B`, `C`, ... in order, continuing `AA`, `AB`, ... after `Z`; names must be `Developer A (lead)`, `Developer B`, `Developer C`, ... . The general renderer accepts other safe identifiers, but this skill must use the lettered convention and keep actual Linear-user mappings separate.

```json
{
  "title": "Example Capability Migration",
  "developers": [
    {"id": "A", "name": "Developer A (lead)", "focus": "Implementation, integration and acceptance coordination."}
  ],
  "tickets": [
    {
      "id": "EXAMPLE-1",
      "title": "Deliver the bounded capability",
      "developer": "A",
      "stage": "implementation",
      "descriptionFile": "tickets/capability.md"
    }
  ],
  "prerequisites": {"EXAMPLE-1": []},
  "narratives": {
    "handoffsFile": "narratives/handoffs.md",
    "stageMeaningsFile": "narratives/stage-meanings.md",
    "staffingProofAuthorizationFile": "narratives/staffing-proof-authorization.md",
    "relationDetailsFile": "narratives/relation-details.md",
    "approvalDetailsFile": "narratives/approval-details.md"
  }
}
```

### Fields

| Field | Required contract |
| --- | --- |
| `title` | Nonempty single-line project-goal title, e.g. `Connector Gateway Migration`. No developer counts or generic document-format suffixes such as `execution guide`, `delivery plan` or `ticket breakdown`. The renderer uses it unchanged for the HTML heading, browser tab and Markdown heading. |
| `developers` | Nonempty ordered array of `{id, name, focus?}`. IDs are unique and match `[A-Za-z][A-Za-z0-9_-]*`. Names are display labels, not authorization to assign tracker users. Optional focus is plain single-line text. N=1 is valid; an unused developer gets an empty queue. |
| `tickets` | Nonempty ordered array of internally staffed ticket records. Input order breaks ties within dependency waves and controls complete-description order. External tickets follow internal tickets for tie-breaking, but their dependencies still determine topological position. |
| `tickets[].id` | Unique identifier matching the same safe-ID pattern. It is the stable graph key and description anchor. It must not collide with a template or developer-section anchor. |
| `tickets[].title` | Nonempty single-line title. |
| `tickets[].developer` | Exactly one existing developer ID, not a list or invented shared-owner string. |
| `tickets[].stage` | Exactly `implementation`, `qa` or `cutover`. Display labels are `Implementation`, `QA / release gate` and `Cutover`. Actual timing, coexistence and authorization semantics belong in the required stage narrative. |
| `tickets[].descriptionFile` | Path to the complete UTF-8 Markdown description. Content is not truncated, summarized or rewritten. Its SHA-256 is shown alongside the full body in both outputs. |
| `tickets[].displayId` | Optional actual published identifier, while `id` remains the stable local key. |
| `tickets[].url` | Optional tracker HTTP(S), relative or fragment URL. Queue links use this URL when present; the global table always links to the local full description. |
| `externalTickets` | Optional ordered array of `{id, title, descriptionFile, url?, displayId?}` records. Each external ticket requires a unique safe ID and full Markdown description, just like an internal ticket. IDs are unique across both arrays. External records must not contain `developer` or `stage`, including null values: external work is never assigned to the N-developer team by this manifest. |
| `prerequisites` | Object keyed by exactly the union of internal and external ticket IDs, with arrays of direct predecessor IDs. Unknown, duplicate or self edges and cycles are rejected across the complete graph. The renderer does not project away external edges or invent/remove dependencies. |
| `narratives` | Object containing all five nonempty Markdown file paths listed below. Extra data is ignored, not treated as verification evidence. |

Every scalar label is single-line and rejects control characters. JSON object keys and display names are case-sensitive. Do not supply a second manually maintained graph for the renderer: use the validated authoritative `prerequisites` map.

### External prerequisites without fictional staffing

Preserve every reachable external prerequisite and its own dependency edges in the same `prerequisites` map. For example, extend the minimal manifest with:

```json
{
  "externalTickets": [
    {
      "id": "UPSTREAM-1",
      "title": "External prerequisite capability",
      "descriptionFile": "tickets/upstream-capability.md",
      "url": "https://tracker.example.test/issues/UPSTREAM-1"
    }
  ],
  "prerequisites": {
    "EXAMPLE-1": ["UPSTREAM-1"],
    "UPSTREAM-1": []
  }
}
```

This is a schema illustration, not evidence that the external work exists or has completed. Retain the other required manifest fields. If `UPSTREAM-1` has additional ancestors, include each in `externalTickets` or the internal ticket list as appropriate, plus their exact edges. Do not replace the graph with an internal-only projection or mark upstream nodes complete to make staffing appear possible.

External tickets appear in the same six-column global reference with delivery stage `External prerequisite` and developer `External owner (not staffed)`. Their complete descriptions and digests are included in the same disclosure section, explicitly labeled as external. They never enter a developer queue or receive team staffing allocation. Internal queue rows show `External owner (not staffed)` for external parents. Graph ordering includes all nodes; actual resource readiness stays conditional on externally delivered inputs, and rendering never infers completion. Independent review must reconcile the supplied external descriptions and graph with fresh source evidence.

### Required narrative files

1. **`handoffsFile`:** Concrete producer-to-consumer handoffs using the actual tickets and developer names, including external producer inputs when present. Include every cross-developer input here or in complete descriptions. With one developer, explicitly describe same-owner sequencing and distinguish absent cross-developer handoffs from any external-owner dependencies. This is displayed between developer queues and the global reference, matching the source layout.
2. **`stageMeaningsFile`:** Explain implementation, QA/release acceptance and cutover, including applicable coexistence/rollback and safe-landing conditions. Clearly distinguish pre-release proof from operational authorization. Use actual project constraints, not historical examples. Do not claim a hold, approval or deployment exists without evidence.
3. **`staffingProofAuthorizationFile`:** Detailed staffing sequence, resource-aware batches, proof partition, scenario/fix owners, evidence links and operational authorization boundaries. State when staffing choices serialize graph-independent work. Do not invent dates, equal workloads, measured performance or review results.
4. **`relationDetailsFile`:** Exact proposed or observed native relation changes and their status. Keep authoritative payload files/digests in the run evidence, not reader-facing links. Preserve relation types and concurrency protections. The renderer does not calculate API mutations from this prose or approve it.
5. **`approvalDetailsFile`:** Actual publication approval state and exact scope/protected fields. Describe internal approval evidence without links to approval packages, raw payload files or hash manifests. Clearly label historical context as historical. Pending approval remains pending; a presentation render is not new approval. Do not put obsolete approval requests at the top of an already published execution guide.

These files are required so the renderer cannot silently fabricate project-specific handoffs, review success, historical publication, named assignments or operational permission. Their semantics must be independently reviewed against the graph and evidence. A minimal one-developer document can honestly state that no external mutations have been proposed or authorized, if true.

## One content source, two representations

Both documents contain, in order:

1. Project title.
2. Start-here instructions explaining that dependency waves are not a calendar.
3. One queue per developer: **Queue / Ticket / Can land after / Delivery stage**. Every prerequisite includes its primary developer label, or `External owner (not staffed)`, making handoffs explicit. Only internal tickets are queued.
4. The complete concrete-handoff narrative.
5. Global dependency reference with exactly **Order / Delivery / Direct prerequisites / Delivery stage / Execution mode / Developer**.
6. Stage meanings and safe-landing qualifications.
7. Every complete internal and external ticket body and its description digest.
8. Staffing/proof/authorization, native relations and approval context.

HTML uses `data-template="omp-project-delivery-v1"`, `.layout > main.content#main`, sibling `nav.toc` labeled `Contents`, a skip link and `.footer`. Navigation includes the main sections and every developer lane. It retains `#how-to-use`, `#developer-queues`, `.developer-queue`, `#dependency-overview`, native `details`/`summary` with `.details-body` wrappers, and `.table-wrap` around all tables. The complete ticket bodies and final three narratives remain in disclosures. Markdown contains the same full content directly, with stable anchors; it is not a separately curated summary or historical payload clone.

Topological layers are computed over the complete internal-plus-external graph by repeatedly collecting all currently graph-ready tickets in manifest order. A singleton layer is labeled `Sequential gate`; a larger layer is labeled `Parallel branch`. These are graph labels only, not claims of simultaneous staffing, external completion or blanket barriers. Queues filter this stable topological order by internal owner. Suggested personal position never adds a blocker. The validator and staffing narrative, not this renderer, establish resource-aware execution batches and truthful concurrency. External input delivery remains an explicit readiness condition.

## Markdown and content safety

Full fenced code, lists, headings, tables, ordinary links and long descriptions use the installed Markdown renderer. Source HTML passthrough is disabled by deregistering its `html_block` preprocessor and `html` inline pattern. Technical literals such as `<void,never>`, raw tags, comments and script snippets therefore serialize as inert escaped text in the generated HTML, without changing the input or its digest. HTML examples inside fenced code also remain inert escaped code. Ordinary Markdown still produces its normal structural markup, and the trusted template owns native disclosures. Rendered fragments are independently validated before entering that template: unexpected active tags, event attributes, arbitrary classes/IDs, declarations, unbalanced tags and unsupported attributes are rejected if any escape the Markdown conversion. Table alignment is permitted only for exact `text-align: left;`, `right;` or `center;` styles.

The Markdown output intentionally retains complete source descriptions verbatim, including any literal HTML syntax. Its content is not authorization to execute that syntax. The inert-HTML guarantee applies to this renderer's generated HTML; another Markdown viewer must independently disable raw HTML if it renders the Markdown artifact. Do not alter approved technical descriptions simply to accommodate HTML parsing.

Links and image sources allow HTTP(S), relative destinations and fragments, with no credentials, backslashes, protocol-relative URLs, whitespace/control characters or active schemes. `javascript:`, `data:`, `file:`, custom application protocols and mailto autolinks are intentionally rejected. Use percent-encoded spaces for portable links. Local source references that need unsupported schemes can be represented as code rather than clickable URLs. Safe relative URLs are copied unchanged into the output; place the output alongside the intended linked artifacts or make portable links deliberately. Raw HTML attributes are not a way to bypass this policy.

Mermaid stays as a readable fenced source block. External images and links can still reference remote resources; use only intended, safe evidence destinations. The renderer does not scrape them or certify their content.

## Integration checks to run separately

No checks are asserted by this document. The integrating agent should run the CLI against complete representative descriptions, inspect Markdown/HTML parity and the actual browser surface, then exercise N=1 and N>1, external prerequisite chains and their exclusion from staffing queues, code fences, aligned tables, generic type literals, inert raw tags/script snippets, invalid owner, cycle, unsafe links and existing-output rejection. Also confirm that source/approval artifact hashes remain unchanged. Those checks must not be represented as passing until actually performed.
