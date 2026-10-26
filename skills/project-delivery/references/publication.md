# First publication, live audit and optional assignment follow-up

## Approval package

Before external mutation, read the applicable Linear/repository governance and current mounted tool schemas. The source is the invocation's Markdown/HTML file, never existing project tickets. Resolve the explicitly supplied destination URL, verify the project is empty across all pages including closed/archived issues, and resolve the creation team. If no `--project` was supplied, finish local drafting first and obtain an empty destination before publication; do not create or choose a Linear project implicitly.

Stage all complete exact new-ticket titles/descriptions, creation fields including destination project/team IDs, direct relation additions, protected fields, source coverage, review reports, staffing and operational constraints. Hash descriptions, payloads, graph and ledger. Show every complete body, not just an HTML summary. Record explicit approval of this fingerprinted scope. A destination URL is not approval to create tickets.

Use stable aliases until real returned IDs exist. Approval must explicitly allow narrow mechanical substitution of standalone issue references by returned IDs/URLs; never rewrite source IDs, filenames, hashes or historical references. New ticket defaults must be shown, not copied from the CG case. Pre-existing tickets are not candidates for reuse, splitting or rewriting. If duplicate work or a nonempty destination is found, stop this workflow without external mutations.

Planning approval is not publication approval. Publication approval does not authorize assignments, status changes, comments, unrelated metadata, production operations or relation-type conversion. If a substantive body, boundary, identity or graph changes, restage and obtain renewed exact approval. Do not ask again for an already explicit exact authorized action.

## Guarded writes

1. Persist approved payload identities, destination empty-inventory evidence and an authorization receipt before writing. Record an in-flight action before sending it.
2. Recheck complete destination inventory immediately before the first create and before subsequent creates or recovery. Once this run starts creating tickets, its own receipt-proven issues are expected, not a failed emptiness check. Any unaccounted-for issue or discovered concurrent breakdown is a conflict: pause remaining writes, preserve all work and report it rather than adopting or overwriting it.
3. Before changing one of this run's newly created issues for approved alias resolution, relations or readback correction, reread its full content. Compare identity/title/body/dependencies with the last verified own write. Preserve unrelated drift and stop on concurrent human edits. Never target pre-existing issues for title/body/assignment changes.
4. Create complete descriptions in topological order. Persist each returned UUID/ID/URL immediately. Complete alias-bearing descriptions may be followed by the approved resolution pass; do not create empty stubs. Use exact current-content guards where supported, without claiming transactional protection for the whole publication.
5. After an uncertain creation, search and inspect exact identity/content/creation evidence before retrying. Recovery is only for this run's interrupted first publication. A similar issue is not proof that it is yours; unresolved attribution blocks retry, and another human's issue cannot be reused.
6. Apply only approved relation additions using current API semantics. Preserve unrelated relationships. External prerequisite references may be represented by approved blocker additions on the new consumer; never rewrite the external issue's scope or ownership.
7. Read back each full body, project/team membership, protected field and relation after each write. Store expected resolved, transport and raw stored hashes separately. A success-shaped response is not persistence proof.
8. If persistence mismatches, reread and exclude concurrent/unknown third states. Correct only this run's created issues to approved exact intent. Do not invent caching/eventual-consistency explanations or automatically delete partial publication.

If the available API cannot preserve two relationship types on one pair, stop that conversion, restore unapproved loss where safely attributable to this write, enumerate exact pairs and obtain narrow precedence authorization. Never silently discard unrelated relationships or infer blocker semantics from related links.

Keep durable publication-state with intended/completed writes, returned identities, readback paths, hashes, corrections and remaining conflicts. Partial publication stays partial. Preserve all human work.

## Markdown preservation

Inspect new mismatches before broadening normalization. Allow only observed presentation equivalents: known list/spacing/table separator/autolink formatting. Independently preserve fenced block language/content, inline technical literals, command sequences, link targets, numeric limits, permissions, paths and identifiers.

An editor converting a Redis `:lock:` substring to an emoji or underscores in a filename to emphasis is technical corruption. Protect the exact approved literal with code formatting where appropriate, then reread and verify; never normalize it away. Do not import case-specific exception lists into a new project without evidence. Save normalization rules and raw hashes as separate evidence.

## Separate fresh live audit

After the last description/relation mutation, automatically audit without asking for another read-only audit approval:

1. Fresh complete paginated inventory and full affected issue reads, with request/response timestamps.
2. Resolve newly created identities through this run's durable creation receipt; account for every destination issue and flag any unexpected concurrent addition.
3. Independently reconstruct incoming `blockedBy` and reciprocal outgoing `blocks` graphs.
4. Extract prerequisites and consumed implementation/fixture/generator/check inputs from actual full published bodies, including appendices.
5. Compare native graphs, semantic graph and approved resolved parent sets exactly, not by counts.
   Check the top-of-ticket execution-metadata table against those same live predecessor/successor sets and the approved lane queue. Verify resolved links, concrete artifact/acceptance references, and the separation of preparation, landing, scheduling preference and operational authority. Reject copied current-status readiness claims or a requirement to consult the HTML to choose work.
