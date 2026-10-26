---
name: critique
description: "Human slash-command only. Open one HTML file in the local critique review app, then delegate the bounded feedback/edit/reply loop to the critique agent."
---

The user explicitly invoked `/critique` or `/skill:critique` with these arguments:

`$ARGUMENTS`

This skill is only a human-invoked slash-command wrapper. It opens or resumes the
local critique browser review for exactly one HTML file, then delegates the
feedback/edit loop exactly once to `agent: critique`.

Do not perform the review loop in this wrapper session.

## Human Invocation Gate

- Run this wrapper only for an explicit top-level human `/critique` or
  `/skill:critique` command.
- If this skill was selected because an agent or child task mentioned critique,
  review feedback, browser annotations, or HTML editing, stop immediately and
  report:

```text
Blocked: /critique is human-invoked only. Ask the user to run /critique explicitly.
```

- Do not invoke this wrapper from another agent, another skill, or a delegated
  task.

## Contract

Accepted invocations:

```text
/critique <html-file>
/skill:critique <html-file>
```

Rules:

- Accept exactly one HTML file argument.
- The argument may be quoted and may contain spaces.
- Reject empty input, flags, missing files, directories, unreadable files, and
  files whose extension is not `.html` or `.htm`.
- Resolve the file to its canonical absolute path before launching critique.

## Parse and Validate

Resolve `SKILL_DIR` to `/Users/michael/.omp/agent/skills/critique` and run:

```bash
node "$SKILL_DIR/scripts/parse-critique-args.cjs" \
  --arguments "$ARGUMENTS" \
  --cwd "$PWD"
```

The parser returns JSON containing `filePath`, `extension`, and `workingDirectory`.

On validation failure, stop with:

```text
Error: /critique requires exactly one readable .html or .htm file.
Usage: /critique <file.html>
```

## Preflight

Use these constants:

```text
CritiqueRoot: /Users/michael/development/writer/tools/critique
CritiqueBin: /Users/michael/development/writer/tools/critique/bin/critique
PollTimeoutMs: 60000
```

Before launch:

- Verify `bun` is available.
- Verify `CritiqueBin` exists and is executable.
- Verify the built critique assets exist:
  - `/Users/michael/development/writer/tools/critique/dist/chrome/index.html`
  - `/Users/michael/development/writer/tools/critique/dist/sdk/sdk.js`
- If either built asset is missing, run exactly:

```bash
bun run build
```

from `/Users/michael/development/writer/tools/critique`.

- If the build fails, report the build failure and do not delegate.
- Run `"$CritiqueBin" instructions` once. If it fails, report the failure and do
  not delegate.

## Launch

Open or resume the browser review session with the canonical file path from the
parser by running the launcher script:

```bash
node "$SKILL_DIR/scripts/launch-critique-session.cjs" \
  --bin "$CritiqueBin" \
  --file "<FilePath>"
```

The launcher script creates or resumes the critique session with `--no-open`,
extracts the session URL, opens the browser exactly once, and intentionally does
not print the raw URL. This avoids double-opening from both the CLI and the OMP
terminal reacting to the printed URL.

If launch fails, report the failure and do not delegate. Do not run
`"$CritiqueBin" "<FilePath>"` directly from this wrapper.

## Delegate

Invoke the `task` tool exactly once with:

- `agent`: `critique`
- a concise task label containing the reviewed filename
- structured context in this exact shape:

```text
InvocationSource: human-slash-command
WorkingDirectory: <current working directory>
CritiqueRoot: /Users/michael/development/writer/tools/critique
CritiqueBin: /Users/michael/development/writer/tools/critique/bin/critique
FilePath: <canonical absolute HTML file path>
PollTimeoutMs: 60000
SessionAlreadyOpened: yes
```

Delegation rules:

- Use the single-agent task form only. Do not use batched `tasks[]`.
- Do not add your own review-loop instructions beyond the structured block
  above; the `critique` agent owns polling, editing, replying, and stopping.
- Wait for the delegated agent result.

## Relay

Relay the delegated agent's human-facing Markdown result. If the delegated result
contains both structured data and Markdown, show only the Markdown critique
summary unless the user explicitly asked for JSON. If it blocks, relay the
blocker and requested next input in Markdown.
