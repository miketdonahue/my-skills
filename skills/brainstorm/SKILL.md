---
name: brainstorm
description: "Autonomously analyze a software-engineering problem, select one recommended direction, run a bounded adversarial review, and save a finalized HTML brainstorm."
---

# Autonomous Brainstorm

Invocation:

```text
/brainstorm <description>
```

This workflow is intentionally non-interactive. Explore silently, decide
internally, and complete the adversarial review without asking the user to
choose an option or approve a design.

Resolve `SKILL_DIR` to `/Users/michael/.omp/agent/skills/brainstorm` when running
the bundled scripts.

Use `/Users/michael/.omp/agent/skills/brainstorm/assets/template.html` as the
starting point for every HTML draft. It is the canonical OMP brainstorm layout;
do not invent a new page structure or fall back to a flat Markdown-to-HTML
conversion.

## Hard boundaries

- Repository exploration is read-only. Never edit repository files, create a
  branch/worktree, implement code, create a ticket, or send an external message.
- Never ask a pre-plan clarification question or wait for design approval.
- Always select exactly one recommended outcome. That outcome may be
  `Do Not Proceed` when the idea is infeasible, unsafe, out of scope, lower
  value than the status quo, or otherwise not worth implementing. Rejected
  alternatives and the reason for rejecting them must be recorded in the
  brainstorm. Never invent a positive implementation path just to continue.
- Do not mark a brainstorm `Status: Aligned` when a legitimate open question
  requires a human decision before the recommendation can be planned. Use
  `Status: Stalemate` and list the exact unresolved decision instead.
- An aligned brainstorm may still include an `Open questions` section, but each
  item must be framed with the recommended direction, current assumption,
  default owner, and revisit trigger. It must not read as a blocking choice the
  human still needs to make before planning.
- A reviewer failure, malformed channel, hub failure, unresolved Critical
  finding, or exhausted review budget is `Status: Stalemate`, not alignment.
- Stop after saving the brainstorm. Do not invoke planning, ticket creation, or
  implementation from this skill.

## Automatic brainstorm workflow

1. Inspect the repository, nested `AGENTS.md`/`RULES.md` files, relevant code,
   tests, documentation, recent history, and the user's referenced material.
   Decompose scope and identify constraints silently.
2. Compare viable approaches internally. Select the recommended approach using
   repository evidence, feasibility, scope, compatibility, security, and test
   impact. Do not ask the user to select an approach.
3. Create a complete working HTML draft under
   `~/.omp/brainstorms/<project>/.working/<session>/draft.html` by filling the
   canonical template. The first viewport must show the title and lede. Keep
   the recommended option prominent in the options section. Keep adversarial review detail in
   the append-only review channel and final handoff rather than rendering a
   separate review section in the HTML. The recommendation must never appear
   for the first time in a later section.
4. Preserve the template's hierarchy and semantic markers:
   `data-template="omp-brainstorm-v2"`, `data-section="decision"`,
   `data-section="problem"`, `data-section="options"`,
   `data-section="evidence"`, `data-section="approach"`,
   `data-section="risks"`, and `data-section="questions"`. Keep one clear
   heading per section. Every `.steps .step` must retain exactly two direct
   children in order: `.step-marker`, then `.step-body`. Close the marker
   before opening the body; never introduce a wrapper that changes this
   structure.
5. Populate the template with the problem, goals, constraints, non-goals,
   selected recommendation, rejected alternatives, assumptions, evidence,
   risks, open questions, architecture, data flow, and success criteria.
   Separate observed facts, inferences, and unknowns explicitly. For an aligned
   outcome, write open questions as planned assumptions or follow-up validation
   checks with a stated direction; if any question remains a required human
   decision, mark the brainstorm `Status: Stalemate`.
   When architecture, data flow, state transitions, ownership boundaries, or
   cross-service interactions would be materially clearer visually, include a
   polished self-contained diagram in the HTML. Prefer Mermaid source blocks
   for sequence, state, architecture, and flow diagrams because the save helper
   renders them to inline SVG for the final artifact.
6. Run the HTML self-review. Fix placeholders, contradictions, unsupported
   claims, broken references, scope drift, and missing decisions inline.
   Confirm that every aligned open question has a stated direction and is not a
   hidden blocker.