6. Check self/duplicate/dangling edges, external endpoints and reachable external constraints/cycles; validate promised independent groups.
7. Verify exact source identities/digests/occurrences, fragment ownership, contract inventories, substantive witnesses, titles, created identities, destination project/team membership, technical literals/code blocks and protected fields.
8. Obtain independent fresh semantic/native and coverage verdicts on this new bundle, not cached draft PASS reports.
9. Save final-audit.md with actual links, observed edges/waves, timestamps, input fingerprints, findings and precise PASS/FAIL scope.

A publication mismatch may be corrected only to already approved intent after excluding concurrent changes, followed by the complete affected fresh audit. A new substantive boundary or human edit needs reconciliation and approval. Do not call publication complete while audit fails. No code merge, tests, deployment or ticket status transition is implied by publication PASS.

## Optional final assignment question

After successful ticket creation, complete readbacks and the fresh audit, deliver the completed guides and ask one final optional plain-text question. Enumerate the actual N labels: `Developer A (lead)`, `Developer B`, `Developer C`, and so on (`AA`, `AB`, ... after `Z`). Example for three developers:

> Which Linear user should I assign to Developer A (lead), Developer B and Developer C? Reply with names, emails or Linear user IDs for any lanes you want assigned; you can ignore this and leave assignments unchanged.

Do not ask while drafts are unpublished or publication is incomplete/failed. Do not make the question a blocking approval gate: mark publication complete, save `assignment-question.json`, and yield normally. No answer, “skip”, or “leave unassigned” means no assignment changes and no repeated reminders. Keep the creation defaults already approved, normally unassigned.

Save the exact question, project/workspace identity, stable lane letters/labels, each lane's complete created-ticket UUID set, manifest fingerprint, current assignee baseline and publication/audit receipts. This lets a later answer continue safely without needing the destination to be empty again. It is not permission to discover and assign arbitrary existing project tickets.

## Follow up when the human answers

1. A reply such as `A = Michael; B = Colin; C = Vinh` explicitly authorizes assignee-only mutations for the displayed lanes in this run. Do not ask for a second generic approval. Partial mappings authorize only those lanes; omitted lanes and explicit skips remain unchanged. If the reply cannot be mapped unambiguously to lanes, clarify only that ambiguity.
2. Resolve each named person/email/ID through the current Linear workspace to a unique active user. Use returned IDs, not guessed matches. Clarify duplicate names, inactive/missing users or an unknown lane; do not silently choose or substitute. Unambiguous authorized lanes can proceed while unresolved lanes remain unchanged.
3. Load the saved lane-to-created-ticket mapping and verify it against the manifest and creation receipt. Include every internal ticket owned by the selected lane, including A's lead-owned foundation, integration, QA and cutover tickets. Exclude external prerequisite nodes. Do not repartition the plan based on a person's identity. If one person is explicitly assigned multiple lanes, honor it and state that those lanes no longer represent simultaneous capacity.
4. Read each ticket immediately before writing. Verify it is a recorded issue from this run in the intended project. If it already has the requested assignee, record it as verified without a redundant write. If another person changed its assignee since the saved baseline, preserve that change and clarify the affected conflict rather than overwriting it. Preserve all current non-assignee fields.
5. Send only the issue identifier and assignee field. Do not resend titles, descriptions, status, labels, priority, project/team, estimates, comments or relationships. Read back the complete issue and verify the actual assignee ID and all protected fields, including exact body and dependencies. A successful API response alone is insufficient.
6. Perform a fresh aggregate verification over all mapped tickets and record authorization text, resolved users, per-ticket before/after evidence, verified no-ops, unresolved lanes and results in `assignment-receipt.json`. Preserve earlier unassigned publication evidence as historical; never rewrite it.
7. Report verified assignments and concrete unresolved conflicts. If an API call fails or times out, reread first and resume only incomplete authorized changes from the receipt. Do not declare the whole mapping complete until verified. Do not ask the broad optional question again.

This follow-up is part of the same first-generation run, even if answered later. It is the sole exception to the ban on standalone reassignment workflows. It grants no production authority, including for Developer A (lead). The existing guide's lane letters remain stable; any displayed real-user mapping must be backed by the new receipt, not substituted into historical approvals.

## Final first-publication presentation

Use this run's approved/resolved content and returned identities to generate the final Markdown/HTML pair. Hash protected payloads, source bodies, manifests and receipts before/after this step. Never rewrite the approval Markdown to match a refreshed view. Label approval context and proposed/verified staffing accurately. Report only exercised checks and remaining operational gates. Presentation-only maintenance of an older breakdown is not a mode of this skill.
