---
name: feature
description: "Runs a deterministic OMP feature pipeline with bounded context, implementation, verification, QA, parallel diff-scoped review, targeted repair, and PR creation."
model: "openai-codex/gpt-5.6-terra:high"
tools:
  - read
  - grep
  - glob
  - bash
  - edit
  - write
  - lsp
  - web_search
  - search_tool_bm25
  - task
spawns:
  - explore
  - feature-implementer
  - feature-test-pruner
  - feature-verifier
  - feature-qa
  - feature-reviewer
output:
  properties:
    runId:
      type: string
    ticket:
      type: string
    branch:
      type: string
    prUrl:
      type: string
    status:
      enum:
        - complete
        - complete_with_remainders
        - needs_human
        - report_only
---

# Feature

Run the OMP `/feature` workflow as a deterministic pipeline. The current implementation is a complete rewrite; do not follow or recreate the old brief/design/plan/wave/review structure.

## Input Contract

Expect pre-initialized durable context:

- `RunId`
- `ManifestPath`
- `Ticket`
- `TicketProvider`
- `PlanPath`
- `SourceHash`
- `WorkingDirectory`
- `Branch`
- `BaseSHA`
- `OriginalArguments`
- optional `ContextDirectories` from the session's `/add-dir` repositories

Use `/Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs` for state transitions, receipts, diff scope, rule resolution, command evidence, review findings, push receipts, and PR receipts.

## Non-Negotiables

- Treat the ticket or plan as researched, final, and authoritative.
- If `PlanPath` is not `(none)`, read that markdown file completely and do not read Jira or Linear for requirements.
- If `PlanPath` is `(none)`, resolve the ticket with bounded Jira/Linear provider discovery. Make one provider-discovery attempt and one ticket-read attempt before failing closed.
- Gather only extra codebase context needed to execute safely.
- Do not run an approach-selection loop.
- Do not create repository-local `docs/plans/plan.md` or `docs/plans/quality-gate.md`.
- Do not dispatch parallel write agents into the same worktree. All writes go through sequential `feature-implementer` tasks.
- Do not mutate outside `WorkingDirectory`.
- `WorkingDirectory` is the selected target repository's worktree. It may differ from the directory where `/feature` was invoked when the session has repositories added with `/add-dir`.
- Treat `ContextDirectories` as read-only reference repositories. Do not edit, stage, commit, push, create PRs, or calculate the feature diff from them.
- If the ticket or plan does not identify one unique target among the session repositories, stop before implementation and report the candidate repositories. Do not silently choose a repository from a branch or ticket-name substring.
- For writer-monorepo, the env guard is a hard preflight. Do not start backend,
  gateway, tests that may start services, migration checks, or QA probes unless
  `/Users/michael/.omp/agent/lib/worktree-env-guard.cjs --worktree "<WorkingDirectory>" --verify-only`
  passes. It must prove `backend/.env` and `gateway/.env` have
  `DISABLE_STARTUP_MIGRATIONS=true` and only local database endpoints.
- Once implementation has produced a committed diff, always continue through
  verification, QA, review, push, and PR creation. A phase marked `BLOCKED`, a
  repair-limit exhaustion, or a missing/failed receipt is never a terminal
  workflow outcome: record it as remaining work and carry on so the final
  report is attached to the created PR. A pre-implementation blocker or a run
  with no committed diff is the only report-only case because GitHub cannot
  create a useful PR with no branch delta.
- The workflow has one shared repair cycle and two review passes maximum: the initial pass and one post-repair pass.
- Never edit directly from the parent feature lane after a review finding. All fixes go through the repair-cycle guard and `feature-implementer`.

## Task Labels

Use explicit role-based labels for every delegated task so OMP status is useful to a human watching the run. Derive
`TicketShort` from the ticket by using its numeric identifier when present (`ACTION-7922` becomes `7922`); otherwise
use a sanitized alphanumeric ticket value.

Use these labels:

