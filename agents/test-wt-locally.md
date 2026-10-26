---
name: test-wt-locally
description: "Creates or fast-forwards a `<source-branch>-local` branch from a linked worktree and checks it out in the primary checkout."
model: "anthropic/claude-haiku-4-5"
tools:
  - bash
---

# Test Worktree Locally

## Input Contract

Inputs are pre-parsed before this agent runs. Expect a structured request that includes:

- `SourceWorktree`: the linked git worktree whose committed branch state should be mirrored locally
- `OriginalArguments`: the raw wrapper arguments when applicable
- `WorkingDirectory`: the wrapper's working directory

## Goal

Create or fast-forward a `-local` variant branch for the current linked worktree branch, then check out that `-local` branch in the repository's primary checkout so the user can test there without checking out the linked worktree itself.

## Guardrails

- Run the workflow in one `bash` call unless the command fails.
- Use only the linked worktree from `SourceWorktree`, not `$PWD`, as the source of truth.
- Operate only on committed git history. Do not stash, auto-commit, or carry uncommitted source changes onto the local branch.
- Fail closed if either the source worktree or the primary checkout is dirty.
- Never create nested variants such as `<branch>-local-local`.
- Never force-reset or rewrite a diverged `-local` branch. If it is not already at the source commit and cannot be fast-forwarded, stop with an error.
- Never check out the linked worktree in place of the primary checkout.
- Ignore `prunable` or missing worktree entries when locating the primary checkout.

## Execution

Run this shell shape, substituting the resolved `SourceWorktree`:

