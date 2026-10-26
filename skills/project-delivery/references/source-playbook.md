# Large-project ticketing and developer execution playbook

## Purpose and status

This document captures the workflow, decisions, corrections, reviews, verification, publication, presentation design and assignment process used to restructure the Connector Gateway migration. It is intended as the source material for a future repeatable skill that can plan a large project for **N developers**.

**Captured:** 2026-10-22.

**This is a process playbook and retrospective, not an installed skill, an implementation plan for a new project, or evidence that the Connector Gateway product migration has shipped.**

The central outcome was not merely an attractive HTML document. It was an evidence-backed set of complete tickets, a technically valid dependency graph, a comprehensible staffing plan, verified tracker state, and a readable execution guide.

The final guide is here:

[Connector Gateway - three-developer execution guide](file:///Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local/cg-restructure-publication-plan.html)

### The most important lesson

**Keep these five things distinct:**

1. **Requirements:** everything the project must preserve or deliver.
2. **Technical decomposition:** which ticket implements each behavior and produces each consumed artifact.
3. **Dependencies:** what implementation must exist before another ticket can land.
4. **Staffing:** which developer handles each ticket, and in what suggested personal sequence.
5. **Operational authorization:** what may actually be promoted, migrated, drained, deleted or retired after QA.

Confusing these creates circular tickets, false parallelism, accidental scope expansion, misleading schedules and unsafe cutovers.

---

## Contents

1. [The repeatable workflow](#1-the-repeatable-workflow)
2. [Inputs and scope contract](#2-inputs-and-scope-contract)
3. [Freeze the complete current state](#3-freeze-the-complete-current-state)
4. [Create a lossless requirement ledger](#4-create-a-lossless-requirement-ledger)
5. [Decompose by real technical boundaries](#5-decompose-by-real-technical-boundaries)
6. [Construct the real dependency graph](#6-construct-the-real-dependency-graph)
7. [Separate migration work, QA and cutover](#7-separate-migration-work-qa-and-cutover)
8. [Write complete executable tickets](#8-write-complete-executable-tickets)
9. [Schedule work for N developers](#9-schedule-work-for-n-developers)
10. [Use independent reviews](#10-use-independent-reviews)
11. [Validate mechanically, including negative controls](#11-validate-mechanically-including-negative-controls)
12. [Produce an understandable HTML execution guide](#12-produce-an-understandable-html-execution-guide)
13. [Stage and obtain exact-content publication approval](#13-stage-and-obtain-exact-content-publication-approval)
14. [Publish with concurrency protection and durable receipts](#14-publish-with-concurrency-protection-and-durable-receipts)
15. [Handle tracker and Markdown behavior safely](#15-handle-tracker-and-markdown-behavior-safely)
16. [Run a separate fresh live audit](#16-run-a-separate-fresh-live-audit)
17. [Assign named developers only when authorized](#17-assign-named-developers-only-when-authorized)
18. [What actually happened in the Connector Gateway case](#18-what-actually-happened-in-the-connector-gateway-case)
19. [Verification and evidence inventory](#19-verification-and-evidence-inventory)
20. [Failure modes and recovery rules](#20-failure-modes-and-recovery-rules)
21. [Definition of done](#21-definition-of-done)
22. [Suggested future skill contract](#22-suggested-future-skill-contract)
23. [Execution checklist](#23-execution-checklist)
24. [Reference artifacts and reproducibility](#24-reference-artifacts-and-reproducibility)

---

## 1. The repeatable workflow

The general sequence is:

1. Establish the requested scope and mutation permissions.
2. Retrieve the complete current project, tickets, descriptions, metadata and relations.
3. Freeze that source before rewriting anything.
4. Inventory every substantive requirement, contract, caller, fixture, command and safety condition.
5. Inspect the actual implementation boundaries that determine dependencies.
6. Propose bounded implementation owners and a direct dependency DAG.
7. Separate component merge proof, integrated QA, and operational cutover.
8. Assign proposed primary developers without inventing dependencies or estimates.
9. Write full ticket descriptions and trace every source obligation into them.
10. Run independent semantic and coverage reviews, repair findings, and re-review the changed content.
11. Exercise positive graph checks and deliberately invalid negative controls.
12. Generate the human-facing guide and inspect the actual rendered surface.
13. Show the exact proposed external changes and obtain explicit approval.
14. Publish in a controlled order, persist returned identities, and read back every change.
15. Automatically run a separate fresh audit of the final live state.
16. Refine the document's presentation without silently changing approved ticket content.
17. Resolve and assign real users only after the human authorizes the mapping.
18. Verify the named assignments and all protected fields.

This is not an instruction to ask for permission after every internal step. Research, drafting and local verification can proceed within the approved scope. The important approval boundaries are **external mutations, substantive changes to approved content, and materially new tradeoffs**.

### Two completion states

- **Plan published:** the tracker contains the approved descriptions and relations, and the live audit passes.
- **Product delivered:** the actual implementation, tests, QA, release evidence and authorized operational work have completed.

Publishing a ticket does not satisfy its implementation prerequisites. A planning audit does not establish product readiness.

## 2. Inputs and scope contract

A future skill should accept or resolve these inputs:

| Input | Purpose |
| --- | --- |
| Project name and tracker identity | Establish the exact project and issue namespace. |
| Existing tickets or approved source material | Identify the authoritative starting requirements. |
| Repository and external repository roots | Inspect real producer/consumer boundaries. |
| Number of developers, N | Plan resource allocation without forcing N artificial ticket slices. |
| Optional developer names or specializations | Propose or perform authorized assignments. |
| Identity preservation policy | Decide which issue identities must survive and whether bounded new tickets are permitted. |
| Existing work status | Avoid repurposing work that has started, shipped or been approved separately. |
| Required acceptance and rollout contracts | Preserve what must be proven and what must remain live. |
| Mutation permissions | Separate local planning, publication, assignments and production operations. |
| Output locations | Make artifacts durable and discoverable. |

Do not ask the human for information already available from the tracker, repository, source documents or current instructions.

### Scope modes

Distinguish at least:

- Greenfield decomposition from a large specification.
- Restructuring existing unstarted tickets.
- Planning residual work around partially implemented or shipped tickets.
- Documentation/presentation changes only.
- Assignment changes only.

The workflow must adapt to the mode. The Connector Gateway case mostly restructured existing unstarted tickets, then performed separately authorized presentation and assignment updates.

### Mutation boundaries

A planning request does not automatically authorize:

- Creating or rewriting live tickets.
- Changing assignees or statuses.
- Adding labels, priorities, parents or estimates.
- Replacing relationship types.
- Posting comments or external messages.
- Committing or pushing code.
- Starting application services or running migrations.
- Changing flags, deployment holds, registrations or production traffic.

Use the applicable repository and tracker rules. In this case, exact-content approval was mandatory before publication. The later explicit instruction naming Michael, Colin and Vinh authorized the concrete assignments from the already displayed queues; it did not require asking the same question again.

## 3. Freeze the complete current state

### Read the full project, not a search preview

For every affected ticket, capture:

- Human-readable ID and immutable UUID.
- Title and complete description.
- URL and `updatedAt`.
- Status, started/completed indicators and archive state when relevant.
- Assignee identity.
- Team, project, parent, labels, priority and estimate.
- Native `blockedBy`, `blocks`, related and duplicate relationships.
- Relevant attachments, documents and other fields that must be protected.

Retrieve the entire project inventory, including closed/archived work when checking duplicates. Handle every page.

A project search's shortened description is not an adequate source for rewriting a technical ticket.

### Recover truncated tool output

Large ticket descriptions exceeded the tool's displayed response size during this run. The full tool response artifacts were recovered and parsed instead of treating the truncated display as the complete description.

The environment exposed a truncation artifact through tool response metadata. The exact path is environment-specific; the general rule is:

1. Detect truncated or invalid JSON rather than accepting a partial object.
2. Retrieve the full response artifact using its real returned identifier.
3. Parse the complete response.
4. Save the full source and its digest.

Do not guess artifact identifiers or silently continue with an ellipsis.

### Freeze before drafting

Save an immutable baseline and a human-readable source body per issue. Record:

- Exact source description bytes and SHA-256.
- Metadata and relationship snapshots.
- Collection timestamps.
- The identity of the authoritative source.

Reconcile differences from older plans. Live human edits and existing delivered work take precedence over a stale planning snapshot.

If work has already started or shipped, preserve its delivered scope. Plan residual changes rather than pretending that the ticket can be freely repurposed.

### Portable persistence

Do not rely on retained Eval variables or a prior session's `local://` resolver. Record durable absolute paths and a resumable artifact index. Keep important source and publication receipts on disk.

An in-memory object is convenient, but it is not a recovery strategy.

## 4. Create a lossless requirement ledger

### Inventory obligations, not just headings

Capture every substantive:

- Implementation task.
- Acceptance assertion.
- API operation and permission rule.
- Caller or migration-disposition row.
- Data/wire contract.
- Constructor or service interface.
- Fixture and lifecycle requirement.
- Executable verification command.
- Generator version, checksum, option and output ownership rule.
- Rollout, rollback, coexistence or deletion condition.
- Substantive appendix requirement.

Preserve exact numerical limits, units, configuration names, permissions, status values and path/method tuples. Generic summaries are not substitutes for these details.

### Stable identity

Assign source IDs and source digests **before** drafting. Do not delete or renumber frozen source IDs to make coverage pass.

A useful record includes:

```json
{
  "id": "SOURCE-001:stable-unit-id",
  "sourceIssue": "SOURCE-001",
  "sourceHeading": "Implementation / storage semantics",
  "sourceOrdinal": 12,
  "sourceText": "The complete immutable source obligation.",
  "sourceSha256": "sha256-of-exact-sourceText",
  "implementationOwner": "TICKET-ALIAS",
  "mergeVerificationOwner": "TICKET-ALIAS",
  "integrationVerificationOwner": "INTEGRATION-ALIAS",
  "destinationSection": "TICKET-ALIAS / exact actual heading"
}
```

The strings in this example illustrate a schema, not actual issue identities or fabricated hashes.

### Compound source records need explicit fragments

A source paragraph may mix several behaviors. For example:

- A reusable helper belongs in a shared-service delivery.
- Its request-specific orchestration belongs in a feature delivery.
- The full end-to-end assertion belongs in integration.

Do not falsely assign the entire paragraph's implementation to one ticket. Preserve the frozen source record and attach bounded fragments with:

- A precise behavior/scope statement.
- One implementation owner for that behavior.
- Its merge verifier.
- Its downstream integration verifier, if any.
- The actual destination issue and heading.
- Concrete rendered witness parts.

If a scalar primary owner remains for indexing, explicitly say that the concrete fragment owners are authoritative for compound records.

### Duplicates and repeated contracts

Preserve repeated source occurrences and point them at the canonical requirement. Do not count repeated copies as independent behaviors or discard the references.

In this case, 7,506 fixed requirement records corresponded to 7,589 occurrences, including 83 duplicate-occurrence references. Those counts describe the inventory's granularity, not the number of independent product features.

### Concrete coverage, not nominal coverage

These are not sufficient proof:

- A destination heading exists.
- A source ID appears somewhere.
- A row points to a generic responsibility table.
- The number of requirements has not changed.

A valid destination must contain the actual obligation with the correct implementation and proof owner.

This run initially had hundreds of broad reconciliation destinations. They were replaced with source-specific bounded clauses and actual witnesses. Independent review also found real configuration and measurement details that had been incorrectly dismissed as boilerplate.

### Nonadjacent and clipped witnesses

Store nonadjacent exact witnesses as separate parts. Do not join them with blank lines and then require that the artificial concatenation appear contiguously in the published document.

A snippet cut inside a Markdown table row or a code span can also normalize differently from the whole document. Verify such cases in their exact approved whole-line context. Do not weaken the underlying requirement or rewrite evidence merely to satisfy a substring check.

## 5. Decompose by real technical boundaries

### Ticket count follows architecture, not headcount

Do not start with “three developers means three tickets.” Identify genuine independently landable deliverables first, then staff them.

A typical decomposition may include:

- Pure contracts and ownership boundaries.
- Infrastructure and resource factories.
- Reusable domain/service primitives.
- Generated access clients and adapters.
- Shared application projections/helpers.
- Scoped capability implementations.
- Transport or browser boundaries.
- Runtime composition and integration fixtures.
- Consumer migrations.
- Integrated acceptance.
- Authorized cutover and retirement.

These are useful categories, not mandatory empty layers for every project.

### Inspect actual producers and consumers

Trace:

- Static imports and constructors.
- Required dependencies and exports.
- Runtime factories and process roots.
- Both the producing and receiving sides of callbacks/events.
- Generated schema/client ownership.
- Existing caller signatures and all affected consumers.
- Test, fixture and command imports.

Read the applicable repository and area instructions before inspecting or changing source. Use language-server references for implementation-time symbol/callsite changes where available. Do not rely only on broad filename searches.

In the Connector Gateway case, actual source inspection established that:

- The profile dispatcher statically imported both user and admin workflows. A partial class was not a legitimate independent delivery.
- Callback dispatch depended on both profile and custom-connector completion branches. The whole callback join therefore belonged after both capabilities.
- A discovery conversion adapter depended only on pure DTOs and could be delivered before the builder workflow.
- A Microsoft Graph identity helper was a pure move, not a reason for profiles to depend on the trigger migration.

### One implementation owner per behavior

Shared responsibility means one authoritative implementation, not exclusive permission to touch a file.

Allow ordinary, coordinated edits to canonical shared files. Do not allow every ticket to “implement missing dependencies as needed.” That policy hides the real graph and causes duplicated services, scope expansion and circular work packages.

Where several phases extend one registry or README, identify the bounded contribution/region and its producer rather than claiming that each ticket owns the whole file.

### Keep source paths and target paths distinct

Every artifact should be classified as one of:

- Existing source evidence.
- An actual unchanged available input.
- A proposed new implementation target.
- An existing target being modified.
- A generated output with an authoritative generator.
- A specific later contribution to a shared file.

Normalize aliases to real canonical paths before validating producers. A relative source filename is not automatically a proposed file at the same new-host path.

The reviews caught phantom new outputs created by treating old MCP recovery/search/profile source locations as new target paths. Correcting artifact identity did not require changing the approved dependency edges.

### Separate pure contracts from runtime assembly

Where source closure permits it, deliver pure schemas and DTOs before runtime composition. Pure emission/import must not instantiate services, parse runtime environment, allocate resources or import later capability factories.

Do not force this decomposition when the real contracts are still unknown. Resolve the typed contract or restage the partition rather than inventing a pure foundation that cannot exist independently.

### Stage generators and CI with real producers

A check can become mandatory only when its actual producer exists.

In this case:

1. Foundation owned complete private schema emission/drift.
2. Generated access owned the real pinned Python generation/drift stage.
3. The HTTP boundary owned public projection/drift.

Never register a future generator as a required foundation check, skip it to make the foundation green, or hand-edit generated output.

## 6. Construct the real dependency graph

### Edge meaning

`A -> B` means B requires A's delivered implementation/artifact to satisfy B's merge acceptance.

Do not add an edge merely because:

- The descriptions mention each other.
- The same developer works on both.
- One person should review another person's work.
- An integration test will rerun the behavior later.
- Two tickets edit coordinated regions of the same file.
- A downstream production action requires future authorization.

Native blockers should represent the approved direct dependency set. Do not duplicate transitive predecessors just to make the graph look comprehensive.

### Account for hidden merge inputs

Inventory the producer of every consumed:

- File or export.
- Service/constructor contract.
- Fixture or preparation script.
- Generator or emitted artifact.
- Verification command input.
- Runtime root needed by the ticket's required proof.

For each consumer, the producer must be:

- The consumer itself.
- An ancestor in the dependency graph.
- Genuinely existing, already available code with a verified source reference.

“Existing code” must not become a label for a future file.

### Topological waves are not a calendar

A topological wave groups tickets whose graph dependencies are satisfied by earlier waves.

It does **not** mean:

- All earlier-wave work must finish before any later-wave ticket can start.
- Every ticket in a wave has the same duration.
- Every parallel-ready ticket can be staffed simultaneously.
- A ticket may land before its own prerequisites or acceptance are satisfied.

The authoritative landing rule is the ticket's direct prerequisites and applicable acceptance/operational gates. Preparation on prerequisite stacks may happen earlier.

### Test independence, do not infer it from counts

For every advertised parallel group, verify that no member is an ancestor of another, then inspect their actual implementation and proof inputs for hidden dependencies.

A graph with the right number of nodes and edges may still be cyclic or serialize work that the document claims is independent.

### External edges

Do not discard native edges to tickets outside the selected set. Fetch those endpoints and traverse reachable prerequisites to detect external constraints or cycles.

If they change the approved schedule, preserve them and reconcile the plan. Do not delete them to force a closed graph.

## 7. Separate migration work, QA and cutover

This distinction was important enough to become a dedicated HTML column.

| Category | Meaning | What it does not mean |
| --- | --- | --- |
| Migration implementation - before cutover | Build complete capabilities, clients, consumers, compatibility and required component/integration behavior. | Unconditional permission to merge into an automatically promoted environment. |
| QA / release gate - before cutover | Exercise the integrated compatible artifact set and confirm readiness, coexistence and rollback evidence. | Production promotion or retirement has already happened. |
| Cutover - after QA approval | Execute separately authorized promotion, traffic switch/drain, maintenance handover and evidence-gated destructive cleanup. | Earlier implementation tickets may omit their own real behavior proof. |

### Three different proofs

1. **Component merge proof:** this delivery works with its real delivered dependencies and controlled external collaborators.
2. **Integrated release proof:** complete real components work together on a compatible immutable artifact set.
3. **Operational authorization and evidence:** the actual target environment, traffic, registrations, drains, rollback point and authorized operators permit the production action.

A controlled external HTTP response can prove the near-side ASGI or generated-client boundary. It does not prove missing internal policy, the real upstream provider, browser end-to-end behavior or production readiness.

Move cross-capability assertions to the integration owner when needed, but preserve their exact behavior and downstream obligation. Do not delete them to remove a graph edge.

### Automatic frontend promotion is a special risk

“Before cutover” is a scope classification, not a universal safety guarantee.

If merging frontend code automatically promotes artifacts, first establish either:

- An actual authorized deployment hold covering the relevant targets/cohorts; or
- Authorized exact-candidate acceptance and promotion against real controlled-environment prerequisites and immutable candidate artifacts.

Do not invent a completed QA-ticket dependency that creates a cycle. The full authorized evidence may precede the QA ticket's own landing, with later merged-artifact equivalence checks and reruns when bytes/config differ.

If neither route is established, state the operational blocker. Do not invent a flag, a fake runtime, an old-host compatibility bridge or unconditional merge permission.

### Cleanup is not all the same

Safe local removal of code made obsolete by the scoped implementation is different from production-evidence-conditioned retirement.

Preserve actual legacy/rollback dependencies until their consumers, pending work, data, callback and operational obligations are closed. Destructive cleanup and authority handover belong at the authorized cutover boundary when they depend on live evidence.

## 8. Write complete executable tickets

A ticket must be implementable from its description and declared prerequisites. A summary card is not enough.

### Recommended description structure

1. **Outcome and problem:** observable behavior being delivered.
2. **Direct prerequisites:** exact ticket IDs and delivered artifacts.
3. **Owned implementation:** files, public contracts, constructors and boundaries.
4. **Scope transfers:** what moved in, what moved out, and where the proof now lives.
5. **Implementation sequence:** concrete production work, not a scaffold.
6. **Fixtures and resource lifecycle:** setup, ownership, readiness, cleanup and failure behavior.
7. **Merge acceptance:** observable assertions using available inputs.
8. **Planned commands:** exact runner, cwd, environment requirements, time bounds and expected observations.
9. **Mandatory downstream acceptance:** exact retained integration scenarios and their owners.
10. **Activation/coexistence/rollback constraints:** what must remain supported and what cannot yet happen.
11. **Source/provenance references:** preserve links without turning historical drafts into active execution instructions.

### Positive instructions must agree everywhere

Review the whole description, including:

- Introductory scope.
- Ownership tables.
- Task bodies.
- Constructor signatures.
- Code blocks.
- Comments before commands.
- Fixtures and test imports.
- Acceptance matrices.
- Rollback sections.
- Copied or generated appendices.

A top-level “do not absorb sibling work” statement does not neutralize a later instruction to “implement the missing generator/provider here.” Repair the actual contradictory clause.

### Avoid incomplete delivery tricks

Do not call a delivery complete using:

- Partial service classes whose imports require future workflows.
- Optional registries or conditional imports hiding missing implementations.
- Dummy enabled modules, fake readiness or no-op providers.
- Type-only shells standing in for behavior.
- Mock echoes or forwarding-only tests presented as policy/release proof.
- Generated-code shims, duplicate clients or handwritten generated output.
- Broad historical ownership exceptions authorizing any ticket to implement another ticket's scope.

## 9. Schedule work for N developers

### Keep three ownership models separate

- A **requirement's implementation owner** is a ticket.
- A **ticket's primary developer** is a staffing assignment.
- A **shared-file contact or reviewer** is not automatically a dependency or an assignee.

Changing a person should not silently change the technical graph.

### Proposed planning algorithm

1. Build and validate the technical DAG first.
2. Calculate graph-ready waves and the critical dependency chains.
3. Identify useful ownership continuity: domain knowledge, language, shared components, integration and review responsibilities.
4. Assign each ticket one primary developer from `D1` through `DN`.
5. Produce a suggested queue for each developer.
6. Show exact cross-developer handoffs for every ticket.
7. Validate that claimed simultaneous work fits actual available developers.
8. Preserve preparation/review opportunities without calling them completed feature deliveries.
9. State any staffing choices that serialize otherwise independent work.
10. Do not invent durations or equal workload from ticket counts.

For arbitrary N, use stable identifiers such as `D1..DN`; do not impose an alphabet limit. A/B/C were convenient labels for this three-person case.

### Resource readiness versus dependency readiness

A ticket can be graph-ready but waiting for its assigned person.

If a ready wave contains more than N tickets, or several tickets owned by the same developer, it cannot all execute simultaneously. Split the staffing batches or adjust the proposed ownership with the human's agreement. Do not create false technical dependency edges to encode resource contention.

Likewise, N developers do not guarantee N independent implementation queues. During a short foundation sequence, some people may prepare contracts, review source or develop on prerequisite stacks.

### Edge cases

- **N = 1:** the DAG still matters, but the implementation queue is serial. Independent review can still be a separate read-only activity.
- **N smaller than a ready wave:** use resource-aware batches without changing the technical DAG.
- **N larger than a ready wave:** preparation, review and fixture planning can be useful; do not invent feature work or claim artificial parallelism.
- **Strict specialization:** it may improve ownership continuity but serialize the critical path. Surface that tradeoff rather than silently reshuffling the approved schedule.
- **Lead developer:** configure this role deliberately. A lead may kick off foundations and own joins/acceptance without implementing or approving every ticket.

### What the developer-facing view should show

For each developer, display:

| Field | Meaning |
| --- | --- |
| Queue position | Suggested personal focus order, not another technical dependency. |
| Ticket | Actual published ID, title and link. |
| Can land after | Exact predecessor tickets and the developer responsible for each. |
| Delivery stage | Migration implementation, QA/release gate or cutover. |

The rule for a developer is:

> Choose ready work in your queue. Before landing it, satisfy its own acceptance and listed prerequisites. If an input is owned by another developer, prepare or review while waiting; do not implement their missing ticket or wait for unrelated earlier-wave work.

## 10. Use independent reviews

At minimum, use two distinct read-only review lenses over the complete drafts and coverage.

### Review A: import, construction and ownership closure

Check:

- Every concrete import, constructor and required collaborator has an available producer.
- Runtime assembly does not leak into an upstream foundation.
- Complete classes/workflow closures are owned coherently.
- Pure schemas remain pure.
- Callback/event consumers are compatible with producers.
- Shared-file contributions have genuine phase ownership.
- All merge fixtures, generators and commands use self/ancestor/existing inputs.
- Actual task bodies and appendices agree with the graph.
- Advertised independent waves are semantically independent.

### Review B: source, fixtures, commands and acceptance coverage

Check:

- Frozen source IDs, source text digests and occurrence identities remain unchanged.
- Exact operation/caller/permission/workflow inventories are preserved.
- Configuration names, numeric limits, metric definitions and units have not been summarized away.
- Every moved assertion has a real destination with the right proof owner.
- Commands have the correct repository/cwd and available fixture/provider/generator.
- Component proof is not mislabeled as upstream policy or release proof.
- Rollout, rollback, recovery and retention constraints remain intact.
- Concrete witnesses appear in the actual current destination text.

### Review discipline

- Review all affected descriptions, not selected examples.
- Read full descriptions initially; a subsequent complete changed-body comparison can identify what needs fresh reading.
- Return precise source IDs, actual headings/clauses, ownership implications and the smallest correction.
- Distinguish structural validation from semantic correctness.
- Treat both reviewers' initial failures as useful evidence, not obstacles to bypass.
- Repair drafts and composed metadata together.
- Re-review changed positive clauses, especially newly generated appendices.
- Bind PASS to input fingerprints. A verdict for an earlier body does not approve a later substantive edit.

### Parallel agent coordination

Use genuinely independent authoring slices when the work justifies delegation. In this run, the main author coordinated gateway, backend, and profile/browser slices, while retaining integration ownership of the combined graph, source ledger and publication package.

Useful rules:

- Give each writer exclusive ownership of a known set of draft files.
- Share the exact interface and graph contracts up front.
- Have peers return requirement fragments, source references and artifact sidecars.
- Keep one integration owner for combined metadata.
- Do not let multiple writers concurrently overwrite the shared ledger or graph.
- Use independent reviewers rather than letting an author self-certify.
- Do not run product builds/services merely because planning agents are active.

## 11. Validate mechanically, including negative controls

### Structural checks

Verify:

- Exact approved node identities and direct parent sets, not counts alone.
- No duplicate, self or dangling edges.
- Acyclicity and computed ancestor sets.
- Every artifact's producer is self, an ancestor or genuinely existing code.
- Frozen source identity/text/digest preservation.
- Valid implementation/merge/integration ownership.
- Actual coverage and witness bindings.
- Claimed independent groups.
- Exact contract inventory equality, including methods, paths and permissions.

Parent arrays are unordered relations. Canonicalize their order for comparison; preserve raw provider order in the evidence.

### Generalized structural validator

The following reference intentionally has **no Connector Gateway-specific ticket count, edge count or issue IDs**. It checks structure and source ownership; it does not replace source inspection, literal-witness checking, complete semantic reviews or live API readbacks.

External prerequisites must be explicitly reconciled into the approved validation scope before using this closed-scope validator. Do not silently discard them.

```python
import hashlib


def validate_project(graph, ledger, frozen_sources, approved_dependencies,
                     independent_groups=()):
    deps = graph["prerequisites"]
    assert deps, "Empty project graph"
    assert all(isinstance(parents, list) for parents in deps.values())
    assert all(len(parents) == len(set(parents))
               for parents in deps.values()), "Duplicate dependency"
    assert all(node not in parents for node, parents in deps.items()), "Self edge"
    assert all(parent in deps for parents in deps.values()
               for parent in parents), "Unreconciled external/dangling dependency"

    canonical = {node: sorted(parents) for node, parents in deps.items()}
    approved = {node: sorted(parents)
                for node, parents in approved_dependencies.items()}
    assert canonical == approved, "Approved graph changed"

    done, ancestors, waves = set(), {}, []
    while len(done) < len(deps):
        ready = [node for node, parents in deps.items()
                 if node not in done and set(parents) <= done]
        assert ready, "Dependency cycle"
        waves.append(ready)
        for node in ready:
            ancestors[node] = set(deps[node])
            for parent in deps[node]:
                ancestors[node].update(ancestors[parent])
        done.update(ready)

    artifact_ids = set()
    for artifact in graph["artifacts"]:
        assert artifact["id"] not in artifact_ids, "Unreconciled artifact alias"
        artifact_ids.add(artifact["id"])
        producer = artifact["producer"]
        assert producer == "existing-code" or producer in deps
        if producer == "existing-code":
            assert artifact.get("sourceReference"), "Missing existing-code evidence"
        for consumer in artifact["mergeConsumers"]:
            assert consumer in deps
            assert (producer == "existing-code" or producer == consumer
                    or producer in ancestors[consumer]), "Hidden merge input"

    rows = ledger["requirements"]
    ids = [row["id"] for row in rows]
    assert len(ids) == len(set(ids)), "Duplicate source ID"
    assert set(ids) == set(ledger["sourceRequirementIds"]) == set(frozen_sources)
    for row in rows:
        digest = hashlib.sha256(row["sourceText"].encode("utf-8")).hexdigest()
        assert digest == row["sourceSha256"] == frozen_sources[row["id"]]
        fragments = row.get("implementationFragments") or [row]
        for fragment in fragments:
            owner = fragment["implementationOwner"]
            merge = fragment["mergeVerificationOwner"]
            final = fragment.get("integrationVerificationOwner")
            assert owner in deps and merge in deps
            assert merge == owner or owner in ancestors[merge]
            assert (final is None or (final in deps and
                    (final == owner or owner in ancestors[final])))
            assert fragment.get("destinationSection"), "Missing destination"

    for group in independent_groups:
        group = set(group)
        assert group <= set(deps)
        for node in group:
            assert not (ancestors[node] & (group - {node})), "False parallel group"

    return waves, ancestors
```

A nonempty `sourceReference` is a necessary mechanical check, not proof that the referenced code actually exists. Human/source review must establish that fact.

### Negative controls

Run deliberate invalid mutations against in-memory copies, never the live tracker:

1. Introduce a dependency cycle.
2. Remove a frozen source requirement.
3. Change a frozen requirement's text or digest.
4. Give a consumer a fixture produced by a non-ancestor.
5. Add a dependency between tickets advertised as independent.
6. Add a duplicate or self edge.
7. Point at an unreconciled external/dangling issue.
8. Keep node/edge counts constant while changing the actual graph.

The actual Connector Gateway planning checks exercised cycle rejection, missing-source rejection, a non-ancestor fixture producer, and two false-independence variants. Not every additional suggested negative control above was part of the original project run.

## 12. Produce an understandable HTML execution guide

### The presentation lesson

The initial global dependency table was technically correct but hard to read as a work plan. We iterated through:

1. Delivery and direct prerequisites.
2. Delivery stage and proposed developer columns.
3. A prerequisite/parallelism column.
4. A separate numbered order column.
5. Replacing the misleading word “Prereq” with “Sequential gate.”
6. Explaining that sequential gates do not all happen first.
7. Finally putting **separate developer queues before the global table**.

The last change solved the deeper problem: the user wanted a developer-oriented execution view, not merely more columns in a global graph.

### Recommended document order

1. Project title and a concise “how to use this” section.
2. A clear statement that dependency order is not a day-by-day schedule.
3. One section per developer with their suggested queue and explicit handoffs.
4. A concrete cross-developer example.
5. The complete dependency reference table.
6. Migration/QA/cutover explanations and operational qualifications.
7. Full expandable ticket descriptions.
8. Detailed schedule/evidence links.
9. Historical approval context, clearly labeled as historical and collapsed.

Do not leave old approval instructions at the top of a post-publication execution guide as though they are still the current action.

### Recommended global table

| Column | Meaning |
| --- | --- |
| Order | Dependency wave, not a unique calendar slot. Parallel-ready tickets can share a number. |
| Delivery | Actual issue ID, title and a useful link. |
| Direct prerequisites | Exact authoritative landing inputs. |
| Delivery stage | Migration, QA/release gate or cutover. |
| Execution mode | Local sequential/join gate versus a parallel-ready branch, with a clear legend. |
| Developer | Primary proposed or verified owner, accurately labeled. |

Do not infer that a singleton wave is a global gate for all other work. Do not imply that graph-ready tickets are simultaneously staffed when N or their shared owner prevents it.

### Rendering implementation used here

The environment required the canonical renderer:

```javascript
const renderer = require('/Users/michael/.omp/agent/lib/html-document.cjs');
const document = renderer.finalizeHtml(content, title, {
  maxWidth: '1000px',
  planStyles: true
});
```

The renderer owns the final shell, theme and any Mermaid processing. Do not hand-roll competing theme or light/dark code styles. A future skill should use the approved renderer available in its environment, and surface a missing required renderer as a prerequisite rather than silently substituting an unrelated template.

Important structural details:

- Put the content inside the canonical `main.content` container.
- Wrap tables in the canonical `.table-wrap` container, including tables with `id` or `class` attributes.
- Use native headings, links, table headers and disclosure controls.
- Keep wide tables scrollable inside their container rather than overflowing the document.
- Preserve keyboard behavior.
- Use actual published IDs once available while retaining stable internal aliases for generation and provenance.

### One source of presentation data

Derive developer queues, graph rows and stage labels from the same graph/identity metadata. Do not maintain three manually copied assignment tables.

Use stable ordering, but keep suggested queue position separate from direct graph prerequisites.

### Preserve approved artifacts during presentation-only changes

We added an `--html-only` generator mode so presentation refinements did not rewrite historical payloads, manifests or the Markdown approval package.

The actual presentation updates guarded 23 approval/audit/ticket-description artifacts by hash. They changed the HTML guide and its generator, not the live ticket descriptions, dependencies or assignees.

This is a general design requirement: **separate ticket content, approval snapshots, live publication receipts and presentation generation**.

### Browser verification

Actually open the generated file and inspect the rendered surface. In this run, checks included:

- Exact table header order and expected row count.
- Sorted dependency waves and parent-before-consumer assertions.
- Correct stage and developer values on every row.
- Distinct developers for the claimed simultaneous three-person waves.
- Three developer sections covering all 17 tickets exactly once.
- Exact cross-developer prerequisite labels and working internal anchors.
- Matching real published links/identities.
- Desktop and narrow-viewport containment.
- Dark-mode rendering.
- Native keyboard opening of a disclosure.
- Complete ticket bodies remaining available.
- Historical approval context remaining separate from current execution guidance.
- Closing the owned browser afterward.

Screenshots establish visual evidence; they do not establish semantic graph correctness. DOM assertions establish structure; they do not establish product behavior. Use each for its actual purpose.

For a very large document, whole-page accessibility/inspection operations may stall. Scoped table/section inspection and targeted screenshots can verify the affected surface without abandoning the check.

Do not claim complete WCAG compliance merely because these targeted browser checks passed.

## 13. Stage and obtain exact-content publication approval

### What the approval package must contain

- Every complete proposed description and exact title.
- All proposed new ticket creation payloads.
- Exact existing-ticket mutations.
- Exact native dependency additions/removals.
- Protected metadata policy.
- Source coverage and semantic review evidence.
- Staffing plan and operational qualifications.
- Description, payload, graph and ledger hashes.
- Stable draft aliases, without pretending they are real tracker IDs.
- Explicit permission for mechanical alias-to-returned-ID/URL replacement.

Do not ask the human to approve unseen ticket bodies on the strength of an attractive summary.

### Approval is scoped

Planning approval is not publication approval.

Publication approval is not permission for unrelated comments, reassignment, status changes or production operations.

If a substantive body, boundary, identity or dependency changes after approval, reconcile and obtain renewed approval. Do not quietly expand a foundation or shrink acceptance to preserve the original graph.

A known presentation-only correction preserving the exact approved technical characters is different from a new behavioral instruction. Keep that distinction explicit and auditable.

### Initial creation defaults

Specify the approved team/project/status/assignee/priority/labels/parent/estimate policy. In this case, new peers were explicitly created in the existing project/team as Backlog, unassigned, No priority, no estimate, no parent and no labels. Existing fields were protected.

Those exact defaults are case-specific, not mandatory defaults for every future project.

## 14. Publish with concurrency protection and durable receipts

### Before each mutation

1. Re-read the live issue immediately.
2. Confirm identity and current title/body/dependency content against the expected baseline or last verified own write.
3. Preserve unrelated metadata drift.
4. If substantive human content or dependencies changed, stop that mutation and restage the conflict.
5. Use exact current-content guards where the API supports them.

The available API supported atomic description patches using exact unique anchors. This can protect the description from a concurrent edit. Do not claim that it provides a transactional compare-and-swap for every metadata field or for the whole multi-ticket publication.

### Publication order

- Work in a valid dependency order.
- Create complete peer descriptions, not stubs.
- Persist each returned real ID/UUID immediately.
- Resolve references through the durable identity map.
- Add only the approved direct dependency deltas.
- Read back complete content and protected metadata immediately after each write.

Not all future IDs are known when the first new ticket is created. A two-pass publication can first create complete alias-bearing bodies, then mechanically resolve references and add native relations once the identities exist. The final state must contain the resolved approved content.

### Durable state

Record:

- Approved payload identity.
- In-flight action and intended target.
- Returned creation identities.
- Completed description and relation writes.
- Raw stored and expected hashes.
- Readback paths.
- Corrective actions and their evidence.
- Final fresh audit state.

Resume from the receipt. Do not rerun every creation after an interruption.

### Creation timeouts

Before retrying a timed-out creation, search the complete relevant project and inspect exact candidate identity/content/creation evidence.

A concurrent exact-looking ticket is not automatically yours. Reuse must follow the approved identity/reconciliation policy. Do not create a duplicate because a response was missing, and do not silently adopt another human's ticket.

### A success-shaped response is not proof of persistence

Two updates in this run returned/read back the old body and unchanged timestamp. The cause was not established. We did not claim that it was caching or eventual consistency.

After rereading and excluding concurrent edits, only the already-approved title/body intent was reapplied through an available update form. Full readbacks then passed.

A safe corrective update must not overwrite an unknown third state. If content is neither the known original nor the approved expected state, reconcile it instead of retrying blindly.

## 15. Handle tracker and Markdown behavior safely

### Relationship semantics must be observed

The available `save_issue` contract described blocker operations as append-only. Actual readbacks showed that overlapping relationship types were not independently preserved: a related link became a blocker, and writing both types left only one.

Treat this as **observed behavior of the available API in this environment**, not a universal claim about every tracker integration.

The safe response was:

1. Detect the lost related link in the immediate readback.
2. Restore it while the conversion was unapproved.
3. Enumerate the exact overlapping pairs.
4. Ask for a narrow relation-type conversion decision.
5. When another overlap appeared, preserve it and reconcile again.
6. Obtain a rule bounded to the exact already-approved blocker pairs.
7. Preserve every nonconflicting related reference.
8. Verify both directions of the final blocker graph.

The dependency directions and total edge set did not change. The human approved the unavoidable relationship-type changes.

Never treat related links as implementation prerequisites merely because they exist. Never delete unrelated links to make the graph clean.

### Pagination can fail differently between query modes

A fuzzy title/description search returned more pages, and a later pagination response did not provide a usable next cursor. That was not evidence that there was no duplicate.

We switched to complete project enumeration, including archived work, and compared exact titles/identities there. The authoritative complete project response had a valid terminal page.

General rule: do not mistake incomplete search pagination for duplicate exclusion. Try a different complete authoritative query, or report the concrete unavailable prerequisite.

### Markdown normalization is real

Observed presentation changes included:

- Blank-line normalization outside code.
- Unordered-list marker changes.
- Automatic ordered-list renumbering.
- Strong-emphasis marker placement around inline code.
- Escaping/unescaping brackets, literal asterisks, hyphens and underscores.
- Equivalent HTTP/domain autolinks.
- Bare Linear URLs becoming matching issue-ID links.
- Table separator dash counts and cell padding.

Store separate hashes for:

1. Approved source content.
2. Mechanically resolved content.
3. Actual transport Markdown.
4. Raw stored Markdown.
5. A narrowly defined presentation-normalized comparison, where appropriate.

Do not require raw byte equality for known presentation changes. Do not normalize away substantive differences either.

### Technical character corruption is not harmless formatting

The editor interpreted an unquoted `:lock:` substring as an emoji and altered an actual Redis key:

```text
mcp-gateway:lock:oauth-refresh:{orgId}:{vaultRef}
```

It also interpreted unquoted double underscores in these Python filenames as emphasis:

```text
writer_integrations/__init__.py
mcp_gateway/__init__.py
```

These were real technical-content mismatches. We corrected the stored presentation by quoting only the exact approved literals as inline code outside existing code blocks. We did not accept the changed key/filenames or normalize the corruption away.

### Normalization safety rules

- Preserve every fenced block and its language/content independently.
- Preserve inline technical literal sequences and executable command sequences.
- Preserve exact methods, paths, limits, permissions and identifiers.
- Preserve link targets; do not turn a wrong link into an equivalent-looking label.
- Limit formatting exceptions to inspected, documented behavior.
- Inspect a new mismatch before expanding the allowed rules.
- Do not copy case-specific technical-literal exceptions into a future project without evidence.

In this run, independent publication checks verified all 207 fenced blocks, inline-code sequences and command sequences, in addition to all 17 whole-body comparisons.

## 16. Run a separate fresh live audit

Immediate write readbacks do not replace the final audit.

After the last publication mutation, automatically:

1. Fetch the complete live project inventory again.
2. Fetch every affected issue's full description, identity, metadata and native relationships again.
3. Record fresh request/response times.
4. Resolve aliases using the durable creation/reuse receipt.
5. Build a graph from native `blockedBy`.
6. Independently build a graph from reciprocal `blocks`.
7. Extract declared prerequisites from the actual published descriptions.
8. Inspect the actual published implementation/fixture/generator/check inputs, including appendices.
9. Compare all of those with the approved resolved graph.
10. Check duplicates, self edges, dangling endpoints, external constraints, cycles and independent groups.
11. Validate source preservation, exact contract inventories and actual destination witnesses.
12. Validate titles, identities and protected metadata.
13. Save a final PASS/FAIL report with actual issue links, observed edges, waves, coverage, evidence and findings.

Use the fresh responses, not cached planning objects or prepublication drafts, as the live audit source.

### Independent final review

We used separate read-only semantic/native and source/acceptance audit lenses over the fresh publication bundle. They did not inherit the earlier draft PASS as evidence of correct publication.

Complete normalized-body equivalence is powerful preservation evidence, but it is not a substitute for independently reconstructing the native graph or inspecting the semantic prerequisites.

### Failures after publication

Distinguish:

- **Publication mismatch:** correct only to the already-approved exact intent, after rereading and excluding concurrent edits; then repeat the affected complete fresh audit.
- **Substantive new finding:** preserve live work, show the failed boundary and smallest correction, and obtain the necessary approval before changing scope.

Do not call the restructure complete while the final audit fails.

## 17. Assign named developers only when authorized

The HTML's Developer A/B/C labels were initially proposed staffing lanes. Tickets were deliberately left unassigned at initial publication.

The human later explicitly requested:

- Developer A: Michael Donahue.
- Developer B: Colin McNeil.
- Developer C: Vinh Vu.

That instruction authorized the concrete assignments from the existing queues.

### Assignment procedure

1. Resolve exact active workspace users by name.
2. Require an unambiguous match; use returned user IDs, not guessed identities.
3. Derive the ticket set from the same ownership metadata used by the guide.
4. Include the lead-owned QA/cutover tickets in the lead's set where the plan says so.
5. Read each live ticket immediately before assignment.
6. Mutate only the assignee field.
7. Read back and verify the actual assignee ID.
8. Compare all protected fields, including description hashes and relationship IDs.
9. Perform a fresh aggregate verification across all affected tickets.
10. Save a durable assignment receipt.

Do not change statuses, priorities, labels, team membership or ticket content simply because you are assigning a person. Do not post an unseen handoff comment when only assignments were authorized.

### Actual final assignments in this case

| Lane | Verified assignee | Tickets |
| --- | --- | --- |
| A | Michael Donahue | WA-2032, WA-2033, WA-2034, WA-2135, WA-2035, WA-2041, WA-2136, WA-2043 |
| B | Colin McNeil | WA-2036, WA-2133, WA-2134, WA-2037, WA-2038 |
| C | Vinh Vu | WA-2132, WA-2039, WA-2040, WA-2042 |

The separate assignment verification completed at **2026-10-22T03:36:21.852763+00:00**. It checked all 17 assignments, all non-assignment fields and the same 24 native dependency edges. All tickets remained Backlog at that verification.

**Historical evidence is time-specific:** the earlier publication audit correctly says the tickets were unassigned then. The later assignment receipt establishes the subsequent named assignment state. Do not rewrite historical evidence or cite the earlier unassigned snapshot as current after the assignment step.

## 18. What actually happened in the Connector Gateway case

### Starting problem

The original twelve tickets mixed reusable services, final host composition, shared backend helpers, browser handlers, generated artifacts and cross-stack acceptance. Their descriptions allowed a ticket to implement missing dependencies itself, masking real prerequisites.

Every source ticket was still Backlog and unstarted at the publication baseline. There were no native blocking edges, but existing related references had to be preserved or explicitly reconciled.

### The selected partition

We retained the twelve original issue identities and created five peers:

| Draft alias | Actual issue | Purpose |
| --- | --- | --- |
| CG-CORE | [WA-2132](https://linear.app/writer/issue/WA-2132) | Shared domain/provider service foundations. |
| CG-BACKEND | [WA-2133](https://linear.app/writer/issue/WA-2133) | Shared backend projections, setup, inventory and metadata. |
| CG-HTTP | [WA-2134](https://linear.app/writer/issue/WA-2134) | Complete browser HTTP boundary and public projection. |
| CG-RUNTIME | [WA-2135](https://linear.app/writer/issue/WA-2135) | Complete runtime composition and vertical proof. |
| CG-VERIFY | [WA-2136](https://linear.app/writer/issue/WA-2136) | Cross-stack release acceptance. |

These aliases were planning identities until real creation receipts existed. They were not invented Linear IDs.

### Final graph, grouped into computed dependency waves

| Wave | Ticket | Delivery | Direct prerequisites |
| --- | --- | --- | --- |
| 1 | WA-2032 | Contract and ownership foundation | None |
| 2 | WA-2033 | Infrastructure and authoritative pure schemas | WA-2032 |
| 3 | WA-2132 | Shared CG services/provider foundations | WA-2033 |
| 3 | WA-2036 | Generated Python access and selector | WA-2033 |
| 4 | WA-2133 | Shared backend projections/setup | WA-2036 |
| 4 | WA-2034 | Discovery, execution and transfers | WA-2132 |
| 4 | WA-2039 | Complete profile workflows and OAuth | WA-2132 |
| 5 | WA-2040 | Admin and connector builder | WA-2039 |
| 5 | WA-2134 | Unified browser HTTP boundary | WA-2133 |
| 6 | WA-2135 | Runtime composition and vertical proof | WA-2034, WA-2040, WA-2036 |
| 7 | WA-2035 | Trigger migration and runtime readiness | WA-2135 |
| 7 | WA-2037 | Native tools, restrictions and durable transfers | WA-2135, WA-2133 |
| 7 | WA-2042 | Studio frontend migration | WA-2134, WA-2135 |
| 8 | WA-2038 | Remaining backend callers | WA-2037 |
| 8 | WA-2041 | WA frontend migration | WA-2134, WA-2037 |
| 9 | WA-2136 | Integrated release acceptance | WA-2035, WA-2038, WA-2041, WA-2042 |
| 10 | WA-2043 | Cutover and retirement | WA-2136 |

The graph has 17 nodes and 24 direct edges. Those values are **case results**, not constants for a future skill.

### The crucial ownership transfers

- Pure contracts remained in WA-2032.
- Infrastructure, mappings, guards, tombstones, pure schemas and private emission stayed in WA-2033; complete runtime composition moved out.
- Reusable catalog/profile/credential/OAuth/status/tool/security/refresh services moved into CORE.
- All nineteen admin profile workflows and their statically importing class moved together into WA-2039.
- The profile/catalog helper `resolveConnectorAndTools` moved to WA-2039, before builder consumption in WA-2040.
- Complete old/new callback dispatch and old-host publisher/factory integration moved to RUNTIME.
- Both-host low-level status ADTs/adapters/mappers and their isolated proof remained coherent in CORE; RUNTIME consumed them for whole-flow proof.
- Shared backend projections, all existing signature callers, inventory and display metadata moved to BACKEND before native consumers.
- All 14 user and 23 admin browser handlers, common router, VIEW permission and public projection moved together into HTTP.
- Complete native transfer parser/context/persistence/migration/runtime/worker/status/restart behavior moved into WA-2037, not successor WA-2038.
- The full vertical fixture, generated Python wire proof and builder commit-to-execute side effect moved into RUNTIME.
- Evidence-conditioned old-caller/session/executor cleanup moved to WA-2043.

### Findings that materially improved the plan

| Defect discovered | Correction | General lesson |
| --- | --- | --- |
| Foundation depended on status-specific ADTs/tests from a later service delivery. | Keep foundation infrastructure proof local; move the real status adapter/mapping proof coherently to CORE. | Test dependencies are real dependencies. |
| Execution ticket required the complete three-method trigger aggregate. | Execution owns its one method; RUNTIME composes all three after profile methods exist. | Do not fake a partial aggregate to satisfy a ticket. |
| Profile trigger failure projection imported a sibling execution classifier. | Use a local safe projection over delivered common contracts; no context-aware classifier copy/import. | Similar error shapes do not justify a sibling dependency or duplicated implementation. |
| Profile refresh/revoke proof required actual next execution. | Keep local mutation/owner/tombstone proof local; make the actual next-execute/vendor-counter race mandatory RUNTIME proof. | Move integration proof without weakening it. |
| Shared backend projectors were still described as coming from a future frontend ticket. | Deliver them inside BACKEND and point callers at that canonical owner. | Shared helpers must precede their first real consumers. |
| Selector/flag ownership was duplicated. | Separate process configuration from the single backend selector/flag owner. | Similar-looking switches are not the same authority. |
| Relative/source artifact aliases hid wrong producers and phantom outputs. | Canonicalize paths, source/target classification and phase contributions. | A zero-conflict dictionary is not proof of real source closure. |
| Concrete configuration rows disappeared into generic responsibility prose. | Restore complete named/defaulted/conditional mappings and their exact destinations. | Do not classify substantive tables as boilerplate. |
| Precise metrics became generic categories. | Restore histogram/sample/units, database observations, actual emitted names and first-event latency. | Preserve measurable acceptance, not only topic labels. |
| An old-host OAuth command used the new-host cwd. | Preserve the full command at the actual old-host location with its real isolated inputs. | A command's environment is part of its dependency contract. |
| Repair appendices reintroduced helper re-ports and schema creation. | Rewrite the positive appended clauses and split their ownership metadata correctly. | Re-review repairs; a repair can recreate the original defect. |
| Command comments retained future/sibling inputs despite a correct top-level boundary. | Correct the actual comment immediately before the merge command. | Scope disclaimers do not override executable instructions. |
| Constructor shorthand omitted a required collaborator. | Restore the complete required constructor contract. | Exact signatures matter more than summaries. |

### Three-engineer parallelism actually validated

- After runtime/backend/HTTP prerequisites, WA-2035, WA-2037 and WA-2042 had no mutual implementation dependency.
- After WA-2037, WA-2038 and WA-2041 were independent while Studio could continue.
- HTTP was mergeable independently of gateway runtime composition, but proved only its genuine boundary at that point.
- A led the foundations and runtime join; B and C owned their substantial branches.
- The early foundation sequence did not falsely claim three independent completed feature queues.

## 19. Verification and evidence inventory

### Observed final publication evidence

| Evidence | Result |
| --- | --- |
| Published tickets | 17, with original twelve identities retained and five real peers created. |
| Direct native dependency pairs | 24, exact approved set. |
| Topological waves | 10. |
| Native reciprocity | `blockedBy` equals reversed `blocks`. |
| Duplicate/self/dangling/external blocking endpoints | None observed in the final fresh snapshot. |
| Immutable requirement records | 7,506, source text/digests preserved. |
| Source occurrences | 7,589, including 83 duplicate-occurrence references. |
| Destination coverage rows | 8,097. |
| Bounded implementation fragments | 3,129, with actual published witnesses. |
| Artifact records | 1,492, producer/consumer ancestry validated. |
| Private operation inventory | Exact 39 operation triples. |
| Browser inventory | Exact 37 mappings, 14 user and 23 admin. |
| Profile workflow inventory | Exact ordered nineteen filenames. |
| Caller-disposition inventory | 170 paths preserved. |
| Fenced code preservation | 207 blocks verified independently. |
| Fresh semantic/native audit | PASS, no unresolved findings. |
| Fresh source/acceptance audit | PASS, no unresolved findings. |
| Later named assignment verification | 17 correct assignees, all protected fields and 24 edges preserved. |

### Time-specific snapshots

The separate final publication audit read the live project/issues from **2026-10-22T02:44:06.915910+00:00** through **2026-10-22T02:44:10.438339+00:00**. Publication completion was recorded after the independent reports passed.

Named assignments were a later authorized operation, verified at **2026-10-22T03:36:21.852763+00:00**. Do not merge these into a fabricated single simultaneous snapshot.

### What was not verified or performed

This planning/publication workflow did not:

- Implement the product migration.
- Run the planned product test suites, generators, provider smokes or CI.
- Start product services.
- Run database migrations or catalog seeds.
- Establish live callback registrations, traffic coverage or cluster readiness.
- Deploy artifacts, change holds/flags or switch traffic.
- Authorize destructive retirement or maintenance ownership transfer.
- Prove equal workload or dates for the three developers.

HTML browser checks and graph/source validators were actually exercised. Product acceptance commands in tickets remained instructions for future implementation.

## 20. Failure modes and recovery rules

| Failure mode | Do this | Do not do this |
| --- | --- | --- |
| Truncated tool output | Recover the actual full response artifact. | Treat the preview as the full ticket. |
| Missing or invalid pagination cursor | Use another complete authoritative inventory or report the blocker. | Claim duplicate exclusion from an incomplete search. |
| Source requirement omitted | Restore it and bind concrete implementation/proof. | Delete its frozen ID. |
| Graph cycle | Find the real shared producer/join boundary and restage if needed. | Rename tickets or hide the input behind an optional factory. |
| Future merge fixture/generator | Move the producer or proof to the correct phase. | Register a skipped future check or fake the fixture. |
| Duplicate implementation ownership | Choose one canonical producer and migrate consumers. | Add another helper with a similar name. |
| Human content changed before write | Preserve and reconcile it. | Overwrite it with the approved older snapshot. |
| Write did not persist | Reread, exclude a third state, and correct only to the approved intent. | Assume an acknowledgement is success or invent a cause. |
| Creation response lost | Search and reconcile identity/content before retrying. | Create another ticket blindly. |
| Native relation type replaces another | Restore when unapproved and obtain a bounded conversion decision. | Silently remove unrelated relationships. |
| Editor changes a technical key/path | Protect the exact literal, reread and independently verify it. | Normalize the corruption away. |
| Presentation changes after approval | Use a presentation-only path and guard content hashes. | Rewrite approval snapshots or live tickets as a side effect. |
| Numbered table confuses the reader | Lead with per-developer queues and explicit handoffs. | Keep adding ambiguous labels to the same overloaded table. |
| More ready tickets than developers | Use resource-aware batches or an agreed ownership adjustment. | Invent technical dependencies to serialize them. |
| No authorized frontend hold/candidate path | Preserve the operational blocker and avoid unsafe landing/promotion claims. | Invent approval, a bridge, or a fake upstream. |
| Audit fails after publication | Correct only a publication mismatch, or restage a substantive finding. | Declare success based on the earlier draft PASS. |

## 21. Definition of done

### Planning content

- Complete authoritative source is frozen.
- Every substantive source obligation has a concrete bounded destination.
- Source identities/text/digests and duplicate references are preserved.
- Each behavior has one implementation owner.
- All consumed inputs have real producers.
- No missing-sibling absorption or partial enabled delivery remains.
- Merge proof, integrated proof and cutover authorization are distinct.
- Independent reviews have no unresolved blocking findings for the actual current inputs.

### Execution model

- The approved direct graph is acyclic and exact.
- Claimed parallel groups pass both graph and semantic checks.
- The N-developer allocation is resource-honest.
- Every ticket has one primary proposed owner where staffing was requested.
- Developer queues and cross-lane handoffs are understandable.
- No invented dates or equal-work estimates are presented.

### Publication

- Exact external changes were explicitly authorized.
- Real issue identities are durable and resolved.
- Every mutation has a complete readback.
- Protected metadata and unrelated relationships are preserved or changed only under explicit scoped approval.
- A separate fresh live audit passes native, semantic, content and metadata checks.
- Partial publication is not called complete.

### Presentation and assignments

- The actual rendered HTML has been checked.
- The primary view answers “what does each developer do next?”
- Historical approvals are not presented as current instructions.
- Presentation edits do not silently mutate approved content.
- Real user assignments, if requested, are resolved, authorized and verified separately.
- Final human-facing delivery includes links, exact results and remaining operational limits.

## 22. Suggested future skill contract

This section is a design seed for a later skill, not a claim that one has been created or installed.

### Suggested purpose

> Convert a large project's authoritative requirements and existing tracker state into complete bounded tickets, an evidence-backed dependency DAG, resource-honest queues for N developers, a verified HTML execution guide and, when explicitly authorized, correct live tracker content and assignments.

### Required inputs or discoverable context

- Project/tracker and authoritative scope.
- Source specifications and existing tickets.
- Repository/source locations.
- N and optional names/specializations/lead preference.
- Existing implementation status and identity preservation rules.
- Required acceptance, rollout and retained-authority contracts.
- Output directory and mutation permissions.

### Required artifacts

Use project-neutral names in a future implementation:

```text
run/
  source-baseline.json
  source-identity-freeze.json
  source-bodies/
  requirements.json
  coverage.json
  boundaries.md
  graph.json
  staffing.json
  drafts/
  review-closure.md
  review-coverage.md
  validation-results.json
  approved-payloads.json
  approved-manifest.json
  publication-authorization.json
  created-identities.json
  alias-substitutions.json
  publication-state.json
  fresh-live-inputs.json
  final-semantic-audit.md
  final-coverage-audit.md
  final-audit.md
  assignment-receipt.json
  execution-guide.html
  presentation-check.json
```

These names are a proposed contract. Not all optional phases need artifacts when the human requests drafts-only or no assignments.

### Suggested resumable phases

- `scope`: resolve context and permissions.
- `freeze`: full live/source baseline and immutable IDs.
- `partition`: real producers, boundaries and direct graph.
- `draft`: complete descriptions and traceable scope transfers.
- `review`: independent closure/coverage challenges and repair.
- `stage`: exact payloads, hashes and human presentation.
- `await-publication-approval`: no external writes before approval.
- `publish`: guarded mutations and durable receipts.
- `audit`: separate fresh live graph/content/metadata verification.
- `present`: developer-first guide and browser proof.
- `await-assignment-approval`: only when names/assignments are not yet authorized.
- `assign`: exact user resolution and assignee-only mutations.
- `verify-assignments`: fresh aggregate verification.
- `done`: match the requested scope; do not imply product completion.

Presentation may be generated before approval and refined afterward. Named assignments may be included earlier if the exact approved scope already covers them. The phases are approval and evidence boundaries, not an inflexible calendar.

### Suggested control rules for the skill

1. Default to read-only research and local drafting until the relevant mutation is authorized.
2. Never infer unseen ticket-publication approval from planning approval.
3. Never silently alter the approved partition when source closure fails.
4. Never manufacture coverage by deleting source identities.
5. Never label a future artifact as existing code.
6. Never substitute mocks/stubs for missing internal implementations.
7. Never erase required downstream proof to make a component independent.
8. Never equate publication, code merge, QA and deployment.
9. Never create a ticket again without resolving an uncertain prior creation.
10. Never use related links as blockers without the approved dependency meaning.
11. Never silently convert relation types outside explicit scope.
12. Never claim product checks, provider behavior or live authorization from planning evidence.
13. Never mutate assignees/statuses/labels/comments beyond the approved fields.
14. Never let presentation regeneration rewrite approval evidence.
15. Always read back external mutations and run the separate final audit.
16. Always explain what a developer can do next and who supplies each dependency.

### Suggested final response contract

The skill's final human response should provide:

- Whether the result is draft-only, published/audited, or assigned/verified.
- The execution guide and final audit links.
- A complete linked dependency table or a directly linked complete table artifact.
- N developer queues and any material resource limitations.
- Exact exercised verification and unresolved blockers.
- Explicit distinction between planning completion and product/release completion.

## 23. Execution checklist

### Before drafting

- [ ] Resolve project and tracker identities.
- [ ] Read applicable repository/area/tracker instructions.
- [ ] Confirm scope and external mutation permissions.
- [ ] Fetch complete project inventory and every full ticket body.
- [ ] Include closed/archived work in duplicate checks.
- [ ] Freeze source, metadata, relations, timestamps and digests.
- [ ] Preserve already-started or delivered work.

### Before claiming a valid partition

- [ ] Inventory substantive contracts, callers, fixtures, commands and safety conditions.
- [ ] Assign stable source identities before rewriting.
- [ ] Preserve duplicate occurrences.
- [ ] Inspect real constructors/imports and receiving callback/event paths.
- [ ] Classify existing source versus proposed targets accurately.
- [ ] Give each concrete behavior one implementation owner.
- [ ] Separate reusable primitives, capabilities, runtime joins and consumers where the source permits.
- [ ] Stage schema/client/public generator checks with actual producers.
- [ ] Preserve full integration and production-evidence obligations.

### Before publication approval

- [ ] Complete every ticket, not just a summary card.
- [ ] Rewrite contradictory positive instructions throughout.
- [ ] Validate exact graph, source preservation and artifact ancestry.
- [ ] Exercise negative controls.
- [ ] Challenge advertised independence semantically.
- [ ] Run independent closure and coverage reviews.
- [ ] Re-review changed repairs and appendices.
- [ ] Produce N developer queues without inventing capacity or estimates.
- [ ] Generate and inspect the real HTML.
- [ ] Show complete exact payloads, edge changes and hashes.
- [ ] Obtain explicit exact-content approval.

### During publication

- [ ] Re-read immediately before each mutation.
- [ ] Preserve unrelated drift and reconcile substantive changes.
- [ ] Persist returned identities immediately.
- [ ] Resolve aliases without rewriting source artifact identities.
- [ ] Guard content replacement where supported.
- [ ] Preserve or explicitly reconcile relationship types.
- [ ] Read back complete content and protected fields.
- [ ] Inspect new formatting differences; protect exact technical literals.
- [ ] Resume from durable receipts, not assumptions.

### Before final delivery

- [ ] Fetch a separate fresh full live snapshot after the last mutation.
- [ ] Reconstruct native incoming and outgoing graphs independently.
- [ ] Extract published prerequisites and inspect hidden implementation inputs.
- [ ] Inspect external blocking endpoints and reachable constraints.
- [ ] Verify source/contract/content/code preservation.
- [ ] Verify protected metadata and unrelated references.
- [ ] Obtain independent fresh semantic and coverage verdicts.
- [ ] Save the final audit with actual IDs, timestamps, edges, waves and findings.
- [ ] Separate current guidance from historical approval context.
- [ ] Verify any authorized named assignments and unchanged fields.
- [ ] Report only exercised results and remaining operational limits.

## 24. Reference artifacts and reproducibility

### Connector Gateway run directory

```text
/Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local
```

The following filenames are relative to that directory. Copy the required run bundle if moving to another machine/session; the generator is not self-sufficient without its inputs.

| Artifact | Purpose |
| --- | --- |
| `cg-restructure-live-baseline.json` | Full twelve-ticket live baseline used during drafting. |
| `cg-source-WA-N.md` | Frozen full source body per original issue. |
| `cg-restructure-source-id-freeze.json` | Immutable requirement/occurrence identity and digest evidence. |
| `cg-restructure-requirements.json` | Complete source/owner/proof ledger. |
| `cg-restructure-draft-coverage.json` | Source-to-actual-destination coverage and witnesses. |
| `cg-restructure-frozen-operations.json` | Exact contract inventory evidence. |
| `cg-restructure-graph.json` | Approved alias-based graph, artifacts and staffing lanes. |
| `cg-restructure-boundaries.md` | Scope and producer/consumer partition. |
| `cg-restructure-acceptance-and-schedule.md` | Merge/release proof partition and checked three-engineer order. |
| `cg-restructure-<id-or-alias>.md` | Seventeen complete approved ticket descriptions. |
| `cg-restructure-review-closure.md` | Draft import/construction/ownership review and repaired findings. |
| `cg-restructure-review-coverage.md` | Draft source/fixture/command/acceptance review and repaired findings. |
| `cg-restructure-validator.py` | Case-specific structural validator. |
| `cg-restructure-negative-checks.py` | Exercised case-specific negative controls and exact inventories. |
| `cg-restructure-approved-payloads.json` | Frozen exact approved external changes. |
| `cg-restructure-approved-manifest.json` | Frozen body/payload/graph/ledger fingerprints. |
| `cg-restructure-publication-authorization.json` | Exact-content approval receipt. |
| `cg-restructure-created-identities.json` | Real issue/UUID/URL mapping. |
| `cg-restructure-alias-substitutions.json` | Mechanical reference replacement evidence. |
| `cg-restructure-resolved-payloads.json` | Expected content and blockers after real identity resolution. |
| `cg-restructure-publication-state.json` | Durable publication, corrective-write and final-audit state. |
| `cg-restructure-bounded-relation-authorization.json` | Approved blocker precedence limited to the exact 24 pairs. |
| `cg-linear-content-normalization.py` | Inspected case-specific presentation comparison and literal protection. |
| `cg-restructure-final-live-inputs.json` | Separate complete fresh post-publication API responses. |
| `cg-final-live-WA-N.md` / `.json` | Actual published full bodies and issue responses. |
| `cg-restructure-live-graph.json` | Actual-identity native graph and artifact ownership. |
| `cg-restructure-live-requirements.json` | Actual-identity adaptation of the source ledger. |
| `cg-restructure-live-approved-prerequisites.json` | Canonical exact approved parent sets using real IDs. |
| `cg-restructure-final-main-checks.json` | Native/content/metadata/wave proof. |
| `cg-restructure-final-semantic-audit.md` | Independent fresh semantic/native PASS. |
| `cg-restructure-final-coverage-audit.md` | Independent fresh source/acceptance PASS. |
| `cg-restructure-final-audit.md` | Combined final publication audit and linked dependency table. |
| `cg-build-publication-package.py` | HTML/package generator with presentation-only mode. |
| `cg-restructure-publication-plan.html` | Final developer-first execution guide. |
| `cg-dependency-table-presentation-check.json` | Latest exercised developer-queue/browser verification. |
| `cg-developer-assignment-receipt.json` | Later named assignments and fresh preservation verification. |

### Useful direct evidence links

- [Final HTML guide](file:///Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local/cg-restructure-publication-plan.html)
- [Combined publication audit](file:///Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local/cg-restructure-final-audit.md)
- [Independent fresh semantic audit](file:///Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local/cg-restructure-final-semantic-audit.md)
- [Independent fresh coverage audit](file:///Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local/cg-restructure-final-coverage-audit.md)
- [Named assignment receipt](file:///Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local/cg-developer-assignment-receipt.json)

### Actual case validator invocation

```bash
RUN_DIR="/Users/michael/.omp/agent/sessions/-.herdr-worktrees-writer-monorepo-proposal-cg-to-mono-92a1/2026-10-21T22-56-57-331Z_01a160ae-97f3-76a8-beb9-fe3b492f29e4/local"
python3 "$RUN_DIR/cg-restructure-validator.py" \
  "$RUN_DIR/cg-restructure-live-graph.json" \
  "$RUN_DIR/cg-restructure-live-requirements.json" \
  "$RUN_DIR/cg-restructure-live-approved-prerequisites.json"
```

This invocation was exercised successfully during the publication audit. The script is case-specific; do not copy its hardcoded 17/24 counts or specific independent group into a general skill.

### Presentation-only regeneration

```bash
python3 "$RUN_DIR/cg-build-publication-package.py" \
  --review-status passed \
  --html-only
```

This mode was exercised during the presentation refinements. It preserves the historical Markdown/payload/manifest artifacts rather than silently restaging them.

### Final takeaway

A repeatable skill should not be “split a project into tickets and draw a table.” It should be:

> Preserve the full requirements, discover the actual producer/consumer boundaries, define complete independently verifiable deliveries, staff the real graph honestly, publish only approved changes, verify the live result, and present each developer with a clear next-work queue and explicit handoffs.

### Verification performed while creating this Markdown

These checks concern this knowledge-capture document, not new product or live-tracker work:

- Executed the embedded project-neutral Python validator against a valid four-node diamond and verified its waves and ancestor set.
- Confirmed rejection of twelve invalid examples: a cycle, omitted frozen record, changed source text, non-ancestor producer, false independent group, duplicate dependency, self dependency, external/dangling dependency, same-count unapproved graph, invalid implementation owner, duplicate artifact alias and existing-code input without a reference.
- Reran the documented case-specific validator against the saved final actual-identity graph, ledger and approved prerequisites: PASS for 17 tickets and 24 edges. This was a saved-evidence check, not a new live Linear audit.
- Checked the document's local evidence links, concrete artifact references, contents links, balanced code fences and absence of em dashes.
- Obtained two independent read-only reviews: factual/evidence accuracy and reusable workflow/safety for arbitrary N developers. Both returned PASS with no findings.
- Made no new Linear changes, product changes, deployments or product-test claims.

**Future implementation note:** the embedded structural reference uses Python assertions. A production skill should use explicit validation exceptions, or otherwise ensure assertions cannot be disabled; Python's optimized mode removes `assert` checks. The reference is a tested explanatory starting point, not a complete production skill implementation.