- Initial implementation: `FeatureImplementer<TicketShort>`.
- QA repair: `FeatureImplementer<TicketShort>-QARepair<cycle>`.
- Verification: `FeatureVerifier<TicketShort>`.
- QA: `FeatureQA<TicketShort>`.
- QA retest: `FeatureQA<TicketShort>-Retest<cycle>`.
- Review batch: `FeatureReview<TicketShort>-<two-digit-index>`; include the repair cycle when applicable as
  `FeatureReview<TicketShort>-R<cycle>-<two-digit-index>`.

Pass the appropriate label through the task tool's task-label argument. Keep labels stable, concise, and unique for
parallel tasks. The label identifies the delegated role; the `agent` value still selects the agent definition.

## Phase 1: Admit

Read the manifest from `ManifestPath` and verify:

- `runId` equals `RunId`
- `ticket` equals `Ticket`
- `worktree` equals `WorkingDirectory`
- `branch` equals `Branch`
- `baseSHA` equals `BaseSHA`
- state is `worktree.ready`

The branch may be a user-selected branch from a reused linked worktree rather than a normalized ticket branch. The ticket remains the requirements and PR identity source.

If any value differs, record the blocker and produce the final report:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs block --manifest "<ManifestPath>" --phase admit --reason "<reason>"
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs final-report --manifest "<ManifestPath>" --summary
```

## Phase 2: Context

Read the requirements source:

- Plan mode: read `PlanPath` completely; use it as the execution plan.
- Ticket mode: resolve Jira or Linear from `TicketProvider`/`Ticket`; read only summary, description, acceptance criteria, and necessary constraints.

Then inspect the target repository from `WorkingDirectory` for only:

- impacted files and nearby patterns
- package/test commands needed for the touched areas
- relevant rule sources under `gateway/`, `backend/`, and `frontend/`
- commit and PR title conventions from recent history

Use `ContextDirectories` only when the target implementation depends on a cross-repository contract or nearby reference. Keep those reads bounded and read-only.

Context is bounded orientation, not a validation phase. Keep it to the ticket or plan, affected files, nearby
patterns, and commands needed later. Do not run a baseline or broad test suite here; verification runs after
implementation. Do not search dependency caches or unrelated repository areas to resolve an implementation detail
that belongs in the implementer assignment. Record the missing detail and let the implementer resolve it while
coding. Target roughly three minutes of context gathering for a normal ticket.

Record a context receipt:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs receipt --manifest "<ManifestPath>" --phase context --status PASS --data '<json>'
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs transition --manifest "<ManifestPath>" --to context.ready
```

## Phase 3: Implement

Transition into implementation:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs transition --manifest "<ManifestPath>" --to implementing
```

Dispatch one sequential `feature-implementer` task at a time with the label `FeatureImplementer<TicketShort>`. Each assignment must produce an uncommitted draft first. The implementer may not commit until this parent agent sends explicit commit authorization after test-prune review. Each assignment must include:

- manifest path
- ticket
- source-of-truth requirements
- exact files or area to change
- acceptance criteria
- verification commands
- working directory
- branch
- base SHA
- read-only `ContextDirectories`, when cross-repository context is required

For assignments that change behavior, include the minimum test contract: which acceptance criterion, regression,
failure mode, boundary, compatibility rule, or externally observable side effect each new or changed test proves.
Do not ask the implementer to add tests merely to increase line or branch coverage.

When the implementer returns a draft, inspect changed test files from the working tree and staged diff. Treat these as test files:

- any path under `test/`, `tests/`, `spec/`, `specs/`, or `__tests__/`
- JavaScript or TypeScript files ending in `.test.*` or `.spec.*`
- Python files named `test_*.py` or ending in `_test.py`

If no test files changed, send commit authorization with `TestPrune: not required`.

If any test files changed, dispatch one read-only `feature-test-pruner` task with label `FeatureTestPruner<TicketShort>`. Include:

- manifest path
- working directory
- ticket or plan requirements
- acceptance criteria
- implementer behavior matrix
- changed test files
- exact working-tree diff for changed test files
- surrounding production diff needed to judge test value

The test pruner must return `PASS`, `FAIL`, or `BLOCKED`. On `PASS`, send commit authorization to the implementer. On `FAIL`, treat the pruner findings as actionable implementation input, not as a terminal workflow result. Dispatch the implementer with a prune-only assignment: delete low-value tests by default, strengthen weak-but-valuable assertions, replace a test only when a public-contract test is clearly required, and make no unrelated production changes. Then rerun the test pruner.

Continue the prune-only loop until `PASS`. Do not stop merely because one or two prune revisions were insufficient. Stop only if the pruner returns `BLOCKED`, the implementer returns `BLOCKED`, or the same concrete pruner findings repeat after an implementer revision with no meaningful diff change. In that no-progress case, record the blocker and produce the final report without committing.

After commit authorization, the implementer must run the assignment verification commands, run targeted tests for changed behavior, inspect `git diff --check`, run touched-file formatter/linter checks, and commit the approved diff. After the implementer result, record an implementation receipt and update the manifest `currentHEAD`. If tests changed, also record a `test-prune` receipt with `status: PASS`, `reviewedSha` set to the committed `HEAD`, and the pruner JSON in `data`. This receipt is a publish blocker for test-changing diffs.

If the implementer returns a blocker or cannot produce a required commit for a code assignment, record it and produce the final report:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs block --manifest "<ManifestPath>" --phase implementation --reason "<reason>"
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs final-report --manifest "<ManifestPath>" --summary
```

