---
name: peer-review
description: "Human slash-command only. Run an independent exact-head PR review, label bot overlap afterward, and preview one novel-findings comment before posting."
---

The user explicitly invoked `/peer-review` or `/skill:peer-review` with these
arguments:

`$ARGUMENTS`

This wrapper is human-invoked only. Do not select it from another agent, skill,
or delegated task.

## Interface

Accept exactly:

```text
/peer-review https://github.com/{owner}/{repo}/pull/{number}
/skill:peer-review https://github.com/{owner}/{repo}/pull/{number}
```

Let the deterministic preflight reject malformed input, and repeat validation in
the peer-review agent as a defense in depth check. Always run preflight before
delegation:

```text
node /Users/michael/.omp/agent/skills/peer-review/scripts/workflow.cjs \
  preflight --arguments "$ARGUMENTS" --cwd <current-working-directory>
```

If preflight reports that `openai-codex/gpt-5.6-sol:high` is unavailable, stop
and display its Markdown blocker. Do not delegate to a fallback model.

## Delegate once

Invoke the task tool once with exactly one task entry:

- `agent`: `peer-review`
- label: `PeerReview{pullNumber}` when the number is available
- context and task:

```text
InvocationSource: human-slash-command
OriginalArguments: $ARGUMENTS
WorkingDirectory: <current working directory>
```

Do not fetch PR data, inspect code, reveal bot comments, or draft findings in
the wrapper session. Wait for the delegated result.

## Relay

Relay only the delegated human-facing Markdown. Keep internal JSON hidden unless
the user explicitly requests it. If the review blocks, relay the blocker and
the exact input or action needed.

For a completed review, relay the single comment preview and Post/Edit/Skip
choice without adding a separate review report. Preserve normal rendered
Markdown: do not wrap the delegated preview in a code fence, indent it as code,
or escape its Markdown syntax. GitHub receives the underlying Markdown comment
body only, without the preview heading, warnings, or approval prompt.