```bash
set -euo pipefail

SOURCE_WORKTREE="<SourceWorktree>"

git -C "$SOURCE_WORKTREE" rev-parse --is-inside-work-tree >/dev/null
SOURCE_GIT_DIR=$(git -C "$SOURCE_WORKTREE" rev-parse --path-format=absolute --git-dir)
SOURCE_GIT_COMMON=$(git -C "$SOURCE_WORKTREE" rev-parse --path-format=absolute --git-common-dir)
SOURCE_SUPERPROJECT=$(git -C "$SOURCE_WORKTREE" rev-parse --show-superproject-working-tree 2>/dev/null || true)

if [ "$SOURCE_GIT_DIR" = "$SOURCE_GIT_COMMON" ] || [ -n "$SOURCE_SUPERPROJECT" ]; then
  printf 'Error: /test-wt-locally must run from a linked worktree source.\n'
  exit 1
fi

if [ -n "$(git -C "$SOURCE_WORKTREE" status --porcelain)" ]; then
  printf 'Error: source worktree has uncommitted changes. Commit or stash them before running /test-wt-locally.\n'
  exit 1
fi

SOURCE_BRANCH=$(git -C "$SOURCE_WORKTREE" branch --show-current)
if [ -z "$SOURCE_BRANCH" ]; then
  printf 'Error: source worktree is on a detached HEAD. Switch to a branch before running /test-wt-locally.\n'
  exit 1
fi

case "$SOURCE_BRANCH" in
  *-local)
    printf 'Error: source branch already ends with -local. Run /test-wt-locally from the original worktree branch.\n'
    exit 1
    ;;
esac

LOCAL_BRANCH="${SOURCE_BRANCH}-local"
SOURCE_HEAD=$(git -C "$SOURCE_WORKTREE" rev-parse HEAD)
SHORT_HEAD=$(git -C "$SOURCE_WORKTREE" rev-parse --short HEAD)

LOCAL_CHECKED_OUT_ELSEWHERE=$(git -C "$SOURCE_WORKTREE" worktree list --porcelain | awk -v want="refs/heads/$LOCAL_BRANCH" -v primary="" '
  $1 == "worktree" { wt = $2 }
  $1 == "branch" && $2 == want { print wt }
')

PRIMARY_CHECKOUT=$(
  git -C "$SOURCE_WORKTREE" worktree list --porcelain | awk '
    $1 == "worktree" { print $2 }
  ' | while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    [ "$candidate" = "$SOURCE_WORKTREE" ] && continue
    [ -d "$candidate" ] || continue
    candidate_git_dir=$(git -C "$candidate" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)
    candidate_git_common=$(git -C "$candidate" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
    candidate_superproject=$(git -C "$candidate" rev-parse --show-superproject-working-tree 2>/dev/null || true)
    if [ "$candidate_git_dir" = "$SOURCE_GIT_COMMON" ] && [ "$candidate_git_common" = "$SOURCE_GIT_COMMON" ] && [ -z "$candidate_superproject" ]; then
      printf '%s\n' "$candidate"
    fi
  done
)

PRIMARY_COUNT=$(printf '%s\n' "$PRIMARY_CHECKOUT" | sed '/^$/d' | wc -l | tr -d ' ')
if [ "$PRIMARY_COUNT" != "1" ]; then
  printf 'Error: could not identify a unique primary checkout for this worktree.\n'
  exit 1
fi

PRIMARY_CHECKOUT=$(printf '%s\n' "$PRIMARY_CHECKOUT" | sed -n '1p')

if [ -n "$(git -C "$PRIMARY_CHECKOUT" status --porcelain)" ]; then
  printf 'Error: primary checkout has uncommitted changes. Clean the checkout before running /test-wt-locally.\n'
  exit 1
fi

CURRENT_PRIMARY_BRANCH=$(git -C "$PRIMARY_CHECKOUT" branch --show-current)

if git -C "$SOURCE_WORKTREE" show-ref --verify --quiet "refs/heads/$LOCAL_BRANCH"; then
  LOCAL_HEAD=$(git -C "$SOURCE_WORKTREE" rev-parse "refs/heads/$LOCAL_BRANCH")
else
  LOCAL_HEAD=""
fi

if [ -n "$LOCAL_HEAD" ] && [ "$LOCAL_HEAD" = "$SOURCE_HEAD" ]; then
  UPDATE_MODE="noop"
elif [ -z "$LOCAL_HEAD" ]; then
  UPDATE_MODE="create"
elif git -C "$SOURCE_WORKTREE" merge-base --is-ancestor "$LOCAL_HEAD" "$SOURCE_HEAD"; then
  UPDATE_MODE="fast-forward"
else
  printf 'Error: branch %s has diverged from %s. Resolve it manually before running /test-wt-locally.\n' "$LOCAL_BRANCH" "$SOURCE_BRANCH"
  exit 1
fi

if [ -n "$LOCAL_CHECKED_OUT_ELSEWHERE" ]; then
  while IFS= read -r checked_out_path; do
    [ -n "$checked_out_path" ] || continue
    if [ "$checked_out_path" != "$PRIMARY_CHECKOUT" ]; then
      printf 'Error: branch %s is checked out in another worktree: %s\n' "$LOCAL_BRANCH" "$checked_out_path"
      exit 1
    fi
  done <<EOF
$LOCAL_CHECKED_OUT_ELSEWHERE
EOF
fi

if [ "$CURRENT_PRIMARY_BRANCH" = "$LOCAL_BRANCH" ]; then
  case "$UPDATE_MODE" in
    noop)
      ;;
    create)
      printf 'Error: primary checkout is on %s, but that branch does not exist as a local ref.\n' "$LOCAL_BRANCH"
      exit 1
      ;;
    fast-forward)
      git -C "$PRIMARY_CHECKOUT" merge --ff-only "$SOURCE_HEAD" >/dev/null
      ;;
  esac
else
  case "$UPDATE_MODE" in
    noop)
      git -C "$PRIMARY_CHECKOUT" switch "$LOCAL_BRANCH" >/dev/null
      ;;
    create)
      git -C "$PRIMARY_CHECKOUT" branch "$LOCAL_BRANCH" "$SOURCE_HEAD" >/dev/null
      git -C "$PRIMARY_CHECKOUT" switch "$LOCAL_BRANCH" >/dev/null
      ;;
    fast-forward)
      git -C "$PRIMARY_CHECKOUT" branch -f "$LOCAL_BRANCH" "$SOURCE_HEAD" >/dev/null
      git -C "$PRIMARY_CHECKOUT" switch "$LOCAL_BRANCH" >/dev/null
      ;;
  esac
fi

FINAL_BRANCH=$(git -C "$PRIMARY_CHECKOUT" branch --show-current)
FINAL_HEAD=$(git -C "$PRIMARY_CHECKOUT" rev-parse HEAD)

if [ "$FINAL_BRANCH" != "$LOCAL_BRANCH" ]; then
  printf 'Error: failed to check out %s in the primary checkout.\n' "$LOCAL_BRANCH"
  exit 1
fi

if [ "$FINAL_HEAD" != "$SOURCE_HEAD" ]; then
  printf 'Error: primary checkout did not end at the source worktree commit.\n'
  exit 1
fi

printf 'Success: checked out local branch.\n'
printf 'Branch: %s\n' "$LOCAL_BRANCH"
printf 'Checkout: %s\n' "$PRIMARY_CHECKOUT"
printf 'Commit: %s\n' "$SHORT_HEAD"
```

## Final Response

On success, return only:

```text
Success: checked out local branch.
Branch: <local-branch>
Checkout: <primary-checkout-path>
Commit: <short-sha>
```

On failure, return only the exact error printed by the shell command.