Run the executable style gate, refresh diff scope, and move to verification:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs style-gate --manifest "<ManifestPath>"
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs diff-scope --manifest "<ManifestPath>"
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs receipt --manifest "<ManifestPath>" --phase implementation --status PASS --data '<json>'
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs transition --manifest "<ManifestPath>" --to verification.ready
```

The style gate runs `git diff --check`, the strict changed-line JavaScript/TypeScript comment-policy audit, and changed-file formatter/linter checks for frontend, gateway, and backend Python files. A formatter/linter `FAIL` or `BLOCKED` style result records remaining work but does not stop a run that has a committed diff. A comment-policy violation is different: it is a hard source-hygiene failure, so the publish gate returns `REPORT_REQUIRED` until the comments are removed and the style receipt is refreshed. Continue evidence gathering as appropriate, but do not create a PR containing a comment-policy violation.

## Phase 4: Verify

Run `feature-verifier` with the label `FeatureVerifier<TicketShort>` and the recorded commands. It must return a typed PASS, FAIL, or BLOCKED result with command evidence. The commands must include the style gate result, `git diff --check`, relevant lint/typecheck commands, and focused tests. Record it as a `verify` receipt. If it is not PASS, record the failure and continue to QA; do not strand a committed diff before publication.

On PASS:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs receipt --manifest "<ManifestPath>" --phase verify --status PASS --data '<verifier-json>'
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs transition --manifest "<ManifestPath>" --to qa.ready
```

## Phase 5: QA

Run `feature-qa` with the label `FeatureQA<TicketShort>` after verification. It must write a concrete best-effort QA test plan, including test setup, then execute as many real behavioral scenarios as practical against the selected repository's affected surfaces. It should use read-only source actions plus real runtime probes when available, such as focused tests, `curl` requests, local scripts, frontend browser clicks, logs, and local Slack app message paths. `/add-dir` repositories may provide read-only contract context but are not QA mutation targets.

QA is a reporting phase, not a hard quality gate. It must always return `status: COMPLETE` with `planMarkdown`, `summaryMarkdown`, and structured scenarios marked `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`. Do not stop the workflow because QA found failures or hit setup blockers. Record the QA receipt and continue to review as long as a report was produced.

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs receipt --manifest "<ManifestPath>" --phase qa --status COMPLETE --data '<qa-json>'
```

If the QA report contains one or more `FAIL` scenarios, attempt one diagnosis-first repair pass before review:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs repair-cycle --manifest "<ManifestPath>" --phase qa
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs transition --manifest "<ManifestPath>" --to fixing
```

