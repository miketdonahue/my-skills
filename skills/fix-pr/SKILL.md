---
name: fix-pr
description: "Human slash-command only. Run only when the user explicitly invokes /fix-pr or /skill:fix-pr. Do not auto-select this skill for natural-language requests, PR work, bot comments, GitHub reviews, or child-agent workflows."
---

The user explicitly invoked `/fix-pr` or `/skill:fix-pr` with these arguments:

`$ARGUMENTS`

This skill is only a human-invoked slash-command wrapper. Do not perform the
PR-fix workflow in the main session. Delegate exactly once to `agent: fix-pr`.

## Human Invocation Gate

- Run this wrapper only for an explicit top-level human `/fix-pr` or
  `/skill:fix-pr` command.
- If this skill was selected because an agent or child task mentioned fixing PR
  comments, bot feedback, GitHub reviews, CodeRabbit, Cursor, Copilot, Codex,
  Devin AI, or GitHub Actions, stop immediately and report:

```text
Blocked: /fix-pr is human-invoked only. Ask the user to run /fix-pr explicitly.
```

- Do not invoke this wrapper from another agent, another skill, or a delegated
  task.

## Delegate

Invoke the `task` tool exactly once with:

- `agent`: `fix-pr`
- a concise task label describing the PR bot-comment fix
- structured context in this exact shape:

```text
InvocationSource: human-slash-command
OriginalArguments: $ARGUMENTS
WorkingDirectory: <current working directory>
```

Delegation rules:

- Use the single-agent task form only. Do not use batched `tasks[]`.
- Do not fetch PR data, edit files, commit, push, or resolve GitHub threads in the wrapper session.
- Do not add workflow instructions beyond the structured block above; the `fix-pr` agent owns execution.
- Wait for the delegated agent result.

## Relay

Relay the delegated agent's human-facing Markdown result. If the delegated result
contains both structured data and Markdown, show only the Markdown summary unless
the user explicitly asked for JSON. If it blocks, relay the blocker and requested
next input in Markdown.
