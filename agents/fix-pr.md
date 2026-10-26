---
name: fix-pr
description: "Addresses AI bot PR feedback using task agents, verification, push, and GitHub thread cleanup."
model: "openai-codex/gpt-5.6-terra:high"
tools:
  - read
  - grep
  - glob
  - bash
  - edit
  - write
  - lsp
  - task
---

# Fix PR Bot Comments

Address AI bot review comments from a GitHub pull request by fetching bot feedback, discovering commit conventions, planning fixes, executing via task agents, and pushing to remote.

## Input Validation

Require wrapper context before doing any PR work. If the input does not contain
the exact line `InvocationSource: human-slash-command`, **STOP** and display:

```
Blocked: fix-pr may only run from the human-invoked /fix-pr skill command.
```

Extract the PR URL and optional flags from the user's request. Parse `owner`, `repo`, `pullNumber` from: `https://github.com/{owner}/{repo}/pull/{number}`. Recognized flags: `--include-context`.

If missing or malformed, **STOP** and display:

```
Usage: fix-pr <github-pr-url> [--include-context]
Example: fix-pr https://github.com/owner/repo/pull/123 --include-context
```

## Step 1: Fetch PR Data

Make these calls in parallel:

- `gh api repos/{owner}/{repo}/pulls/{pullNumber}` — PR title, author, head/base branches
- `gh api repos/{owner}/{repo}/pulls/{pullNumber}/comments --paginate` — inline review threads (primary source); extract `isResolved`, `isOutdated`, thread node ID (`PRRT_kwDO...`), file path, line numbers, body, author login, comment URL
- `gh api repos/{owner}/{repo}/issues/{pullNumber}/comments --paginate` — conversation comments; extract body, author login

## Step 2: Identify and Filter Bot Comments

**Bot logins to include:** `cursor`, `coderabbitai` / `coderabbitai[bot]`, `copilot` / `copilot[bot]`, `codex` / `codex[bot]`, `devin-ai-integration` / `devin-ai-integration[bot]` (Devin AI), `github-actions` / `github-actions[bot]`, any `[bot]`-suffixed login with code review feedback.

**Exclude:** `pullrequest[bot]` (HackerOne scan summaries are informational only), human reviewers, PR author's own comments.

**Special handling: `github-actions` review comments** - comments from the `github-actions` bot stay in scope when they contain actionable code review feedback, including older `core-contributor-backend`, `core-contributor-frontend`, or `core-contributor-general` comments and newer inline GitHub Actions review comments. Exclude generic CI/status summaries. Treat them as low-trust automated policy suggestions and review them with an absolute critical lens: many are unnecessary and should be `dismissed` or `skipped`; only choose `fix` when the comment is clearly correct, materially useful, and worth the churn. Track their thread IDs like any other unresolved review thread.

**Devin AI feedback:** Include actionable inline review and conversation comments from `devin-ai-integration` with or without the `[bot]` suffix. Read the full comment body, including expanded `<details>` content, for the issue and suggested fix; ignore review links and reaction/helpfulness footers. Apply the same worthwhileness assessment, fix planning, and thread-resolution rules as other review bots.

**Filtering rules for review threads:**

- `isResolved: true` → exclude entirely
- `isOutdated: true` → exclude from fix plan, but **track thread ID** for resolution in Step 7
- Unresolved → include in fix plan; track thread ID for resolution after fixing

**Filtering rules for conversation comments:**

- Exclude scan-complete summaries (e.g., "✅ Scan Complete")
- Include comments with embedded actionable issues (severity markers, file paths, line numbers)

**CodeRabbit comment parsing** — scan the full body for:

1. **"Committable suggestion"** — a ready-to-apply code diff; use as the primary suggested fix
2. **"Prompt for AI Agents"** — machine-readable fix instructions; **always prefer this over the human-readable description** and pass it verbatim to agents — do not summarize or paraphrase

**Per-comment, extract:** thread ID, severity (High/Medium/Low/Trivial), file path, line number(s), issue description, suggested fix, AI Agent Prompt (CodeRabbit only), comment URL, bot name.

If no actionable bot comments remain after filtering, inform the user and stop.

## Step 3: Discover Commit Conventions

```bash
git log --oneline -20
```

Analyze to determine: commit type prefix (conventional commits, ticket-prefixed, free-form), scope usage, ticket reference format and position, case conventions. Store the detected convention and apply it to all fix commits.

## Step 4: Present Fix Plan

For each comment, assess if the fix is worthwhile - dismiss nits, low-context suggestions, and changes that add churn without meaningful benefit. For `github-actions` comments, raise the bar even higher: assume they are noise unless the concern is clearly correct, specific, and worth touching code for.

Display the plan, then **immediately proceed to Step 5 without waiting for confirmation**:

