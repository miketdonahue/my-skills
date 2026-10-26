---
name: orchestrate
description: "Launch top-level OMP orchestration workflows from a parent repo session. Use for `/orchestrate feature --ticket <id>` with optional `--plan <plan.md>` to create a Herdr worktree named from the ticket plus a short hash, start an unfocused OMP worker in that worktree, and run `/feature` there."
---

The user invoked `/orchestrate` with these arguments:

`$ARGUMENTS`

This skill is a current-session dispatcher. It launches worker sessions; it does
not implement feature work and does not delegate through OMP `task`.

## Contract

Accepted invocations:

- `/orchestrate feature --ticket <jira-or-linear-id>`
- `/orchestrate feature --ticket <jira-or-linear-id> --plan <plan.md>`

Rules:

- `feature` is the only supported subcommand.
- `--ticket` is always required.
- `--plan` is optional and must be used only with `feature --ticket`.
- Any other flags or free-form supplemental text are invalid.
- The worker command is always `/feature --ticket <id>` with optional
  `--plan <absolute-plan-path>`.
- Do not run `/feature` in the parent session.
- Do not create nested `/orchestrate` runs.

## Launch

Run the orchestrate workflow script from the current repository directory:

```bash
node /Users/michael/.omp/agent/skills/orchestrate/scripts/workflow.cjs launch \
  --cwd "$PWD" \
  --arguments "$ARGUMENTS"
```

The script creates a clean Herdr worktree at:

```text
~/.herdr/worktrees/<repo>/<normalized-ticket>-<4hex>
```

It opens the worktree in Herdr without stealing focus, starts an unfocused OMP
worker in that workspace, and passes the worker the real `/feature` command.

If the command fails, print only the script's output and stop. Do not fall back
to manual `/worktree`, raw background `omp &`, or parent-session `/feature`.

## Relay

On success, return only the script's final result:

```text
launched: feature
ticket: <ticket>
worktree: <absolute path>
branch: <normalized-ticket>-<4hex>
agent: feature-<normalized-ticket>-<4hex>
status: started
```

On failure, return only:

```text
blocked: <phase>
reason: <reason>
```