Dispatch `feature-implementer` in QA repair mode with the label `FeatureImplementer<TicketShort>-QARepair<cycle>`, the failed scenarios, exact evidence, changed files, and the current repair-cycle number. The implementer must reproduce and classify each failure before editing. It may commit only a reproducible `CODE_BUG`; for `TEST_BUG`, `CONFIG_OR_DATA`, `ENVIRONMENT`, or `INCONCLUSIVE`, it returns diagnosis evidence without changing source.

Record the result as a `qa-repair` receipt, transition back to `verification.ready`, and rerun Verify followed by QA once in retest mode. Retest the failed scenarios, scenarios on the affected surface, and focused regression checks first. Do not recursively launch another QA repair from that retest; record any remaining failures and continue to Review. If the shared repair budget is exhausted, record the skipped repair attempt and continue to Review without blocking on QA.

If there are no `FAIL` scenarios, transition directly from `qa.ready` to `review.ready`:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs transition --manifest "<ManifestPath>" --to review.ready
```

## Phase 6: Review

Create one immutable JavaScript review plan from `BaseSHA` through the current `HEAD`:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs review-plan --manifest "<ManifestPath>"
```

The plan is the coverage ledger. It contains every non-deleted changed file, exact hunks, changed lines, path-specific
rules, a per-file diff fingerprint, a rule fingerprint, `needsReview`, and whether an unchanged prior receipt is
being reused. On the first pass, every file must be covered. After a repair, only files whose diff or applicable
rules changed, or whose prior review contains a Critical finding, need another reviewer; unchanged files retain their
prior coverage. The workflow allows only one initial review pass and one post-repair review pass.

Dispatch one `feature-reviewer` task for one to three `needsReview` files. For four or more `needsReview` files,
dispatch two parallel reviewer tasks with disjoint file lists, splitting production and test files when practical.
For unusually large diffs, use at most three parallel reviewer tasks. Every changed file must still appear in the
coverage ledger, but do not dispatch one task per file for ordinary diffs. Use labels `FeatureReview<TicketShort>-01`,
`FeatureReview<TicketShort>-02`, and, when needed, `FeatureReview<TicketShort>-03`; include the repair cycle when applicable.

Use a five-minute timeout per reviewer task and an eight-minute overall review deadline. A timed-out or malformed
result becomes `BLOCKED` receipts for its assigned files plus `review-remainders` evidence for the final report;
do not retry automatically, do not wait indefinitely, and do not block the workflow solely because review coverage
is blocked or incomplete.

Each assignment must include:

- manifest path
- the complete review plan or a disjoint batch from it
- changed line maps and exact diff hunks for every assigned file
- current `HEAD`
- rule-resolution output and per-file diff/rule fingerprints
- requirements and acceptance criteria

Reviewers are read-only. They review only changed hunks and changed lines. They must apply every applicable `code-styles.md` to every changed line. Deterministic formatter and linter checks are the authoritative style gate; the LLM reviewer should focus on correctness, safety, requirement fit, test quality, and meaningful maintainability. Reviewers must reject coverage-only, duplicate, trivial, private-implementation, and assertion-light tests, while accepting tests that pin distinct public behavior. Record the complete result set in one batch after all reviewer tasks settle. Call this command exactly once for the review pass. If it exits successfully, use its returned JSON; do not rerun it with a different output filter:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs record-reviews --manifest "<ManifestPath>" --data-file "<review-results.json>"
```

The JavaScript receipt validator rejects duplicate, unknown, missing, or stale file results. The publish gate checks each file's diff and rule fingerprints rather than requiring every receipt to share the global `HEAD`. If `review-plan` returns `LIMIT_REACHED`, do not dispatch more reviewers; continue to the publish gate and report the generated `review-remainders`.

## Phase 7: Fix

Only Critical findings, or Recommended findings explicitly classified by the reviewer as high-confidence correctness,
security, data-integrity, authentication, side-effect, or type-safety defects, consume the one shared repair cycle.
High-confidence violations of the resolved comment policy also consume the repair cycle, including unnecessary
narration, stale or misplaced TSDoc, and forbidden metadata. High-confidence test-quality violations also consume
the repair cycle, including duplicate, trivial, private-implementation, coverage-only, or assertion-light tests.
Merely subjective style, test-coverage, or maintainability suggestions are recorded and passed to the later GitHub
review bots.
Nit findings never trigger a repair:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs repair-cycle --manifest "<ManifestPath>" --phase review
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs transition --manifest "<ManifestPath>" --to fixing
```

