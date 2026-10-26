---
name: slack-qa
description: Inspect one GitHub pull request, create a grounded Slack QA plan, and execute it against the local Zoe runtime using real direct messages.
---

The user invoked `/slack-qa` with these arguments:

`$ARGUMENTS`

This skill is local-runtime-only. It consumes the local Zoe setup that the user already has running in local Ghostty terminals. It does not create a worktree, switch branches, start, stop, or restart services, provision infrastructure, modify Slack app configuration, or delete Slack messages. It does not use an isolated runtime receipt.

Never run service lifecycle commands from this skill. Forbidden commands include, but are not limited to, `scripts/dev-start.sh`, `scripts/worktree-start.sh`, `scripts/worktree-stop.sh`, `docker compose up`, `docker compose down`, `docker restart`, `kill`, `pkill`, `ngrok http`, and any command whose purpose is to start, stop, restart, or repair backend, worker, gateway, database, Redis, Restate, ClickHouse, kubectl proxy, or ngrok processes.

The required runtime must already be running before this skill starts. The backend, worker, gateway, ngrok tunnel, database, Redis, Restate, ClickHouse, and any kubectl proxy are owned by the user's local Ghostty terminals. This skill may inspect health, ports, process ownership, branch, env files, and credentials with read-only commands only. If any required service is missing, unhealthy, from the wrong checkout, or misconfigured, stop with `BLOCKED` and report the exact prerequisite that the user must fix in their local terminals.

## Input and preparation

Accept exactly one argument: a valid GitHub pull request URL in the form `https://github.com/OWNER/REPOSITORY/pull/NUMBER`. Reject missing, repeated, unsupported, malformed, or extra arguments before contacting GitHub or Slack.

Treat the complete value of `$ARGUMENTS` as `PR_URL` after trimming surrounding whitespace. Do not split it into options or reinterpret its contents as shell input.

The local checkout is the primary `writer-monorepo` checkout at `/Users/michael/development/writer/writer-monorepo` unless `SLACK_QA_LOCAL_CHECKOUT` is set. It must be on the `-local` branch created by `/test-wt-locally`, and that branch must correspond to the pull request head branch. The feature must be fully materialized there and the user's Ghostty-owned local runtime must already be serving that checkout before this skill runs.

The workflow helper performs read-only runtime checks, verifies the local branch matches the PR, reads the PR title and description, and saves the complete file diff. It does not start or repair services:

```bash
node /Users/michael/.omp/agent/skills/slack-qa/scripts/workflow.cjs invoke \
  --arguments "$PR_URL" \
  --checkout "${SLACK_QA_LOCAL_CHECKOUT:-/Users/michael/development/writer/writer-monorepo}"
```

The helper returns a private run directory containing:

- `pull-request.json` with the PR title, description, branch metadata, and file list;
- `pull-request.diff` with the complete GitHub patch;
- `test-plan.md`, which this skill must create before sending any Slack message.

Read the entire metadata file and entire diff. Also inspect the relevant implementation and tests in the local checkout. Do not rely on the PR description alone.

## Create the QA plan

Before executing anything through Slack, write `test-plan.md` in the returned run directory. The plan must be understandable and executable by another AI QA engineer without this conversation. It must include:

