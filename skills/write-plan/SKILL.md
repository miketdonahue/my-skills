---
name: write-plan
description: "Expand exactly one finalized brainstorm document into a detailed implementation-ready Markdown and standalone HTML plan."
---

# Writing Detailed Implementation Plans

Invocation:

```text
/write-plan /absolute/path/to/finalized-brainstorm.md
/write-plan /absolute/path/to/finalized-brainstorm.html
```

This is a standalone, read-only planning workflow. It accepts one finalized
brainstorm and returns a new Markdown/HTML plan pair. It does not brainstorm,
create tickets, implement code, or invoke another skill.

## Hard boundaries

- Accept exactly one readable `.md` or `.html` file.
- Stop without artifacts when the source contains `Status: Stalemate`, an
  explicit `Decision: Do Not Proceed`, competing recommendations, an explicit
  blocker, or a human decision that still prevents a concrete plan.
- If the source is `Status: Aligned`, do not block only because it contains an
  `Open questions` section. Treat aligned open questions as planned
  assumptions, risks, validation gates, rollout gates, or implementation tasks
  with a stated direction. Stop only if the question contradicts the aligned
  recommendation or leaves no concrete implementation path.
- Read the complete source and inspect the repository read-only.
- Do not edit repository files, change repository state, create tickets, send
  external messages, or invent paths, symbols, evidence, links, or test results.
- Always produce matching Markdown and standalone HTML artifacts with
  `Plan Status: Final` in the draft source for saver validation. The finalized
  rendered HTML must not display a plan-status line or badge.
- Start the HTML draft from
  `/Users/michael/.omp/agent/skills/write-plan/assets/template.html` and keep
  its skeleton (`.layout`, `main.content`, `nav.toc`, `.footer`) plus its empty
  `<style data-omp-plan-styles></style>` placeholder. HTML output must be
  finalized through `/Users/michael/.omp/agent/lib/html-document.cjs` via
  `save-final-plan.cjs`, which replaces that placeholder with the canonical plan
  visual layer. Do not hand-roll Mermaid rendering, code-block styling, or
  light/dark theme behavior in the plan draft. Do not introduce a custom color
  palette, typography scale, shadows, or decorative chrome. Do not add a top
  header, status badge, theme toggle, or persisted theme state; finalized HTML
  follows the system `prefers-color-scheme` setting, matching brainstorm
  output. Do not introduce custom micro-type; use the shared 13px minimum for
  every generated document text element, 15px base, 16px emphasis, and the
  standard heading scale. Do not force uppercase outside numbered section
  labels.
- Write plan content as plain semantic HTML so the canonical layer can style it:
  one `h2` per numbered section, `h3` ids beginning `task-` for implementation
  tasks, a task field label as a paragraph containing only `<strong>`, every
  table wrapped in `<div class="table-wrap">`, and one `nav.toc` link per `h2`.
- Document metadata is exactly two quiet lines: `<p class="plan-meta">Brainstorm
  <a …>file name</a></p>` immediately under the `h1`, with the absolute path in
  `href`/`title`, and the authored date alone in `.footer`. Do not add project,
  decision, status, or owner fields; the decision belongs in the first section.
  The Markdown plan carries the same date and brainstorm path as a short bullet
  list under its title.

## Workflow

1. Resolve and validate the single input path. Reject missing, extra,
   unsupported, unreadable, empty, or non-regular inputs without guessing.
2. Read the complete document. For HTML, inspect all visible headings, tables,
   diagrams, code, acceptance criteria, and references.
3. Check terminal status before doing repository exploration. Report the exact
   blocker and save nothing when the source is `Status: Stalemate`, `Decision:
   Do Not Proceed`, or has an explicit blocker/no-go signal.
4. Derive the project from `~/.omp/brainstorms/<project>/`; otherwise use the
   current repository root basename.
5. Inspect applicable nested `AGENTS.md`/`RULES.md` files, repository state,
   relevant source symbols, tests, documentation, configuration, migrations,
   deployment boundaries, recent history, and every named reference.
6. Draft and self-review an implementation-ready plan containing:
   - precise goal, constraints, non-goals, assumptions, decision gates, and
     resolved decisions;
   - current/proposed architecture and data-flow or sequence diagrams;
   - exact files and symbols to create or modify;
   - interfaces, dependencies, schemas, flags, and compatibility rules;
   - concrete code examples tied to verified symbols;
   - bite-sized ordered tasks with exact files, fixtures, commands, and expected
     results;
   - testing, rollout, migration, observability, compatibility, and failure
     handling;
   - supporting evidence and conversation references without invention.
7. Confirm every brainstorm open question is either resolved from repository
   evidence, carried as an explicit assumption/risk/gate, or promoted to a
   concrete implementation task. If any remaining question invalidates the
   recommendation or prevents a concrete task breakdown, stop without final
   artifacts and report that specific blocker.
8. Search the complete plan for placeholders, vague validation language,
   unsupported symbols, contradictions, scope drift, and Markdown/HTML parity
   problems. Fix every finding before saving.
9. Write temporary drafts under `~/.omp/plans/<project>/.working/`, add
   `Plan Status: Final` to both, and save them with:

   ```bash
   node "/Users/michael/.omp/agent/skills/write-plan/scripts/save-final-plan.cjs" \
     --mode final --project "<project>" --topic "<topic>" \
     --brainstorm-source "<exact absolute source>" \
     --markdown-source "<absolute markdown draft>" \
     --html-source "<absolute html draft>"
   ```

   Never overwrite an existing final plan. Capture the helper JSON and verify
   both returned files exist before reporting success. The helper renders
   `<pre class="mermaid" data-caption="Short takeaway">...</pre>` blocks to
   inline SVG and injects shared light/dark code, diagram styles, and the
   canonical write-plan visual layer when the draft is not already using a
   canonical OMP template. In final mode, it removes the visible
   `Plan Status: Final` line from HTML after validating the source marker.

## Required task shape

Every task must name exact Create/Modify/Test paths and symbols, consumed and
produced interfaces, a concrete fixture, focused commands with expected
results, minimal implementation detail or code, and regression tests. Do not
use `TBD`, `TODO`, “add appropriate validation,” “write tests for the above,”
or “similar to Task N.”

## Final delivery

Return the project, topic, confirmation that planning remained read-only, and
both absolute paths as clickable Markdown links:

```markdown
- [Markdown plan](/absolute/path/to/plan.md)
- [HTML plan](/absolute/path/to/plan.html)
```
