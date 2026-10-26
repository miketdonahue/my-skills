---
name: slack-debug
description: Provides the configured Zoe Slack destination and safe local Chrome and log procedures for user-directed debugging.
---

Follow the user's prompt as the task, as you would any other prompt. This skill supplies the configured Slack destination and local interaction constraints. It does not decide what to ask Zoe, require a message, or prescribe the number or sequence of conversational turns.

Do not treat the text after `/slack-debug` as message content by default, and do not forward the whole prompt verbatim merely because the skill was invoked. Use the user's prompt to determine whether Slack interaction is needed, what to send, whether to wait or follow up, and when the task is complete. Follow any message text, turn sequence, retry limit, or stopping condition the user specifies. If the task calls for a Slack interaction but a material detail is unclear, ask the user rather than inventing it. Never send a message solely because this skill was invoked.

## Boundaries

Never invoke or delegate to `/diagnose`, `diagnose`, `/log-explorer`, `log-explorer`, `/slack-qa`, or `slack-qa`. Never query Loki, Grafana, GCP, hosted logs, or any other remote log service. Never call Slack Web APIs, use Slack API helpers, read Slack OAuth tokens, or inspect `gateway/.env` for Slack credentials. For Slack interaction, use only the user's real Chrome Slack UI through the OMP relay. For local runtime log evidence, use only the three prescribed local logs.

Never start, stop, restart, repair, reconfigure, or otherwise alter backend, worker, gateway, ngrok, databases, queues, or Chrome. The user's terminals and browser own those processes. Do not invoke `/test-wt-locally`, commit, switch branches, or restart the user's services. If a requested action depends on a missing runtime, relay, login, or log, report the exact missing prerequisite.

Preserve unrelated user changes. Do not remove or modify any Slack message.

## Repository and mutation policy

Apply this section only when the user's task includes source changes. Before editing, resolve the current repository and Git topology using read-only Git commands. A linked worktree is a checkout where the absolute Git directory differs from the absolute common Git directory and it is not a submodule. Diagnosis and source inspection are allowed from any checkout. Edits are allowed only from a linked worktree.

If the current checkout is a primary checkout, continue any requested read-only diagnosis and stop before edits. Explain that the user must invoke `/worktree` or rerun `/slack-debug` from an existing linked worktree to allow source changes.

Before attributing an observed Zoe result to source code, inspect the listener/process working directories for local backend and gateway, and for worker when available. Use read-only process/port inspection. Compare those directories and revisions with the editable linked worktree. If the runtime checkout differs from the editable worktree, diagnosis and a source fix may proceed when requested, but do not claim end-to-end verification until the user's existing runtime serves the fixed revision.

## Local-log authority

When the task needs local runtime log evidence, the sole diagnostic log root is:

```text
${TMPDIR:-/tmp}/writer-local-logs-${UID}
```

Use only these files:

```text
backend.current.log
worker.current.log
gateway.current.log
```

Resolve the root exactly. Require every path to be a readable regular file before a log-correlated Slack probe. Do not substitute `scripts/dev-start.sh` current logs, container logs, process output, or hosted logs. If requested diagnosis depends on logs and any are missing or unreadable, report `BLOCKED` and name every missing path.

Before each Zoe message whose effects will be correlated with local logs, snapshot each required file's inode, byte size, line count, and modification time. Record the snapshot internally. After the exact browser thread reaches the expected response or times out, inspect only lines appended after that snapshot. If a file was replaced, truncated, or rotated, read its replacement from line 1 and label the evidence as replacement, truncation, or rotation. Do not treat earlier lines as evidence from that interaction.

Correlate log deltas using the sent message and any action ID, request ID, thread ID, run ID, or agent-run ID exposed by the new segment. Read only neighboring lines needed to establish the request path and root cause. Redact tokens, cookies, authorization headers, credentials, and unrelated user content in every report.

## Real-Chrome Zoe DM probe

Use this procedure only when the user's task calls for Slack UI interaction. The browser contract requires a relay attachment. Open with `app: { relay: true }`, and require the open result to identify the relay backend. Never use managed Chrome, Chrome-for-Testing, a direct CDP connection, or a fallback browser. If the relay extension is disconnected, report that prerequisite as `BLOCKED`.

The only authorized destination is Writer workspace `E07UFCSGMTM`, Zoe DM `D0AH8AHU935`:

```text
https://app.slack.com/client/E07UFCSGMTM/D0AH8AHU935
```

Treat `D0AH8AHU935` as the only valid recipient. Do not discover, substitute, or contact another user, app, channel, workspace, or Zoe-like conversation. The user's prompt determines whether to send a message and the content and sequence of messages. Never substitute the full slash-command prompt as message content unless the user explicitly asks for that.

1. Attach through the relay to an existing tab targeted by `D0AH8AHU935`.
2. If no such tab exists, attach through the relay to the currently visible page without navigation or modification. Through that attached tab's `tab.run(... browser.newPage() ...)`, create a new browser page, navigate only the new page to the fixed URL, then reattach through the relay by the exact conversation target. This preserves the user's existing tabs.
3. Before sending, validate that the final URL contains `D0AH8AHU935` and the title identifies `Zoe (DM)`. Otherwise stop and report `BLOCKED`.
4. Locate the composer by accessible role `textbox` with exact accessible name `Message to Zoe`. Send the message or sequence called for by the user's prompt.
5. When the prompt calls for a response, wait up to 180 seconds for the exact message to receive replies, unless the user specifies a shorter limit. Open the reply control associated with that message, never an older same-named `N replies` control.
6. In the thread pane, verify whether the responder is the `Zoe` app. Capture rendered response text, cards, links, files, error state, and a screenshot when relevant to the requested outcome. A reply count, Slack API result, or matching text outside that exact thread is not evidence of a response.
7. For each requested follow-up, use the exact message or instructions from the prompt, inspect its own thread, and take a fresh log snapshot first when correlating local logs. Respect the user's turn and retry limits. Never retry without a bound.

## Diagnose, fix, and prove

Let the user's prompt define whether the task is to inspect, diagnose, fix, or verify behavior. Do not force a Zoe probe, source edit, follow-up, or verification step the prompt does not call for. When diagnosing, distinguish observed browser behavior and appended local-log evidence from hypotheses, then inspect relevant source as needed. Do not suppress an error or special-case a message used to reproduce it.

When the user asks for a source fix and the root cause is established, make the smallest maintainable fix in the linked worktree. Update every affected caller or contract. Add or strengthen only a behavior-level regression test that would have failed for the observed bug.

Follow the user's requested verification plan. Do not automatically resend a message just because code changed. If the task requires end-to-end Slack verification, take fresh log snapshots for each diagnostic message and use the user's requested prompt/sequence in the exact Zoe DM. Claim a pass only when the requested behavior is observed and the relevant new log evidence supports it.

If the running services do not serve the fix or do not hot-reload it, do not claim end-to-end verification. Identify the exact runtime checkout or revision mismatch and tell the user to materialize or restart the runtime in their existing terminal before resuming. A unit suite alone never proves Slack behavior.

## Report

Answer in the format and scope requested by the user. When relevant, report the exact messages sent, the rendered response and whether the Zoe app replied, redacted log deltas (including services with no matching new lines), the cause or remaining uncertainty, changes and checks performed, and unverified behavior. State `No hosted logs were queried.` Never claim a check, browser result, log event, or runtime revision that was not observed.