- `Goal`: the behavior being proven and the acceptance criteria derived from the PR;
- `Agent Rules`: read-only source/test behavior, no edits, commits, pushes, Slack configuration changes, or message deletion, plus credential redaction rules;
- `Architecture Under Test`: the Slack ingress, gateway, backend, worker, persistence, and response path relevant to the diff, with a small flow diagram when useful;
- `Key Files`: changed files and nearby implementation/tests with absolute local paths and line references where practical;
- `Preflight And Setup`: exact branch, feature-flag, dependency, service-health, port, env, ngrok, Zoe, sender-token, and database/state checks;
- `Automated Baseline`: focused lint, typecheck, and tests selected from the changed packages, with exact commands and expected results;
- `Scenario Plan`: ordered cases covering the changed happy path, negative/error paths, compatibility behavior, feature flags, persistence, logs, and external side effects when relevant;
- `Execution Order`: cheap deterministic checks before local service probes, then the real Slack DM cases, then persistence/log checks;
- `Failure Diagnosis Branches`: concrete evidence to distinguish wrong branch, disabled flag, unhealthy service, stale DM, missing schema, external Slack failure, and product-code failure;
- `Cleanup And Rollback`: explain why no cleanup is needed, and explicitly state that Slack messages are never deleted and no channel is used;
- `Acceptance Criteria` and `Limitations`: concrete sign-off conditions and known blockers;
- for every executable Slack case, a stable `retestKey`, `surface`, `affectedFiles`, exact `Prompt`, and one explicit assertion block using `expectText`, `expectContains`, `expectRegex`, or `expectFiles`;
- expected failure behavior and the evidence that distinguishes a real failure from a timeout or unrelated Slack history.

If the PR does not change or support a Slack behavior that can be exercised through a direct message to Zoe, write the reason in the plan and stop with `UNSUPPORTED_PLAN` without contacting Slack. Do not invent a Slack scenario to make an unrelated PR testable.

The plan must be grounded in the PR diff and local code. Do not include speculative prompts, unsupported channels, browser actions, OAuth interactions, synthetic webhooks, or assertions that cannot be observed in the Zoe DM.

After writing the plan, read it in full and verify that every case has an unambiguous prompt and observable assertion. Stop with `UNSUPPORTED_PLAN` if any case is ambiguous.

Run the plan's automated baseline before the real Slack cases. Use focused commands from the affected package and report their exact result. Do not edit source files or weaken tests to make the baseline pass. A failing baseline must be reported and must prevent an overall pass claim, even if a Slack case happens to respond.

## Execute the QA plan

Execute the cases sequentially and fail fast after the first failed case. Preserve each prompt exactly as written in the plan. For each case, build an internal JSON request containing `prompt` and the assertion fields named by the plan, then pipe it to:

```bash
node /Users/michael/.omp/agent/skills/slack-qa/scripts/workflow.cjs run-case \
  --checkout "${SLACK_QA_LOCAL_CHECKOUT:-/Users/michael/development/writer/writer-monorepo}"
```

The helper revalidates the local runtime, reads `SLACK_QA_USER_TOKEN` from the active checkout's protected `gateway/.env`, opens a one-to-one Slack conversation with Zoe, and polls only messages newer than the sent message from Zoe's authenticated Slack user ID. It never posts to a channel.

`SLACK_BOT_TOKEN` and `SLACK_QA_USER_TOKEN` must both be present in the same protected `gateway/.env`. The bot token authenticates the local Zoe gateway only; the QA user token authenticates the human Slack identity that sends test DMs. Validate them independently with `auth.test`, require different Slack identities, and never print or report either token.

Supported assertions are:

- `expectText`: exact reply text;
- `expectContains`: all listed text fragments must occur;
- `expectRegex`: a regular expression must match;
- `expectFiles`: every listed file name must be present in Zoe's reply.

Do not claim success merely because Slack accepted the prompt. A case passes only after the expected Zoe reply or file evidence is observed.

## Safety and reporting

- Send only prompts explicitly written in the generated plan.
- Do not invent prompts, expected responses, recipient identities, channels, OAuth actions, or cleanup operations.
- Do not execute channel tests, Slack UI tests, synthetic webhook tests, or unsupported external actions.
- Use message timestamps and unique run IDs so stale DM history cannot satisfy a new case.
- Keep reports in Markdown. Include the PR URL, generated plan path, each case result, Slack permalink when available, and concise redacted failure context.
- Report a compact scenario table with `retestKey`, surface, evidence, and `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` for every planned scenario.
- Fail closed if the local checkout, branch, processes, gateway, ngrok tunnel, Zoe credentials, `gateway/.env`, either Slack token, or plan is missing, unhealthy, ambiguous, improperly protected, or mismatched.

Only one local Zoe runtime may own the fixed ngrok domain at a time. This skill does not tear down the local stack after testing.
