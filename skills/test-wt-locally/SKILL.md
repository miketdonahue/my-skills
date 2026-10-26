---
name: test-wt-locally
description: "Finds the active linked worktree, then delegates local branch materialization to the `test-wt-locally` agent."
---

The user invoked `/test-wt-locally` with these arguments:

`$ARGUMENTS`

This skill is only a wrapper. Do not perform the local-branch workflow in the main session.

## Parse and validate

This command accepts no flags and no free-text arguments.

Validation rules:

- If `$ARGUMENTS` contains any non-whitespace characters, stop and report exactly: `Error: /test-wt-locally does not accept arguments.`

## Resolve the source worktree

Before delegating, determine `SourceWorktree`.

- If the current working directory is a linked git worktree, set `SourceWorktree` to the current working directory.
- If the current working directory is not a linked git worktree, inspect the visible conversation for the most recent `/worktree` result in this exact shape:

```text
repo: <project>
worktree: <absolute path>
branch: <branch>
status: ready
```

- If that most recent `/worktree` result exists, set `SourceWorktree` to its `worktree:` path after validating the path with the shell check below.
- If no valid recent `/worktree` result exists, stop with the exact error shown in the shell check below and do not delegate.

Run this check against the candidate `SourceWorktree` before the `task` call:

```bash
worktree="<SourceWorktree>"
git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null
git_dir=$(git -C "$worktree" rev-parse --path-format=absolute --git-dir)
git_common=$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir)
superproject=$(git -C "$worktree" rev-parse --show-superproject-working-tree 2>/dev/null || true)
if [ "$git_dir" = "$git_common" ] || [ -n "$superproject" ]; then
  printf 'Error: /test-wt-locally must run inside a linked worktree. Run /worktree and invoke /test-wt-locally after the worktree path is reported.\n'
  exit 1
fi
```

- If the check prints the error above or exits nonzero, stop immediately and do not delegate.
- Never pass the primary checkout as `SourceWorktree`.

## Delegate

Immediately invoke the `task` tool exactly once with:

- `agent`: `test-wt-locally`
- a concise task label describing the local branch materialization
- structured context in this exact shape:

```text
SourceWorktree: <absolute path>
OriginalArguments: $ARGUMENTS
WorkingDirectory: <current working directory>
```

Delegation rules:

- Use the single-agent task form only. Do not use batched `tasks[]`.
- Do not include `tasks`, `role`, `assignment`, `subagent`, `worker`, or helper-agent names anywhere in the wrapper payload.
- Do not add your own branch-update steps, git strategy prose, or acceptance criteria to the delegated payload.
- The delegated `context` must be only the exact structured block above.
- After issuing the `task` call, wait for the delegated `test-wt-locally` agent's completion result.
- If the `task` call fails synchronously, report only that failure and do not attempt the workflow manually.

## Post-task relay contract

When the delegated `test-wt-locally` agent completes:

- Print its final user-facing result verbatim and nothing else.
- The final user-facing result must be Markdown/plain text, not raw JSON, unless
  the user explicitly asked for JSON.
- Do not summarize the workflow in your own words.
- Do not add headings, transcript links, inventories, or next steps.
