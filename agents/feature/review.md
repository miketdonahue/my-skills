# Deterministic Feature Review

This review procedure is diff-scoped and read-only. It replaces the old broad review fan-out, mutable gateway review lane, and conversational quality ledger.

## Inputs

The parent `feature` agent must provide:

- `ManifestPath`
- `WorkingDirectory`
- `Ticket`
- source-of-truth requirements
- acceptance criteria
- `BaseSHA`
- current `HEAD`

## Diff Scope

Compute review scope with:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs diff-scope --manifest "<ManifestPath>"
```

Review only non-deleted changed files and only their changed hunks/changed lines.

## Rule Resolution

For each changed file, run:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs rules --manifest "<ManifestPath>" --file "<file>"
```

Apply:

- `gateway/`: repository gateway review/style rules.
- `backend/`: nearest backend `agents.md` or `AGENTS.md`.
- `frontend/`: nearest frontend `agents.md` or `AGENTS.md`.
- every applicable `code-styles.md` or `code-style.md` to every changed line. For strict JavaScript/TypeScript paths,
  the deterministic comment audit is authoritative: no inline, block, file-header, separator, metadata, or verbose
  TSDoc comments are acceptable.
- every added or materially changed test against the test-quality contract: distinct behavior or risk, public
  assertions, appropriate test level, and no coverage-only, duplicate, trivial, or private-implementation test.
  High-confidence low-value tests should be classified as `test-quality`; the default fix is deletion unless
  stronger assertions or one replacement public-contract regression test is clearly required.

Missing required path rules are blocking.

## Dispatch

Dispatch one bounded `feature-reviewer` task for the complete review plan. For unusually large diffs, shard into at most three disjoint batches, still within one review pass. Do not dispatch one task per file. Use a five-minute timeout per task and a ten-minute overall deadline; do not retry timed-out tasks.

Each task must include:

- working directory
- manifest path
- complete review plan or a disjoint batch
- current `HEAD`
- exact diff hunks and changed-line maps for every assigned file
- rule-resolution output and fingerprints for every assigned file
- requirements and acceptance criteria

## Receipts

Record every file result from the batch:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs record-review --manifest "<ManifestPath>" --file "<file>" --data '<review-json>'
```

The receipt must include file, rule sources, reviewed SHA, changed lines, findings, fingerprints, and verdict.

## Fix Loop

All reviewers are read-only. Fixes go only through `feature-implementer`.

After the one allowed repair:

- rerun targeted verification
- rerun the style gate and targeted verification
- rerun `feature-qa` as a best-effort targeted retest
- rerun one bounded semantic review pass for affected files

Run at most one repair cycle and two total review passes. After the post-repair pass, `Critical` findings, blocked review receipts, missing coverage, and stale coverage are recorded as review remainders for the human; they do not create another local loop or stop publication by themselves. `Recommended` and `Nit` findings are recorded for the GitHub review bots.

## Exit Gate

Before PR creation, run:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs gate --manifest "<ManifestPath>"
```

The gate requires:

- current PASS verification receipt
- QA report receipt
- current PASS style receipt
- a PASS deterministic comment audit when the changed scope includes governed JavaScript/TypeScript files

If review coverage is missing, stale, blocked, over the two-pass limit, or still has unresolved Critical findings, the gate writes `receipts/review-remainders.json` and may return `PASS_WITH_REMAINDERS`. Treat that as publishable; the parent feature agent must summarize the remaining review items for the human.

If verify, QA, or style prerequisites are missing or not PASS, the gate returns `REPORT_REQUIRED`. Do not publish; the parent feature agent must run `final-report` and return the human-visible remaining work report.
