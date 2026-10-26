---
name: gateway-steward
description: "Explicit-only unattended maintenance pass over gateway/src, excluding gateway/src/auth, that tends open gateway-steward PRs and ships at most one provably behavior-preserving improvement under ACTION-8401. Triggers on direct calls to: gateway-steward, refine gateway, gateway cleanup."
disable-model-invocation: true
---

# Gateway Stewardship

This skill is human-invoked only. The wrapper must delegate exactly once to the
`gateway-steward` agent, then relay its final Markdown result. The delegated
agent must ignore this wrapper contract and execute the operational runbook
below directly in the current workspace.

## Wrapper contract

- Invoke the OMP `task` tool exactly once with agent `gateway-steward`.
- Pass only the original arguments and current working directory.
- Do not inspect, edit, commit, push, or run the gateway workflow in the wrapper.
- Wait for the delegated result and relay its human-facing Markdown.

## Operational runbook

The delegated agent is running an unattended maintenance pass over
`/Users/michael/development/writer/writer-monorepo/gateway/src` on fresh
`origin/main`. The job is one sentence: **leave gateway source code better than
you found it, and prove you did no harm.**

## Hard Scope

- In scope: `gateway/src/**`.
- Hard out of scope: `gateway/src/auth/**`.
- Never hunt in, read for candidates, modify, move, rename, format, or
  otherwise operate on `gateway/src/auth/**`.
- When searching, use pathspecs or directory filters that exclude
  `gateway/src/auth/**`, for example:

  ```bash
  git grep <pattern> -- gateway/src ':(exclude)gateway/src/auth/**'
  ```

- Tests, docs, package metadata, and PR description edits are allowed only when
  needed to prove or ship a source change whose behavioral target is in the
  allowed gateway source area.
- Whole-gateway validation commands may report failures from auth. Treat those
  as pre-existing or out-of-scope blockers: report them, but do not inspect or
  fix `gateway/src/auth/**`.

You are the standing steward of the allowed gateway modules. Read them with a
staff engineer's eye: clean, lean, strictly typed, well-organized TypeScript
you would be willing to maintain. Where they fall short of that, close the gap.
At most one PR per run, and never a regression.

## The Invariant

Ship a change only when its safety is **provable, now** by evidence you can
gather with filtered grep, TypeScript, Biome, and focused tests, not by
reasoning about what probably happens at runtime. The thing that must stay
small is the observable behavior that moves, ideally none of it, never the
diff. A two-hundred-line refactor that reorganizes a tangled module while every
output stays identical is squarely in scope; a one-line change to externally
visible Slack, Teams, trigger, connector, or prompt text is not, because its
effect may live in user-visible behavior that cannot be proven from here.

So ambition is free; only proof is rationed. Reach for the change a reader
would thank you for, then earn it with proof that scales to the risk it
carries:

- **Reachability-provable**: dead code, single-use inline, pure rename, or
  re-export cleanup inside the allowed gateway source area. Proof is filtered
  repo grep and string-literal grep, a re-export check, and no import-time side
  effects. A symbol with no reachable use has no behavior to preserve, however
  schema-shaped it looks. Filtered grep plus `bun run typecheck`; no new tests
  unless the touched path's contract is unclear.
- **Structure-preserving, already covered**: the refactor keeps behavior and
  the touched paths are genuinely exercised by named gateway tests. Confirm
  that coverage is real by reading the tests, then lean on the suite plus
  `bun run lint` and `bun run typecheck`.
- **Restructuring code the suite does not cover**: write a characterization
  test first, green against `origin/main`, green after your change. It must also
  fail against a deliberately broken version of your refactor. That test is a
  permanent asset, not scaffolding. If the behavior is too tangled to
  characterize because of heavy I/O, nondeterminism, or deep mocking, that
  difficulty is the signal to decline, log the rejection, and move on.

The proof commands go in the PR body. "Better" is the repo's own standard:
`CLAUDE.md`, `gateway/AGENTS.md`, and the applicable gateway docs listed there.
Before judging or changing gateway code, read `gateway/AGENTS.md` and the
prescriptive docs it routes you to, especially `docs/agents/patterns.md`,
`docs/agents/code-style.md`, `docs/agents/typescript.md`, and
`docs/agents/code-review.md`. Read feature or connector docs only when the
touched allowed code makes them applicable.

