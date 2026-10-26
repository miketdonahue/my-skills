---
name: prep-worktree
description: Prepare and verify an existing writer-monorepo checkout for real testing, retain its managed runtime, and report scoped evidence without creating a worktree.
---

The invocation arguments are the resolved text below, not a shell environment variable:

`$ARGUMENTS`

## Boundary

Operate in the supplied existing writer-monorepo checkout. Never invoke `/worktree`, its scripts, Herdr creation, `git worktree add`, or any checkout creation/deletion wrapper. Do not modify the installed `/worktree` skill. Do not commit, push, install machine tools, switch Docker contexts, perform interactive authentication, stop foreign processes, or repair shared storage.

Read checkout rules and `docs/testing/worktree-real-service-testing.md` before acting. Repository entrypoints own allocation, env projection, installation, isolation, identity, receipts, process ownership and shutdown. Do not recreate these mechanics in skill code or a separate daemon.

## Resolve

With no arguments use `--services backend,frontend --platform simulator`. Pass explicit repository start options through the parser, preserving the requested scope, including `--exclude` and `--gateway-image` when supplied. Doctor and start must receive the same image selection as well as the same services/platform; an image-mode session is not interchangeable with a source-mode session. Frontend and worker include backend through repository dependency closure; gateway-only must not acquire frontend or an app browser baseline. Do not infer vendor/OAuth authorization from any flag. Reject unsupported invocation text through the repository parser, never silently ignore it. Quote each resolved argument as its own shell argument; do not expand a presumed `$ARGUMENTS` variable or interpolate raw text into shell syntax.

## Doctor and preparation

Run from the checkout root:

```bash
python3 scripts/worktree_session.py doctor --format json --testing --services backend,frontend --platform simulator
```

Substitute the explicit selection/platform when supplied. Consume the report even when this command exits nonzero. Validate schema_version=1, selection closure, status in `ready|needs_preparation|blocked`, and findings with stable categories and boolean `fixable`. `DoctorReport.from_json` in `scripts/worktree_runtime.py` is the authoritative schema reader if programmatic validation is needed. Never decide from prose or exit code alone.

- `blocked`: report the exact category and remedy. Do not launch, take over, change a shared destination, or conceal an ownership/source conflict. Mixed fixable and blocking findings remain blocked.
- `needs_preparation`: run the repository `prepare --testing` command with the same selection/platform. Missing checkout-local config/env/dependencies are expected preparation, not a reason to stop. Inspect private preparation logs only if an install fails; never echo credentials into the handoff. Repair repository bugs when authorized by the calling task, then repeat doctor.
- `ready`: reuse valid preparation. Do not rerun package installers manually.

## Start or reuse

Read `.worktree/runtime.json` if present. A ready live strict session must match this checkout, requested/resolved services, platform, source/image selection, source, process ownership and HTTP identities. Doctor and verifier enforce those contracts. For a compatible session, reuse its existing managed process and proceed to verification. Do not start a duplicate launcher. For stale/incompatible/foreign ownership, report the conflict and exact owner-scoped shutdown/restart procedure; do not stop it automatically.

If no active matching session exists, use the available **managed long-lived process facility**, with a unique checkout-scoped service name, to run:

```bash
python3 scripts/worktree_session.py --testing --services backend,frontend --platform simulator
```

Substitute explicit scope as above. Wait for the actual selected-service readiness log, not just process creation. Keep the existing pipe lease, guardian and 24-hour lifetime. Record the tool's returned process handle/name. When the tool supports `proc://<handle>/mode`, set it to `persist` before returning so a subsequent agent session can reuse it. A transient `omp -p` agent must not leave an unmanaged orphan or close the launcher lease. Do not use raw `&`, `nohup`, `disown`, another supervisor, or a second config/ports registry. If the available tool cannot retain the managed session, report that concrete limitation instead of claiming retained readiness.

## Verify

With backend/frontend selected:

```bash
python3 scripts/worktree_session.py verify --scenario saved-project
```

This must run the actual two-phase Chromium journey: real UI create/edit/reload, proxied and direct backend read-back, owned backend restart, same fixture ID read-back in a fresh browser context, and exact-ID cleanup. Do not substitute health checks, API-only persistence, route mocks, a replacement project, remote auth pools, or the broad mocked E2E fixture. Failure, stale source, missing baseline or cleanup failure is unsuccessful. Inspect its private attempt evidence, repair authorized repository defects, explicitly restart affected owned services after source changes, and rerun the full journey. Never retry a weaker assertion to manufacture a pass.

For a narrower selection:

```bash
python3 scripts/worktree_session.py verify --scenario readiness
```

Attest only applicable real selected service readiness/provenance. Explicitly report browser persistence unverified. Source-mode gateway proof is not image proof. Simulated platform identity/CG responses never attest real CG execution, OAuth, transfers, vendors or deployed routing.

Repeat invocation must reuse valid installs and a compatible healthy session while obtaining fresh evidence. Do not reuse a historical receipt as current proof.

## Return Markdown

Report:
- Checkout/branch and actual manifest-pinned URLs.
- Requested, resolved and infrastructure services; real versus simulated authorities.
- Readiness and capabilities actually exercised, with failed/unverified boundaries explicit.
- Receipt paths, exact fixture cleanup result and evidence timestamp/session.
- Retained managed process handle/name and 24-hour expiration boundary.
- Exact commands for fresh verification, selected-service restart and shutdown:

```bash
python3 scripts/worktree_session.py verify --scenario saved-project
./scripts/worktree-service.sh restart backend
python3 scripts/worktree_session.py stop
```

Use `--scenario readiness` and only a selected service for scoped runs. Stop through the session owner or its retained managed-process handle, never arbitrary PIDs/containers. State “baseline passed” only when saved-project passed. State “ready for testing” only when selected real services and current provenance passed. Never claim complete delivery from skill installation, discovery, direct CLI smoke, or health alone.
