---
name: tech-doc
description: "Explain how a software feature works by tracing its current implementation, presenting the important boundaries and user journey, and saving a concise technical HTML document. Use when another developer asks how a feature works or needs an implementation-oriented system walkthrough."
---

# Technical Documentation

Invocation:

```text
/tech-doc <feature or behavior>
```

Produce one self-contained HTML document. Do not create a Markdown companion, modify repository code, open a ticket, or send an external message.

## Workflow

1. Inspect the repository and its local `AGENTS.md`/`RULES.md` instructions. Trace the feature from its user-visible entry point through the relevant handlers, use cases, adapters, persistence, events, and tests. Prefer current source and tests over assumptions.
2. Build a reader-first explanation. State what the feature does in plain language, then describe the key components, contracts, ownership boundaries, and important failure or state transitions. Separate verified facts, inferences, and unknowns when that distinction matters.
3. Fill `/Users/michael/.omp/agent/skills/tech-doc/assets/template.html`. Preserve its `data-template`, semantic section IDs, `main.content`, `nav.toc`, and footer structure. Replace every placeholder and keep the page compact.
4. Include at least one useful diagram for the main interaction or architecture. Prefer a self-contained `<pre class="mermaid" data-caption="...">` block; the saver renders it to inline SVG, so the final artifact must not depend on a CDN or viewer build step. Use nearby prose to state the diagram's takeaway.
5. Describe the user journey as an ordered list of observable steps. Include the initiating action, the main system transitions, the user-visible result, and relevant error/retry behavior when known.
6. Save the completed document with:

   ```bash
   node /Users/michael/.omp/agent/skills/tech-doc/scripts/save-final-tech-doc.cjs \
     --source "<absolute filled template path>" \
     --project "<project>" \
     --topic "<short topic slug>" \
     --canonical
   ```

   The default output directory is `~/.omp/tech-docs/<project>/`; set `OMP_TECH_DOCS_DIR` only when a different local output root is required.
7. Return the saved absolute HTML path and a brief statement of what the document covers. If a part of the behavior could not be verified, name the gap rather than presenting it as fact.

## HTML contract

- Use the shared canonical OMP HTML layer through `data-omp-plan-styles` in the template and `finalizeHtml(..., { planStyles: true })` in the saver. This is the same underlying contents-rail and reading-shell style layer used by `/write-plan`; do not add a competing palette or theme implementation.
- Keep the document sections to the essentials: a header/title and short summary, how it works, diagrams, user journey, and the dated footer. Supporting code paths or caveats belong in the relevant section, not in a separate long appendix.
- Keep `nav.toc` labeled exactly `Contents` and link it to the document's main sections. The canonical finalizer adds responsive navigation state and diagram zoom/pan controls.
- Use inline CSS only through the canonical layer. The final HTML must be readable with JavaScript disabled and must contain no raw Mermaid blocks.

## Boundaries

- Repository exploration is read-only. `/tech-doc` explains existing behavior; it does not design a future implementation or silently fix code.
- Do not claim runtime behavior, deployment state, or user-visible outcomes that the inspected repository cannot establish. Label live/runtime gaps explicitly.
- Stop after the HTML artifact is saved. Do not transition into `/brainstorm`, `/write-plan`, ticket creation, or implementation.