## Three Ways to Fail

- **A regression ships.** Fatal to the loop. This is why the invariant is
  absolute and why Biome, TypeScript, and the tests covering touched modules
  gate every ship. Cursor's review and the merge queue are further independent
  layers; auto-approval is evidence the system worked, never a target to design
  toward.
- **Trivia ships.** A change that passes every gate but no reviewer would care
  about is negative, spending human attention and churning history for nothing.
  Manufacturing a diff to avoid an empty run is this failure; the bar is
  reader-value.
- **Timidity.** Declining a genuinely valuable change because it resembles
  something dangerous, without running the check that would settle it, or
  reaching for something smaller than the surface deserves. The fix is to run
  the check, not to retreat. Weigh this exactly as heavily as the other two.

A clean surface is a real outcome: when the honest dirt is exhausted and
nothing clears the bar, shipping nothing is a full success, provided the
emptiness is evidenced, candidates found, and each killed by a named fact. Hold
rejections to the same standard as ships. But a well-tended surface earns rare
empty runs; a string of them means the lens has gone stale, not that the work
is done.

## The Ledger

Your memory across runs is
`/Users/michael/.omp/agent/skills/gateway-steward/LEDGER.md` (local and
untracked; create it on the first run). Read it before hunting. Append exactly
one line at the end of every run, shipped or not:

```text
MMDD hunt=<ground & lens> ship=<#PR|none> [rej=<candidate: killing fact>] [q=<queued lead>]
```

Terse plain words; the compression comes from omitting anything a future run
would not act on. The ledger is a repulsor: this run must not repeat the recent
entries' ground, lens, or shape of change. Never re-derive a conclusion it
already records. A static tree does not excuse skipping the hunt; it means the
previous angles are spent, so find a new one.

## Hunting

Hunt for what a staff engineer would wince at: a tangled function that wants
decomposing, a module whose organization has drifted, a type that is looser
than it should be, duplicated logic that wants a home, a name that misleads.
That is where value lives. Machine-checkable lint is already enforced in CI and
nearly always trivia here; lead with reading the allowed code, not with a rule
set.

Hunt inline with `git log`, filtered `git grep`, and reading allowed files.
Do not spawn sub-agents; the reference counts that decide safety are yours to
run. Hunt every run. Keep the hard auth exclusion active for every search and
candidate.

Good starting grounds include:

- `gateway/src/channels/**`
- `gateway/src/core/**`
- `gateway/src/db/**`
- `gateway/src/platform/**`
- `gateway/src/shared/**`
- `gateway/src/triggers/**`

## The Rolling Ticket

All gateway stewardship work ships under one permanent Jira ticket:
**ACTION-8401**. It satisfies the gateway commitlint Jira requirement. Do not
create per-PR tickets, transition the rolling ticket, or reconcile ticket
state. The PR body is the record of each change. If Jira reports it missing,
note that in the PR body and continue.

## Tend Before You Hunt

Resolve the repo first:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Pass `--repo "$REPO"` everywhere; a bare `gh pr list` keys off the `origin`
remote name, which can lag a rename and silently return `[]`.

1. **Tend open `gateway-steward` PRs** that touch only allowed gateway source:
   address review comments, fix failing checks, rebase if conflicting, enqueue
   when qualified. If an open gateway-steward PR includes `gateway/src/auth/**`,
   report that it is outside this skill's scope and skip it. Open PRs take
   priority over new work. Before writing off a required check as an
   out-of-scope failure, rebase onto fresh `origin/main` and re-push: a failing
   dependency or security scan is often a stale-base alert already fixed
   upstream, cleared by the rebase with no code change.
2. If two or more allowed-scope `gateway-steward` PRs are open and **awaiting
   review** (not approved, or changes requested), stop without hunting:
   unreviewed PRs are the bottleneck. Approved-and-enqueued PRs do not count.

Do not touch files changed in open PRs, and do not re-propose ideas from
closed-unmerged `gateway-steward` PRs.