7. Initialize the append-only adversarial channel:

   ```bash
   node "$SKILL_DIR/scripts/adversarial-review-channel.cjs" init \
     --project "<project>" --draft "<absolute draft path>"
   ```

   Append Main Turn 1 before dispatching the reviewer. Include the selected
   recommendation, decision, assumptions, evidence, and draft path.
8. Dispatch exactly one non-isolated `task` with `agent: adversarial-review`.
   Give it the absolute draft, repository root, project, channel, and round.
   It must read the HTML completely, inspect relevant repository context, and
   append only its own response through the channel helper. It must classify
   findings as `Critical`, `Consider`, or `Nice-to-Have`, and include
   `Reference`, `Issue`, `Proposed Change`, and `Reason` for every finding.
   It must also independently assess whether the selected outcome should be
   `Proceed` or `Do Not Proceed`.
9. Read the complete channel after every reviewer response. Append the main
   agent's rebuttals, accepted/rejected/deferred dispositions, rationale, and
   actual draft revisions before the next review. Wake the same reviewer with
   `hub send` for later rounds; never spawn a replacement.

   ### Mutual rejection fast path

   Do not force convergence toward implementation. If the main agent's
   recommendation is `Do Not Proceed` and the reviewer independently agrees,
   or the reviewer recommends `Do Not Proceed` and the main agent accepts that
   conclusion, stop after the current reviewer response. The reviewer must
   write both:

   ```text
   VERDICT: ALIGNED
   DECISION: DO NOT PROCEED
   ```

   The main agent must append a final response confirming the same decision,
   with the evidence and rationale. Do not run Reviewer Turns 2 or 3, do not
   soften the conclusion into a positive recommendation, and do not create a
   plan, ticket, implementation, update, or handoff from this result. In the
   final HTML, make the outcome prominent with `Decision: Do Not Proceed` and
   explain why. `Status: Aligned` means the agents agree on the conclusion; it
   does not mean implementation was approved.

   The fixed maximum is:

   ```text
   Main 1 -> Reviewer 1 -> Main 2 -> Reviewer 2 -> Main 3 -> Reviewer 3
   ```

   Stop early when either the mutual-rejection fast path applies, or the
   reviewer writes `VERDICT: ALIGNED` for a viable recommendation and the main
   agent agrees that no unresolved Critical issue remains. Otherwise stop
   after Reviewer 3 and mark the report `Status: Stalemate`.
10. Record status with the helper, update the final report with the reviewer
   findings and dispositions, and save it using `save-final-html.cjs
   --canonical`. That helper must use the shared HTML finalizer at
   `/Users/michael/.omp/agent/lib/html-document.cjs` for Mermaid rendering and
   light/dark code and diagram theming. The
   saved HTML does not render review status metadata. Preserve the review
   channel and record the final status in the handoff.

## Adversarial channel contract

The channel is always:
`~/.omp/brainstorms/<project>/adversarial-review/<hash>.md`.

It is append-only and must contain session metadata, the initial draft path,
rounds, reviewer responses, main responses, finding dispositions, and the final
`Aligned` or `Stalemate` verdict. The hash combines the canonical draft path
with a per-session nonce. The reviewer may not edit the HTML or repository.

Material clarification that changes the selected direction starts a new
brainstorm run and channel. Wording-only or cosmetic changes do not restart the
loop. Reviewer failure and non-alignment are preserved and passed into planning
rather than discarded.

## HTML content and hierarchy rules

Borrow the reader-first discipline from the repository proposal skill, but keep
the brainstorm focused on a decision rather than a product pitch:

- Open with one plain-language sentence explaining what is happening, who is
  affected, and what decision is being made.
- Show one concrete current-state example before deep architecture, file lists,
  or code.
- Keep the hero focused on the title and lede. Do not render a separate status,
  project, date, or decision metadata row. Make the recommended option
  prominent in the options comparison without duplicating it in a separate
  hero card. Keep section navigation visually separated from the hero with a
  compact purple `Navigation` label and no enclosing top or bottom rules.
- Keep typography on the canonical scale: 13px minimum for every generated
  document text element, 15px base body text, 16px emphasis text, and the
  template's standard heading hierarchy. Do not force uppercase outside
  numbered section labels, and do not introduce one-off font sizes.
- Use cards for the executive summary, option pros/cons, evidence categories,
  and open questions. Keep the recommended option expanded and prominent; keep
  rejected alternatives compact, moving exhaustive trade-off detail into the
  comparison table or a supporting `<details>` block. Always lay out option
  cards in one column so the recommended and rejected directions share the same
  readable width. Keep pros/cons panels subtle: neutral surfaces with colored
  headings only, not semantic fills or side borders. Use tables for comparable
  criteria, risks, file impact, and reviewer findings.
