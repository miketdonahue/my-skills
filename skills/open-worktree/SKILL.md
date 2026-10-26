---
name: open-worktree
description: "Focus or reopen one existing Herdr-managed worktree by exact name, branch, or path without creating a duplicate."
disable-model-invocation: true
---

The user invoked `/open-worktree` with these arguments:

`$ARGUMENTS`

This is a human-invoked slash command only. Do not invoke it from another skill
or agent.

Run this workflow directly in the current session. Do not delegate.

Execute exactly:

```bash
node /Users/michael/.omp/agent/skills/open-worktree/scripts/workflow.cjs invoke \
  --cwd "$PWD" \
  --arguments "$ARGUMENTS"
```

The command defaults to the current Git repository. Use `--repo <path>` when the
current directory is outside the target repository. It focuses an existing
workspace or reopens the exact parked worktree. It must not create a new
worktree as a fallback. Relay the command output verbatim.