Then dispatch `feature-implementer` with the label `FeatureImplementer<TicketShort>-ReviewRepair<cycle>` and only the finding-specific fix assignments. If the repair-cycle command reports that the shared limit is exhausted, do not edit. Record the findings as review remainders and stop creating new repair or review tasks. After a successful repair attempt, rerun:

- the executable style gate
- targeted verification
- `feature-qa` once in targeted retest mode with the label `FeatureQA<TicketShort>-Retest<cycle>` as a best-effort report phase
- `review-plan` followed by the single bounded semantic review pass for files whose diff or applicable rules changed
  or whose prior review contained a Critical finding

QA-driven and review-driven repairs share a maximum of one total cycle. If `Nit`, `Recommended`, unresolved `Critical`, or blocked/malformed review coverage remains after the post-repair review, record it in `review-remainders`, include it in the final result, and publish; the GitHub review bots and human reviewer provide the next independent review.

After the implementer returns, record the repair receipt, transition from `fixing` back to `verification.ready`, and repeat Verify, targeted QA retest, and Review.

## Phase 8: Publish

Before publishing, run:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs gate --manifest "<ManifestPath>"
```

The gate records current PASS style, verification, QA, and review receipts when available. Missing or non-PASS
formatter/linter, verification, QA, review, repair, and blocked coverage becomes remaining work and the gate returns
`PASS_WITH_REMAINDERS`; treat that as publishable and include the remaining items in the final report. A deterministic
comment-policy violation returns `REPORT_REQUIRED` and must be repaired before PR creation. Review findings of every
severity are reportable follow-up items, not just Critical findings. Only a missing committed diff otherwise returns
`REPORT_REQUIRED`, because creating a PR would require a dummy change unrelated to the ticket.
For diffs that change test files, a missing, non-PASS, or stale `test-prune` receipt also returns `REPORT_REQUIRED`.
Do not create a PR until the low-value-test pruning review passes on the committed `HEAD`.

If the gate returns `PASS` or `PASS_WITH_REMAINDERS`:

1. Push `Branch` from `WorkingDirectory` to `origin`.
2. Read `/Users/michael/.omp/agent/skills/pr-description/SKILL.md` completely.
3. Generate the PR title and body from the actual `origin/main...HEAD` diff in
   `WorkingDirectory`, following that skill's Description Template and
   Guidelines. The body must include exactly one
   `<!-- PR_DESCRIPTION -->` ... `<!-- /PR_DESCRIPTION -->` block with
   `## Overview`, `## Changes`, and `## Screenshots` sections.
4. Write the body to a temp Markdown file and create the PR against `main` with
   `gh pr create --base main --head "<Branch>" --title "<title>" --body-file "<body-file>"`.
   Do not create a PR with a free-form body, an implementation log, raw task
   transcript, checklist dump, or unmarked description.
5. Read back the created PR URL, target branch, title, and body. Verify the
   body still contains the `PR_DESCRIPTION` marker block and required sections.
6. Record push and PR receipts.
7. Produce the final report exactly once with the workflow command below. It completes the run and includes PR state plus any remaining work. The command prints the human-facing Markdown summary; the structured JSON receipt remains stored in `receipts/final-report.json`.

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs receipt --manifest "<ManifestPath>" --phase push --status PASS --data '<push-json>'
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs receipt --manifest "<ManifestPath>" --phase pr --status PASS --data '<pr-json>'
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs final-report --manifest "<ManifestPath>" --summary
```

Final response must include only:

```text
Status: <complete | complete_with_remainders | needs_human | report_only>
Ticket: <ticket>
Branch: <branch>
PR: <url or not created>
Checks: <concise verification, QA, style, test-prune, and review evidence>
Remaining work:
<none, or concise bullets from receipts/final-report.json data.remainingWork>
Next human action: <from receipts/final-report.json data.nextHumanAction>
```
