---
name: create-ticket
description: "Create exactly one Linear ticket from a complete Markdown or HTML implementation plan. Use when the user invokes /create-ticket with --team wa or --team con and a plan file."
---

# Create One Ticket From a Plan

The user invoked /create-ticket with `--team`, a team value, and one plan file. Validate the input deterministically, delegate once to the create-ticket OMP agent, and stop. Do not create tickets in the main session.

Resolve `SKILL_DIR` to `/Users/michael/.omp/agent/skills/create-ticket` when running the bundled parser.

## Hard Boundaries

- Accept exactly three arguments: `--team`, `wa` or `con`, and one `.md` or `.html` plan path, in that order. No other user-facing flags are supported.
- Create exactly one Linear ticket in team `WA` for `wa` or team `CON` for `con`.
- Set the ticket status to `ToDo` and assign it to `Michael Donahue`.
- Reject plans that explicitly contain `Plan Status: Draft` before delegation
  or any provider call. A missing `Plan Status` marker is allowed for
  standalone plans created outside brainstorm/write-plan.
- Do not split the plan, create sub-issues, create dependency links, show a preview, or ask for approval before the write.
- Do not inspect credentials, modify MCP configuration, or implement ticket creation in the main session.
- Do not read brainstorm state or invoke a planning workflow. This skill is
  independently usable from any complete plan file.
- If validation or delegation fails, stop and report the failure. Do not take over manually.

## Parse and Validate

Preserve the raw user arguments, then identify the team value and plan path without reordering them. Run:

~~~bash
node "$SKILL_DIR/scripts/parse-ticket-args.cjs" \
  --team "<exact second argument>" \
  --plan "<exact third argument>" \
  --cwd "$PWD"
~~~

The parser returns JSON containing `teamKey`, `planPath`, and `extension`. It must reject missing or repeated options, unsupported teams, extra arguments, missing files, directories, empty files, unreadable files, and extensions other than `.md` or `.html`. The wrapper must reject a first argument other than `--team` before calling the parser.

On validation failure, stop with:

~~~text
Error: --team wa|con and one readable .md or .html plan file are required.
Usage: /create-ticket --team <wa|con> <plan.md|plan.html>
~~~

## Delegate Once

After validation, invoke the OMP `task` tool exactly once with:

- `agent`: `create-ticket`;
- a concise label containing the team key and plan filename;
- this structured context only:

~~~text
TeamKey: WA|CON
PlanPath: <absolute path>
OriginalArguments: <raw user arguments>
WorkingDirectory: <current working directory>
~~~

Use the single-agent task form. Do not add workflow instructions to the wrapper payload. After the task call, stop and let the delegated agent own Linear discovery, the single write, verification, and final reporting.
