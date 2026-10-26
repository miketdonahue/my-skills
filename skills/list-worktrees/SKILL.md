---
name: list-worktrees
description: "List Herdr-managed worktrees for the current repository, including open and parked worktrees, without changing state."
disable-model-invocation: true
---

The user invoked `/list-worktrees` with these arguments:

`$ARGUMENTS`

This is a human-invoked slash command only. Do not invoke it from another skill
or agent.

Run this workflow directly in the current session. Do not delegate.

Execute exactly:

```bash
node /Users/michael/.omp/agent/skills/list-worktrees/scripts/workflow.cjs invoke \
  --cwd "$PWD" \
  --arguments "$ARGUMENTS"
```

The command defaults to the current Git repository. Use `--repo <path>` when the
current directory is outside the target repository. Any text after the command
is a case-insensitive substring search against the Branch column, for example
`/list-worktrees 8663`. Only matching worktrees are returned. The output includes
the latest recorded OMP session activity in UTC and sorts newest activity first;
worktrees without recorded session activity appear last. Relay the command
output verbatim. The command is read-only.
