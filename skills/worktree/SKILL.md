---
name: worktree
description: "Human-invoked only: create or reuse a Herdr-indexed worktree under `~/.herdr/worktrees` from the latest `origin/main` when the user directly invokes `/worktree`."
---

The user invoked `/worktree` with these arguments:

`$ARGUMENTS`

Run this skill only for a direct human `/worktree` invocation. Never invoke this workflow from a delegated task, another skill, or an agent's own decision to isolate work. Do not use `git worktree add`, `herdr worktree create`, or another wrapper as a workaround. If a task needs a new checkout, stop and ask the human to invoke `/worktree` and rerun the task from that checkout.

Run this workflow directly in the current session. Do not delegate via `task`.

## Parse

Parse an optional worktree name and optional runtime profile from `$ARGUMENTS`.
- Prefer the first positional argument, so `/worktree xyz` requests `xyz`.
- Also accept `--name <VALUE>` for compatibility.
- Accept `--gateway-slack` to provision a fully isolated backend, worker, gateway,
  and Slack-capable local runtime for `writer-monorepo`.
- If no name is present, set the requested name to `auto`.

## Execute

Run exactly one command that performs the full workflow.

Requirements:
- detect the project name from the current directory
- if already inside a linked worktree, reuse the current path and stop
- if the name is `auto`, generate it with `openssl rand -hex 4`
- if the user requests a name, append a random 4-character suffix, like `xyz-a1b2`
- for a fresh worktree, fetch the latest `origin/main`
- create the new worktree from `origin/main`, not from the local `main` branch
- create fresh worktrees through `herdr worktree create` when available, falling back to Git in Herdr's watched directory
- for writer-monorepo worktrees, run the env guard before reporting ready; the guard must materialize `backend/.env`
  and `gateway/.env` from `/Users/michael/development/writer/writer-monorepo`, force
  `DISABLE_STARTUP_MIGRATIONS=true`, and fail closed on non-local database endpoints
- when `--gateway-slack` is present, run the OMP-owned gateway Slack runtime setup after
  worktree creation; it must use isolated application state and never reuse or stop the
  primary checkout's processes or databases
- never run `git branch -f main origin/main`
- reuse an existing worktree path or existing branch/worktree pair without error
- output only the final four lines below, with no bullets, no prose, and no next steps

Construct the command with the exact invocation arguments shown above. Do not
rely on shell expansion of `$ARGUMENTS`: it is a skill placeholder and is not
guaranteed to exist as an environment variable in the terminal. Pass the
resolved value as one quoted argument, including an empty quoted argument when
the user invoked `/worktree` without a name.

Examples:

- `/worktree action-721-linear` uses `--arguments 'action-721-linear'`
- `/worktree --name action-721-linear` uses `--arguments '--name action-721-linear'`
- `/worktree` uses `--arguments ''`

Run exactly one command:

```bash
node /Users/michael/.omp/agent/skills/worktree/scripts/workflow.cjs invoke \
  --cwd "$PWD" \
  --arguments '<resolved invocation arguments>'
```

Replace `<resolved invocation arguments>` before execution. Do not pass that
placeholder literally.

After the command completes, respond with only these four lines from the command output:

```text
repo: <project>
worktree: <path>
branch: <branch>
status: ready
```

For an isolated Slack runtime, stop it before removing the worktree:

```bash
node /Users/michael/.omp/agent/skills/worktree/scripts/gateway-slack-runtime.cjs stop \
  --worktree <worktree-path>
```

The stop operation uses the runtime receipt to terminate only that worktree's processes and Docker project.
