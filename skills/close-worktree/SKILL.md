---
name: close-worktree
description: "Delete clean Herdr-managed worktrees automatically when their PRs merge or no PR exists, and ask before deleting other worktrees."
disable-model-invocation: true
---

The user invoked `/close-worktree` with these arguments:

`$ARGUMENTS`

This is a human-invoked slash command only. Do not invoke it from another skill
or agent.

Run this workflow directly in the current session. Do not delegate.

Execute exactly:

```bash
node /Users/michael/.omp/agent/skills/close-worktree/scripts/workflow.cjs invoke \
  --cwd "$PWD" \
  --arguments "$ARGUMENTS"
```

Provide exact worktree directory names, branch names, or absolute paths separated
by spaces. With no target, the command infers the current managed linked
worktree from `$PWD`. Use `--repo <path>` outside the target repository only
with an explicit target. An explicitly selected focused or working worktree
always requires confirmation. When no target is given, the command infers the
current worktree and treats that invocation as explicit close intent.

The command checks GitHub for pull requests whose head branch matches each
worktree branch. A worktree with only merged PRs, or with no matching PR, is
deleted automatically when its Git working tree is clean and it is not
protected as focused or working, unless it is the inferred current worktree.
The linked Git worktree and ignored build output are removed; the branch is
preserved. A worktree with an open or unmerged PR, multiple matching PRs, an
unverifiable PR state, local changes, or active workspace protection is left
in place and requires confirmation. The command never parks a worktree.

When output includes a confirmation ID, tell the user which worktrees need
confirmation and why. Ask whether to delete only those marked for confirmation.
Some worktrees in the same invocation may already have been deleted because
their PRs were merged or no PR exists. Include the warning that local changes
will be discarded when the output says a target has uncommitted changes. Do not
delete them until the user directly approves.

After a direct affirmative reply, execute:

```bash
node /Users/michael/.omp/agent/skills/close-worktree/scripts/workflow.cjs confirm <confirmation-id>
```

After a direct negative reply, execute:

```bash
node /Users/michael/.omp/agent/skills/close-worktree/scripts/workflow.cjs cancel <confirmation-id>
```

If confirmation reports that the worktree changed since the prompt and issues a
new confirmation ID, ask the user again before using that new ID. Confirmation
requests expire after one hour. If the user wants to delete only some of a
listed group, cancel the request and start a new `/close-worktree` invocation
for just those targets.

When the current worktree was inferred and is deleted, the command focuses the
next open workspace in the same repository, or the primary repository
workspace if no managed worktree remains open.

Report the command result in Markdown. Do not invoke the confirmation or cancel
command without a direct user reply to the pending question.
