---
name: schedule
description: "Human slash-command only. Create a recurring cron-backed OMP prompt run in a dedicated scheduled-- Herdr worktree, with --help for accepted flags."
---

The user invoked `/schedule` with these arguments:

`$ARGUMENTS`

This skill is a human-invoked OMP scheduler. It creates real user crontab
entries and dedicated Herdr worktrees. Do not reinterpret it as a Codex
scheduled task.

## Contract

Accepted invocations:

- `/schedule --help`
- `/schedule --name <name> --frequency daily --time HH:MM --prompt "<prompt>"`
- `/schedule --name <name> --frequency weekdays --time HH:MM --prompt "<prompt>"`
- `/schedule --name <name> --frequency monthly --time HH:MM --prompt "<prompt>"`
- `/schedule --name <name> --frequency weekly --day <mon|tue|wed|thu|fri|sat|sun> --time HH:MM --prompt "<prompt>"`
- `/schedule --name <name> --interval <minutes> --prompt "<prompt>"`
- `/schedule --name <name> --frequency <daily|weekdays|monthly> --time HH:MM --skill <skill-name> [--skill-args "<args>"]`
- `/schedule --name <name> --frequency weekly --day <mon|tue|wed|thu|fri|sat|sun> --time HH:MM --skill <skill-name> [--skill-args "<args>"]`
- `/schedule --name <name> --interval <minutes> --skill <skill-name> [--skill-args "<args>"]`

Rules:

- `--time` is strict 24-hour Pacific local wall-clock time.
- `--interval` is an integer from 1 to 480 minutes.
- `--time` and `--interval` are mutually exclusive.
- When `--interval` is used, do not accept `--frequency` or `--day`.
- Interval jobs always run only Monday through Friday from 08:30 through 16:30
  Pacific local wall-clock time.
- `--prompt` and `--skill` are mutually exclusive targets.
- `--skill` must name an installed and enabled OMP skill.
- `--skill-args` is optional and only valid with `--skill`.
- `--help` prints usage and exits without creating worktrees or touching cron.
- Job setup is repo-scoped from the current working directory.
- Initial setup creates one dedicated Herdr worktree with the request name
  `scheduled--<job-slug>`.
- Future cron runs reuse the stored Git worktree and must not create another one.
- Before a new run, a completed scheduled workspace is closed and the same
  worktree is reopened with a fresh OMP agent identity.
- Scheduled runs reuse Herdr's existing shell pane. If Herdr does not expose
  that pane after reopening, the run fails closed instead of creating a second
  pane.
- A scheduled workspace that is working, blocked, unknown, or focused is left
  untouched and the new run is skipped.
- Closing a scheduled workspace never removes its Git worktree, branch, or
  files. Cleanup and deletion remain separate operations.

## Execute

Run the scheduler workflow script:

```bash
node /Users/michael/.omp/agent/skills/schedule/scripts/workflow.cjs schedule \
  --cwd "$PWD" \
  --arguments "$ARGUMENTS"
```

If it fails, return only the script output. On success, return only the script
output.
