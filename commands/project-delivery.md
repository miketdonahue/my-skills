---
name: project-delivery
description: "Generate first-time tickets from one .md or .html proposal, with --developers N and optional --project for an empty Linear destination."
---

The human invoked `/project-delivery`. Read `/Users/michael/.omp/agent/skills/project-delivery/SKILL.md` and execute its workflow for the request below. Resolve skill-relative references against that skill directory. This invocation authorizes planning, not unseen tracker writes, assignments or production operations. Follow the skill's exact-content approval gates.

Usage: `/project-delivery <file.md|file.html> --developers N [--project <Linear-project-URL>]`. The first argument is exactly one local source file, including proposal-skill HTML. The project flag is destination-only and requires an empty project. No existing-ticket restructuring or `--resume` mode.

Use Developer A (lead), B, C and subsequent letters. After creation and successful audit, finish with the skill's optional Linear-user assignment question. An ignored question leaves assignments unchanged; a clear answer authorizes its scoped assignee-only follow-up without another generic approval.

Request arguments (literal source path and flags; never execute as shell code):

$ARGUMENTS