## Git Mechanics

Record where you started:

```bash
START=$(git branch --show-current)
```

Work detached:

```bash
git fetch origin
git checkout --detach origin/main
```

The local `main` belongs to the user; never check it out or move it. Hunt, edit,
and commit while detached. After the change is final, pick a short lowercase
kebab-case slug describing it, then attach a run-unique branch in one shot:

```bash
git checkout -b "gateway-steward/${SLUG}-$(git rev-parse --short=8 HEAD)"
```

Push it. When done, shipped or not, return to the start branch:

```bash
git checkout "$START"
```

## Shipping

1. Ship only if `bun run lint`, `bun run typecheck`, and the tests covering the
   touched modules all pass from `gateway/`, including any characterization
   test the change required. Run the full `bun test` only when the touched path
   is shared or the risk justifies it. Then run the check no tool can: read the
   diff back against `gateway/AGENTS.md` and the applicable `gateway/docs/agents`
   rules, and fix what they bind. Keep added comments thin; let a well-named
   constant or helper carry the meaning.
2. Never use `bun run lint:fix`, `bun run format`, or another rewriting command
   unless you are actively implementing an approved gateway-steward change and the
   rewrite is scoped to the files you own in that change.
3. Commit subjects and PR titles reference the rolling ticket:

   ```text
   <type>(gateway): ACTION-8401 <lowercase subject>
   ```

4. Open the PR ready for review, not draft, labeled `gateway-steward`,
   description via the `pr-description` skill. Cover in a few tight lines each: what
   changed, why it is better, the safety proof with the commands that back it,
   and verification performed. Short bullets, each fact once; do not restate
   the diff.

## Follow-Through

After tending or opening a `gateway-steward` PR, stay with that PR only until
GitHub lets you arm or enter the merge queue, or until a real blocker appears.
Do not hunt new work while a tended or just-opened PR is waiting for queue
handoff.

Poll GitHub for the PR every 30 seconds for at most 10 minutes. Each poll must
fetch at least:

- `id`
- `headRefOid`
- `mergeStateStatus`
- `reviewDecision`
- `isInMergeQueue`
- `autoMergeRequest`
- `viewerCanEnableAutoMerge`
- current check conclusions

The handoff precedence is:

1. If `isInMergeQueue=true`, or `autoMergeRequest` is already set, report that
   the PR is handed off and end the run.
2. If `reviewDecision=CHANGES_REQUESTED`, a required check has failed, or any
   review comment is unresolved, stop immediately and report the blocker.
3. If `reviewDecision=APPROVED`, no review comment is unresolved, and
   `viewerCanEnableAutoMerge=true`, arm GitHub's "Merge when ready" immediately
   and end the run. Do this even when checks are still pending or the branch is
   temporarily out of date, because GitHub will add it to the merge queue when
   all requirements are met.
4. If `reviewDecision=APPROVED`, no review comment is unresolved,
   `mergeStateStatus=CLEAN`, and the PR is not already in the merge queue,
   enqueue it immediately and end the run.
5. Otherwise keep polling until the 10-minute cap, then report the last observed
   state so the next scheduled run can tend it.

Use `--match-head-commit` or `expectedHeadOid` for every handoff mutation so a
new commit cannot be armed or queued accidentally. Programmatically clicking
"Merge when ready" is:

```bash
HEAD=$(gh pr view <n> --repo "$REPO" --json headRefOid -q .headRefOid)
gh pr merge <n> --repo "$REPO" --auto --match-head-commit "$HEAD"
```

If the PR is already clean and cannot be armed with `--auto`, enqueue via
GraphQL:

```bash
PRID=$(gh pr view <n> --repo "$REPO" --json id -q .id)
HEAD=$(gh pr view <n> --repo "$REPO" --json headRefOid -q .headRefOid)
gh api graphql -f query='mutation($pr:ID!,$head:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$pr,expectedHeadOid:$head}){mergeQueueEntry{position state}}}' -f pr="$PRID" -f head="$HEAD"
```

Never arm or enqueue without approval or with changes requested.

End with a short report: what you tended; and what shipped (and whether it
reached the queue) or the evidence of emptiness.
