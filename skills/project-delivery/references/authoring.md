# Authoring guidance and provenance

## Primary Anthropic sources

Web search identified Anthropic's [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), read in full from its [Markdown source](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md). Its linked [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) is conceptual background, not an additional claimed verification.

Applied guidance:

- Valid lowercase hyphenated name and concise third-person description with explicit triggers.
- Short SKILL.md entry point, direct one-level references and conditional publication details.
- Concrete evaluation scenarios, grounded in observed failures and the current first-generation/optional-assignment contract.
- Flexible architecture decisions but strict validation, publication and authorization gates.
- Deterministic scripts for graph checks and one-source rendering; explicit errors and dependency prerequisites rather than runtime installation or silent fallback.
- Plan/validate/execute with persisted intermediate evidence and review/repair loops.
- Explicit OMP mounted-tool device paths instead of assuming Claude Code tool names.
- Actual helper and browser verification, with model coverage reported honestly rather than claiming unrun cross-model evaluations.

## OMP conventions

The sibling write-plan skill established the local convention of name/description YAML frontmatter, an agent-interpreted slash invocation, assets/references/scripts directories, matching Markdown/HTML artifacts, clickable final paths and the shared `~/.omp/agent/lib/html-document.cjs` finalizer. Project-delivery accepts one `.md` or `.html` source, including proposal-skill HTML, without requiring a finalized brainstorm or invoking write-plan. Its optional slash-command `--project` is an empty Linear destination, not a source or permission to publish.

## Source and template

The requested playbook is bundled unchanged at `references/source-playbook.md` for optional historical context. Its restructuring, general resume, presentation-only and assignment-only workflows are not supported by this first-generation skill. Current SKILL.md and workflow/publication references define scope. Runtime execution does not depend on historical absolute session evidence links. Statements that the playbook was not yet a skill describe the original document, not this installed package.

The current first-generation workflow has one explicit post-publication continuation: it asks an optional final lane-to-Linear-user question, then acts on a clear answer for this run's created tickets only. Stable lettered lanes start with Developer A (lead); the reply authorizes assignee-only changes without a second generic approval. Silence never blocks publication or triggers mutation.

The original HTML was `/Users/michael/Downloads/cg-restructure-publication-plan.html`, titled `Connector Gateway - three-developer execution guide`. Preserve its developer-first queues, dependency table and full ticket disclosures, not its defective bare-main page shell. The template now supplies the same `.layout`, `main.content`, Contents rail and footer structure as tech-doc/write-plan, styled solely by `finalizeHtml(..., {planStyles: true})`. Shared CSS alone did not provide the expected margins or navigation. See `assets/template-provenance.json` for the original digest and corrected shell contract.

This skill installs planning instructions, validation and rendering helpers. It does not install a tracker publication daemon, auto-authorize mutations, implement the CG migration or convert its historical counts/assignments into generic defaults.
