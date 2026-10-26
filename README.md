# OMP skills

Snapshot of the 28 active skills installed under `~/.omp/agent/skills`, with their supporting files. Skill sources are preserved without portability rewrites.

## Contents

- `skills/`: skill instructions, scripts, references, assets, bundled agent metadata, and existing tests.
- `agents/`: custom agent definitions used by skill workflows, including their supporting agent roles.
- `lib/`: shared HTML rendering and worktree helpers, plus their existing tests.
- `commands/`: installed slash-command wrappers.

Backup copies, Python caches, dependency installations, credentials, local configuration, session databases, and the gateway-steward runtime ledger are excluded.

## Installation and prerequisites

The repository root mirrors the contents of `~/.omp/agent`, not the entire `~/.omp` directory. Review the files before merging the four directories into an existing installation. Restart OMP after installing skills, commands, or agents so discovery refreshes.

These workflows target the original OMP environment. Many instructions retain absolute `/Users/michael/...` paths, Writer repository assumptions, and dependencies on installed tools or connected services. Copying this repository alone does not provision those services, credentials, repositories, or the OMP runtime. Review each skill's prerequisites before invoking it. Keep the directory layout intact so relative helper and role-pack references resolve.

Script prerequisites include Node.js and Python 3. Individual workflows also require tools such as Git, GitHub CLI, Herdr, or rendering dependencies documented by the relevant skill. Credentials must be configured separately and must not be committed here.

Hiring role packs are not included in this repository. Skills that require a role pack need one supplied separately in the installation's `roles/` directory.

## Export verification

The exported files were checked with Node.js 22 and Python 3.12:

- All 46 JavaScript files passed `node --check`; all six Python files parsed successfully.
- `ruff check --no-cache` passed for all Python files. No standalone typecheck configuration is bundled.
- Existing Node tests: 160 passed and two failed out of 162. Both failures are in `skills/close-worktree/test/workflow.test.cjs`: `deletes clean merged and no-PR worktrees` and `rejects --force instead of bypassing active-target confirmation`. They are retained unchanged as part of the source snapshot, not repaired by this export.
- Existing log-explorer Python tests: nine passed.
- Before role packs were removed from this repository, the candidate role pack validated and the offline candidate-export smoke completed successfully.
- The exported log helper generated a scoped Loki query through `--print-query` without contacting Grafana.

External service workflows were not exercised against live systems.
