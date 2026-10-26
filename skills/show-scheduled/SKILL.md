---
name: show-scheduled
description: "Human slash-command only. List active cron jobs created by the OMP /schedule skill and ignore all unrelated machine cron entries."
---

The user invoked `/show-scheduled` with these arguments:

`$ARGUMENTS`

This skill is read-only. It must list only jobs created by `/schedule`, based on
the scheduler metadata and owned crontab marker blocks.

## Contract

- Accept no flags and no free-text arguments.
- Do not show unrelated cron jobs on this machine.
- Do not create, update, or delete cron entries.
- Print a simple Markdown table with exactly: `id`, `name`, `frequency`,
  `time`, and `prompt`.

## Execute

If `$ARGUMENTS` contains any non-whitespace characters, stop and report exactly:

```text
Error: /show-scheduled does not accept arguments.
```

Otherwise run:

```bash
node /Users/michael/.omp/agent/skills/schedule/scripts/workflow.cjs list
```

Return only the script output.