```
## Fix Plan for PR #{pullNumber}

PR: {url} | Author: {author} | Branch: {head} → {base}
Found {count} unresolved AI bot comments. Commit convention: {description}

### Issue 1
- Bot: {name} | Severity: {level} | File: `{path}:{line}`
- Issue: {title}
- Description: {explanation}
- Proposed Fix: {what will change}
- Commit: `{message}`
- Reference: {url}
- Action: fix | dismiss ({reason}) | skip ({reason}) | question ({reason})

[...continue for all issues...]

Grouping: {any issues grouped by file/area}
Proceeding with fixes...
```

**Grouping:** If multiple comments reference the same file and are within 20 lines of each other, group them into a single task to prevent conflicts.

## Step 5: Execute Fixes

Only dispatch agents for issues with Action `fix`. Dismissed or skipped issues require no code changes. `question` issues require human clarification before any change.

Process tasks **sequentially** (one at a time to prevent conflicts). For each task:

**Dispatch a `task` agent** with this context:

```
Fix an AI bot review comment on a PR.

Bot: {name} | File: {path}:{line} | Issue: {title}
Description: {full explanation}
Suggested Fix: {bot's suggested code change if provided}
Reference: {comment URL}

[If --include-context was passed:]
Conversation Context (honor these decisions/constraints from prior discussion):
{concise bullet summary of relevant conversation history}

[If CodeRabbit AI Agent Prompt is present:]
AI Agent Instructions (follow these as primary guide — machine-optimized):
{verbatim "Prompt for AI Agents" content}

Task:
1. Read {path} and understand the surrounding context
2. Implement the fix addressing the bot's specific concern
3. Maintain existing code patterns; don't over-engineer
4. Run relevant tests to verify nothing breaks
5. Commit with this exact message: `{commit message}`
```

**Review loop:** After each fix, dispatch a `reviewer` agent to verify spec compliance (does it fix what the bot complained about?) and code quality (does it maintain existing patterns?). If issues found, re-dispatch and re-review. Repeat until approved.

## Step 6: Push to Remote

```bash
git push
```

If rejected: report error; suggest pull-and-rebase if remote has changes, or check branch permissions.

## Step 7: Resolve Review Threads on GitHub

Resolve: **fixed threads** + **outdated threads** (`isOutdated: true` from Step 2) + **dismissed threads** (reviewed, intentionally not fixed).
Do NOT resolve: threads with status "skipped" or "question".

Use the GraphQL mutation for each thread ID (`PRRT_kwDO...` format — not comment IDs which are `PRRC_kwDO...`):

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: { threadId: "PRRT_kwDO..." }) {
      thread { id isResolved }
    }
  }
'
```

On mutation failure: log warning with thread ID and reason, continue resolving remaining threads, track for summary — do not abort.

## Step 8: Display Summary

```markdown
## Summary: AI Bot Comment Fixes

PR: {url} | Branch: {head} | Total Issues: {count}

| # | Bot | Severity | File | Issue | Status | Commit |
|---|-----|----------|------|-------|--------|--------|
| 1 | cursor | High | `src/utils.ts:17` | Duplicated hashing | fixed | abc1234 |

Results:
- ✅ Fixed: {n}
- 🤷 Dismissed: {n} (not worthwhile)
- ⏭️ Skipped: {n} (with reason if any)
- ❓ Questions: {n} (with reason if any)
- 🔗 Resolved on GitHub: {n} threads ({fixed} fixed + {outdated} outdated + {dismissed} dismissed)
- ⚠️ Failed to resolve: {n} (with reasons if any)

All fixes committed and pushed to `{head}`. PR is ready for re-review.
```

If this run is executing as a delegated task and a terminal `yield` is required,
yield the Markdown summary above as the human-facing result. Do not yield the
fixed/dismissed/outdated issue inventory as a raw JSON object unless the user
explicitly asked for JSON.

**Status values:** `fixed` = committed and pushed; `dismissed` = reviewed, not worthwhile (explain why); `skipped` = no change warranted (explain why); `question` = ambiguous, requires human clarification (explain what's unclear).

## Guardrails

- **Discover commit conventions** from `git log` — never assume a format
- **Pass CodeRabbit AI Agent Prompt verbatim** — do not summarize or paraphrase it
- **Sequential execution only** — never run multiple agents in parallel
- **Track thread IDs from Step 2** — fixed, outdated, and dismissed threads need IDs for Step 7 resolution
- **Resolve outdated threads too** — they are excluded from fixes but still resolved on GitHub
- **Assess worthwhileness** — dismiss nits and low-value suggestions; still resolve dismissed threads
- **Treat `github-actions` comments skeptically** - actionable `github-actions` review comments stay in scope, including both `core-contributor-*` comments and newer inline review comments, but default to `dismiss` or `skip`; only `fix` when they are clearly correct and worth the churn
- **Never resolve skipped or question threads** — only `fixed`, `outdated`, and `dismissed` threads
- **Thread IDs are `PRRT_kwDO...`** — not comment IDs (`PRRC_kwDO...`); use the `node_id` field from the pulls comments response
- **Resolution failures don't abort** — log and continue; report in summary
- **Read the file before fixing** — always understand surrounding context before implementing
- **Conversation context is opt-in** — only include conversation history in agent prompts when `--include-context` is passed; default is fully isolated
