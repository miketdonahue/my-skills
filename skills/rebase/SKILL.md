---
name: rebase
description: "Rebase the current branch onto main, resolve conflicts, run checks, and push safely. Use when the user invokes /rebase, /skill:rebase, or asks to rebase the current PR or branch."
---

The user invoked `/rebase` or `/skill:rebase` with these arguments:

`$ARGUMENTS`

This skill is only a wrapper. Do not perform the rebase workflow in the main session. Delegate exactly once to `agent: rebase`.

## Delegate

Invoke the `task` tool exactly once with:

- `agent`: `rebase`
- a concise task label describing the branch rebase
- structured context in this exact shape:

```text
OriginalArguments: $ARGUMENTS
WorkingDirectory: <current working directory>
```

Delegation rules:

- Use the single-agent task form only. Do not use batched `tasks[]`.
- Do not run Git commands, resolve conflicts, commit, push, or force-with-lease in the wrapper session.
- Do not add workflow instructions beyond the structured block above; the `rebase` agent owns execution.
- Wait for the delegated agent result.

## Relay

Relay the delegated agent's human-facing Markdown result. If the delegated result
contains both structured data and Markdown, show only the Markdown summary unless
the user explicitly asked for JSON. If it blocks, relay the blocker and requested
next input in Markdown.
