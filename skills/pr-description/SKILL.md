---
name: pr-description
description: Generate and apply a succinct PR description by diffing the current branch against origin/main. Produces a motivation-first what/why description and writes it directly to the GitHub PR while preserving existing content.
---

# PR Description Generator

Generate a succinct PR description by comparing the current branch against `origin/main`, then apply it directly to the GitHub PR.

## When to Use

- User asks for a "PR description" or "pull request description"
- User asks to create a PR, raise a PR, or open a pull request
- User wants to document their changes before opening a PR
- User says "describe my changes" or similar
- You are opening or updating a PR after significant code changes
- You have just completed a multi-file feature, bugfix, or refactor and are ready to push

## Steps

### 1. Ensure local build metadata exists

Before committing, pushing, creating, or updating a PR, ensure the frontend's gitignored build metadata exists so direct `tsc` invocations in hooks do not fail on `src/lib/logger.ts` importing `./build-metadata`.

```bash
if [ -d frontend ] && [ ! -f frontend/src/lib/build-metadata.ts ]; then
  (cd frontend && node scripts/generate-build-metadata.mjs)
fi
```

Do not stage `frontend/src/lib/build-metadata.ts`; it is intentionally ignored.

### 2. Analyze the diff against `origin/main`

Always compare against `origin/main`. The three-dot syntax (`...`) computes the merge-base automatically.

```bash
git fetch origin main
git branch --show-current
git log origin/main..HEAD --oneline
git diff origin/main...HEAD --stat
git diff origin/main...HEAD
```

Read and analyze the actual code changes to understand what was modified and why.

### 3. Generate the description

Compose the description using the template and guidelines below.

### 4. Apply to the PR

Check whether a PR already exists for this branch:

```bash
gh pr view --json number,body 2>/dev/null
```

If a PR exists, update it while preserving existing content:

1. Read the current body from the `gh pr view` output.
2. If the body already contains a `<!-- PR_DESCRIPTION -->...<!-- /PR_DESCRIPTION -->` block, replace only that block with the new description wrapped in the same markers.
3. If no markers exist, prepend the new description wrapped in markers before the existing body, separated by `\n\n---\n\n`.
4. Write the merged body to a temp file, then apply it to avoid shell escaping issues with quotes, backticks, and newlines in the body:

```bash
cat > /tmp/pr-body.md <<'PRBODY'
<merged_body>
PRBODY
gh pr edit <number> --body-file /tmp/pr-body.md
```

If no PR exists, output the description in a fenced `markdown` code block so the user can copy-paste it, or use it when creating the PR.

## Description Template

```markdown
<!-- PR_DESCRIPTION -->
## Overview

[1-3 sentence motivation paragraph. Why is this change needed? What problem does it solve?]

[ACTION-XXXX](https://writerai.atlassian.net/browse/ACTION-XXXX)

## Changes

| What | Why |
|------|-----|
| [What changed] | [Why it was needed] |
| [What changed] | [Why it was needed] |

## Screenshots

_N/A - no UI changes_
<!-- /PR_DESCRIPTION -->
```

## Guidelines

### Overview Section

- Lead with motivation: what problem exists, or what user/system need this serves
- Keep it to 1-3 sentences so a reviewer understands the why quickly
- Use present tense, such as "Adds", "Fixes", or "Removes"
- Place the Jira ticket link on its own line directly below the summary paragraph

### Ticket Extraction

- Extract ticket number from branch name using pattern: `action-XXXX-*` to `ACTION-XXXX`
- Format as hyperlink: `[ACTION-XXXX](https://writerai.atlassian.net/browse/ACTION-XXXX)`
- If no ticket number is found in the branch name, omit the ticket line

### Changes Section

- Limit to 4 rows maximum. Distill the diff down to the most important changes.
- Use a two-column Markdown table with headers `What` and `Why`.
- The `What` cell is a concise description of the concrete change, such as "Remove `Files Changed` section from PR template".
- The `Why` cell explains the reasoning or benefit, such as "Reviewers already see file diffs in the PR; the section added noise".
- Do not list every file or minor edit. Focus on changes that matter to a reviewer.
- If there is only one meaningful change, one row is fine.

### Screenshots Section

- Include only when the PR contains UI changes.
- If no UI changes, keep the placeholder `_N/A - no UI changes_`.

### Preserving Existing PR Content

- Never discard content outside the `<!-- PR_DESCRIPTION -->` markers, such as Cursor agent links, CodeRabbit summaries, or manual reviewer notes.
- When replacing the marker block, keep all surrounding content exactly as-is.
- When prepending to a body with no markers, add a horizontal rule (`---`) between the new description and the old content.

### Edge Cases

- Large diffs over 500 lines: distill to the 3-4 highest-impact changes and omit trivial ones.
- Multiple tickets: list all ticket links in the Overview.
- No changes: inform the user that there are no committed changes to describe.
- `gh` CLI not authenticated: fall back to outputting the description for copy-paste.
