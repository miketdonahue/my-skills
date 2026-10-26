---
name: diagnose
description: "Diagnose CI failures, bugs, production incidents, regressions, exceptions, flaky behavior, and performance problems in OMP. Use when the user asks to diagnose, debug, investigate, triage, or fix something broken, including log-backed investigations using Action-Id, request id, thread id, run id, agent run id, service, severity, or environment."
---

The user invoked `/diagnose` or `/skill:diagnose` with these arguments:

`$ARGUMENTS`

This skill is the OMP launcher for disciplined bug diagnosis. Do not run the
diagnosis in this wrapper session. Delegate exactly once to `agent: diagnose`.

## Contract

Accepted invocation:

```text
/skill:diagnose <bug report, failing command, incident note, id, @file, or artifact path>
```

Rules:

- Free-form input is allowed. Bug reports are naturally messy.
- If `$ARGUMENTS` is empty, still delegate; the agent should inspect the visible
  conversation and ask only if there is no actionable signal.
- The primary checkout is allowed for read-only discovery and repro planning.
- Tracked edits, migrations, commits, rebases, PR work, and auto-fixes require a
  linked worktree. If the current directory is not a linked worktree, diagnose
  read-only and stop before mutation. This wrapper and its delegated agent must
  never invoke `/worktree`, its workflow script, `git worktree add`, or Herdr
  worktree creation. Ask the user to invoke `/worktree` directly and rerun
  `/diagnose` from the resulting worktree if a fix is needed.
- The `log-explorer` skill is available. Production or log-backed reports with
  `Action-Id`, request id, thread id, run id, agent run id, service, level,
  cluster, or freshness hints should route through `log-explorer` before broad
  code hypotheses.
- A CI, test, lint, typecheck, build, or dependency-install failure is not a
  production log investigation. Start with the exact CI job output, artifacts,
  commit, and local reproduction when available. Do not query `log-explorer`
  unless the failing check explicitly exercises a live service or the user
  provides a separate runtime symptom to investigate.

## Resolve Context

Run this check before delegating:

```bash
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'LinkedWorktree: no\n'
  exit 0
fi
git_dir=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null || true)
git_common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
superproject=$(git rev-parse --show-superproject-working-tree 2>/dev/null || true)
if [ -n "$git_dir" ] && [ "$git_dir" != "$git_common" ] && [ -z "$superproject" ]; then
  printf 'LinkedWorktree: yes\n'
else
  printf 'LinkedWorktree: no\n'
fi
```

Set `MutationPolicy` from the result:

- `fix-in-linked-worktree` when `LinkedWorktree: yes`
- `read-only-primary` when `LinkedWorktree: no`

Never change `read-only-primary` by creating or opening a new worktree. Only a
direct human `/worktree` invocation may create one for this workflow.

## Delegate

Invoke the `task` tool exactly once with:

- `agent`: `diagnose`
- a concise task label based on the symptom or identifier
- structured context in this exact shape:

```text
OriginalArguments: $ARGUMENTS
WorkingDirectory: <current working directory>
MutationPolicy: read-only-primary|fix-in-linked-worktree
LinkedWorktree: yes|no
LogExplorerAvailable: yes
```

Delegation rules:

- Use the single-agent task form only. Do not use batched `tasks[]`.
- Do not diagnose, instrument, edit, or run the user's reproduction commands in
  the wrapper session.
- Do not add workflow instructions beyond the structured block above; the
  `diagnose` agent owns execution.
- Wait for the delegated agent result.

## Relay

The delegated agent must yield exactly one terminal result. Progress updates are
not terminal results and must not trigger a second delegation or diagnosis pass.
Relay the yielded human-facing Markdown result. If the yielded result contains
both structured data and Markdown, show only the Markdown diagnosis unless the
user explicitly asked for JSON. If it blocks, relay the blocker and requested
next input in Markdown.
