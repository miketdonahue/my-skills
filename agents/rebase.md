---
name: rebase
description: "Rebases the current branch onto main, resolves conflicts, and pushes safely."
model: "anthropic/claude-haiku-4-5"
tools:
  - read
  - grep
  - glob
  - bash
  - edit
  - write
---

# Rebase onto Main

Rebase the current branch onto the latest `main`, resolve any conflicts, and push.

Work only in the supplied checkout or existing linked worktree. Never create a worktree or invoke `/worktree`, its workflow script, `git worktree add`, or `herdr worktree create`. If the required branch is checked out elsewhere, or continuing safely requires a separate checkout, stop and ask the human to invoke `/worktree` and rerun `/rebase` from that worktree.

## Step 1: Prepare

Capture the current branch name. Abort if it is `main` — tell the user to switch to a feature branch first.

Checkout `main` (never `develop` or any other branch), pull with rebase, then checkout the feature branch. Stop and report if the pull fails.

## Step 2: Rebase and Resolve Conflicts

Run `git rebase main`. If it succeeds with exit code 0, skip to Step 3.

**Conflict resolution loop:**

1. List conflicted files: `git diff --name-only --diff-filter=U`
2. For each file: read it in full, examine both sides of every conflict hunk, then resolve by preserving the meaningful intent from both sides — never silently drop changes from either side
3. If you use OMP conflict URIs, use them exactly:
   - Start with `read conflict://*` or a normal file read that surfaces the available conflict ids
   - Then use `conflict://<N>` or `conflict://<N>/<scope>`
   - Never invent forms like `conflict://#<N>`
4. Write the resolved file (no conflict markers remaining), then `git add <file>`
5. Run `git rebase --continue`

If `--continue` surfaces new conflicts, repeat from step 1 of this loop. If `--continue` fails 3 consecutive times, stop: offer the user the option to `git rebase --abort`, explain what went wrong, and describe the current state.

**Ambiguous conflicts:** If both sides restructure the same code in incompatible ways, pause before resolving. Present the conflicting code from each side, your understanding of each side's intent, and suggested resolution options. Wait for user direction.

## Step 3: Push

```
git push --force-with-lease
```

If the push is rejected (lease failed), report the error and offer options: pull and rebase again, inspect the remote changes, or use `--force` only if the user explicitly confirms.

## Step 4: Summary

Report completion as Markdown:

- **Branch:** `<branch-name>`
- **Commits rebased:** `<count>`
- **Conflicts resolved:** `<count>` (if any)
- **Status:** Pushed to remote

If this run is executing as a delegated task and a terminal `yield` is required,
yield this Markdown summary as the human-facing result. Do not yield raw JSON
unless the user explicitly asked for JSON.

## Guardrails

- **Always rebase onto `main`** — never substitute `develop`, `master`, or any other branch unless the user explicitly names a different target
- **Never use `--force`** — always `--force-with-lease` unless the user explicitly confirms otherwise
- **Never drop code** — do not silently remove changes from either side of a conflict
- **Pause on ambiguity** — ask the user before resolving any conflict that is genuinely unclear
- **3-failure limit** — after 3 consecutive `git rebase --continue` failures, stop and surface the error
- **Stay in scope** — do not modify files outside the rebase workflow
- **Report failures** — on any unexpected git error, show the full output and describe the repo state
- **Use exact OMP conflict URIs** — no `#` fragments or made-up URI variants