- Use numbered steps for flows and `<details>` accordions for supporting
  evidence, architecture, code, long tables, and round-by-round review logs.
  Keep important conclusions outside collapsed sections.
- Use diagrams when they make architecture, data flow, ownership, lifecycle
  state, or option trade-offs easier to understand than prose. Prefer Mermaid
  for standard sequence, state, flowchart, and component-boundary diagrams.
  Write Mermaid as `<pre class="mermaid" data-caption="Short takeaway">...</pre>`;
  the final save helper renders it to inline SVG and keeps the source in a
  collapsed detail. Use hand-authored inline SVG only when Mermaid cannot
  express the layout clearly. HTML/CSS diagrams and ASCII diagrams in `<pre>`
  are acceptable for simple flows.
- For CodeRabbit-style sequence diagrams, use `sequenceDiagram` with explicit
  `participant`, `alt`, `opt`, `rect`, and `Note over` blocks. Keep participant
  names and message labels short enough to fit without wrapping, put the
  decisive takeaway in `data-caption`, and avoid decorative frames that do not
  clarify the decision.
- Final HTML must not rely on client-side Mermaid, CDNs, local assets, or a
  viewer build step. If a draft contains Mermaid source, `save-final-html.cjs
  --canonical` must render it to inline SVG or fail visibly.
- Make every diagram readable in both light and dark mode, responsive on mobile
  and fit horizontally by default, with helper-owned zoom controls available for
  closer inspection. Pair each diagram with nearby prose that states the
  takeaway. Keep labels short, use the template diagram classes when possible,
  and avoid decorative diagrams that do not clarify a decision.
- Keep smaller screens usable: collapse card grids at tablet and phone widths,
  contain wide tables within their own horizontal scrollers, and allow long
  code paths and identifiers to wrap without causing page-level overflow.
- Use short paragraphs, descriptive headings, and visible labels. Avoid a
  sequence of generic numbered headings such as `1. Problem`, `2. Goals`.
- The document should tell a coherent story in this order: decision, problem,
  options, evidence, recommended direction, risks/limits, and open questions.
- Use inline CSS and no required local assets or build step. The theme toggle
  is optional, but the document must remain fully readable with JavaScript
  disabled.
- Remove every template placeholder, empty card, unused section, and gallery
  example before saving. Do not include raw template comments in the final
  artifact.

## Final delivery

Return the human-readable terminal handoff using
`/Users/michael/.omp/agent/skills/brainstorm/assets/final-delivery-template.md`
as the required structure. Do not improvise a different final response.

The handoff must follow this order:

1. `Status: Aligned` or `Status: Stalemate` on the first line.
2. `Brainstorm:` followed by the absolute HTML path as a clickable Markdown
   link and the matching `file:///` path on the next line.
3. `Review channel:` followed by the absolute append-only channel path.
4. A visible separator.
5. `### Recommendation: <short recommendation>` with the decision stated in
   the first sentence.
6. A short `adversarial review impact` paragraph explaining what was corrected,
   or explicitly stating that no material corrections were required.
7. `### Corrected analysis` containing a compact `Claim / Initial analysis /
   Corrected analysis` table when the reviewer found material errors. If no
   material corrections occurred, use `Evidence / What it shows / Source`
   instead.
8. `### Why this recommendation wins` with one or two evidence-backed
   paragraphs that identify the decisive trade-off.

Summarize the final corrected analysis, never the superseded initial draft.
When findings materially changed the reasoning, explicitly say that the
adversarial review caught and corrected those errors before stating why the
recommendation still wins.

For `Do Not Proceed`, preserve the same structure but state that plainly. For
`Stalemate`, replace the recommendation rationale with `### What remains
unresolved`, listing the blocker, competing interpretations, and exact human
decision required.

Return a concise Markdown summary containing:

- `Status: Aligned` or `Status: Stalemate`;
- `Decision: Proceed` or `Decision: Do Not Proceed`;
- the absolute brainstorm HTML path as a clickable Markdown link;
- the review-channel path;
- blockers, when applicable.

Do not claim final agreement for a Stalemate report. Do not create Jira/Linear
tickets, write a plan, or transition to implementation from this skill.
