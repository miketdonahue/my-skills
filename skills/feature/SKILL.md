---
name: feature
description: "Run the OMP `/feature` command as the current-session orchestrator with required `--ticket` and optional `--plan`: resolve the target from the session's added repositories, create or reuse its isolated Herdr worktree, implement, verify, QA, review, repair, and publish one PR."
---

The user invoked `/feature` with these arguments:

`$ARGUMENTS`

This skill is the current-session orchestrator for the deterministic OMP `feature` pipeline. Do not create a second outer `feature` task; use child tasks only for the specialized roles defined by the `feature` agent instructions.

The session's current directory is context, not automatically the feature target. The human may use `/add-dir` to make other repositories available to this session. Resolve the target repository from the ticket or plan and the repositories available in the session before admitting the run. The target may be different from the directory where `/feature` was invoked.

If the current repository is the only candidate or is the unique repository identified by the ticket or plan, use it for backwards compatibility. Otherwise inspect only the repositories supplied by `/add-dir`, verify each candidate with `git rev-parse --show-toplevel`, and choose the unique repository that matches the requested implementation and PR target. If the target is ambiguous, stop before admission and report the candidate repositories.

Use the selected target repository as the `--cwd` passed to admission. If it is already a clean linked worktree with a checked-out branch, the workflow reuses that worktree and branch. If it is a primary checkout, the workflow creates a new Herdr-linked worktree from that repository. Treat other `/add-dir` repositories as read-only context.

## Contract

Accepted invocation:

- `/feature --ticket <jira-or-linear-id>`
- `/feature --ticket <jira-or-linear-id> --plan <plan.md>`

Rules:

- `--ticket` is always required.
- `--plan` is optional and must be used only with `--ticket`.
- `--plan` is the only supported plan flag.
- Any other flags or free-form supplemental text are invalid.
- When `--plan` is present, the plan file is the sole requirements and execution source. Do not read Jira or Linear for requirements in that mode. Use the ticket only for branch and PR identity.

## Launch

After resolving `TargetRepository` from the session's `/add-dir` repositories and the ticket or plan, run the feature workflow script from that repository:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs admit \
  --cwd "<TargetRepository>" \
  --arguments "$ARGUMENTS"
```

If the command fails before a manifest exists, print a concise human-visible report with the script error and stop.

Then create or bind the isolated worktree. The command reuses the current linked worktree when the launcher was started inside one:

```bash
node /Users/michael/.omp/agent/skills/feature/scripts/workflow.cjs create-worktree \
  --run-dir "<runDir from admit output>"
```

If worktree creation or reuse fails, record the pre-implementation blocker and continue the durable report/publish path whenever the admitted branch already contains a committed diff. Do not fall back to a conversational `/worktree` result or continue in the primary checkout. A brand-new run with no committed diff has nothing meaningful to publish, so it may end report-only.
For writer-monorepo worktrees, `create-worktree` must also pass `/Users/michael/.omp/agent/lib/worktree-env-guard.cjs`
before the manifest reaches `worktree.ready`. That guard materializes `backend/.env` and `gateway/.env` from
`/Users/michael/development/writer/writer-monorepo`, forces `DISABLE_STARTUP_MIGRATIONS=true`, and rejects
non-local database endpoints such as dev-deer proxy targets.

## Execute

Read `/Users/michael/.omp/agent/agents/feature.md` completely and execute its phases directly in the current session using the context returned by `admit` and `create-worktree`.

The current session is the feature orchestrator. Preserve the exact durable context shape below when passing context to child roles:

```text
RunId: <runId>
ManifestPath: <manifestPath>
Ticket: <ticket>
TicketProvider: <ticketProvider>
PlanPath: <absolute plan path or (none)>
SourceHash: <sourceHash>
WorkingDirectory: <worktree>
Branch: <branch>
BaseSHA: <baseSHA>
OriginalArguments: $ARGUMENTS
ContextDirectories: <read-only /add-dir repositories, when needed>
```

Child-task rules:

- Do not create a second outer `feature` task.
- Use `task` only for the specialized roles named by `feature.md`, such as `feature-implementer`, `feature-verifier`, `feature-qa`, and `feature-reviewer`.
- Pass the current `ManifestPath`, `WorkingDirectory`, `Branch`, and `BaseSHA` to every child task.
- Pass any `/add-dir` repositories needed for read-only context as `ContextDirectories`; never use them for edits, staging, commits, diff scope, pushes, or PR creation.
- Keep all writes sequential in the reused or created worktree.

## Relay

Return the current orchestrator's final report as Markdown. A fully successful
publish includes the created PR URL. Do not surface raw receipt JSON unless the
user explicitly asks for JSON.
The PR must be created with the format required by `/Users/michael/.omp/agent/skills/pr-description/SKILL.md`.

Once an admitted run has a committed implementation diff, no phase may terminate the workflow before publication. Style, verification, QA, review, repair-limit, and blocked receipts are remaining-work evidence; continue through push and PR creation, then run `workflow.cjs final-report --manifest "<ManifestPath>" --summary` so the report includes the PR URL and every failed or missing check as Markdown. Only a run with no committed diff can end report-only because GitHub cannot create a useful PR with no branch delta. Do not create a replacement outer feature task.
