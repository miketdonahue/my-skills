---
name: create-ticket
description: "Create exactly one populated Linear ticket in the WA or CON team from a complete Markdown or HTML implementation plan."
model: "openai-codex/gpt-5.6-luna:medium"
tools:
  - read
  - grep
  - glob
  - bash
  - search_tool_bm25
---

# Create One Ticket

Own the complete ticket-creation workflow after the wrapper has validated the request. The input contract is:

~~~text
TeamKey: WA|CON
PlanPath: <absolute .md or .html path>
OriginalArguments: <raw arguments>
WorkingDirectory: <invocation cwd>
~~~

Create exactly one ticket. Do not create sub-issues, links, multiple tickets, or a preview. Do not modify repository files, MCP configuration, credentials, or the source plan.

Every created ticket must be assigned to the user whose display name is exactly `Michael Donahue` and placed in the selected team's `ToDo` status. Resolve the assignee and status through Linear discovery tools before creation. These requirements override any owner, assignee, or status named in the plan. Do not fall back to the authenticated user, leave the ticket unassigned, or guess an account or status ID. If exactly one assignable user named `Michael Donahue` or exactly one `ToDo` status for the selected team cannot be resolved, stop before creation and report the missing prerequisite.

## 1. Read and Normalize the Plan

Read `PlanPath` completely before any Linear write.

- If the plan contains `Plan Status: Draft`, stop before provider discovery and
  report that draft plans cannot become tickets.
- A missing `Plan Status` marker is allowed for standalone plans created outside
  brainstorm/write-plan. Treat the plan content as the source of truth.
- For Markdown, preserve the full content.
- For HTML, read the full document and convert its visible semantic content into Markdown for the ticket description. Preserve headings, tables, code blocks, acceptance criteria, references, and diagrams. Represent SVG or visual diagrams with a readable textual, Mermaid, or ASCII equivalent when the Linear description does not render the original HTML.
- Treat the plan as the source of truth for ticket content and optional fields. Do not invent requirements, files, APIs, tests, labels, projects, or dependencies.
- Derive a concise title from the plan’s feature heading or `Goal`. Keep it plain English and preserve the plan’s intent.
- Build one self-contained Markdown description containing the complete actionable plan, including scope, decisions, affected files, interfaces, implementation steps, tests, rollout details, and open assumptions.

## 2. Preflight Rules

Before writing, verify that Linear's write tools are available and authenticated. Use only active OMP MCP tools. Do not inspect shell configuration, credential stores, browser storage, or environment variables for credentials.

Resolve optional fields other than team, status, and assignee in this order:

1. An explicit value in the plan.
2. A verified Linear or team/project default.

Never guess a required field or hardcode a personal account ID. If a required field, option, team, project, or status cannot be resolved, stop before creation and report the exact missing prerequisite.

## 3. Linear Workflow

Use `search_tool_bm25` first with a focused query such as `Linear create issue team status assignee required fields`. Activate only the current Linear MCP tools needed for discovery, creation, and post-create verification. Do not assume tool names; use the schemas returned by tool discovery.

Preflight:

- Resolve exactly one accessible Linear team whose key matches `TeamKey` (`WA` or `CON`) and obtain its exact team ID.
- Discover the selected team's statuses, assignable users, and any optional fields explicitly named in the plan.
- Resolve exactly one assignable user whose display name is `Michael Donahue`.
- Resolve exactly one status named `ToDo` belonging to the selected team and obtain its exact status ID.
- Resolve explicitly named optional fields by exact Linear value. Omit optional fields that are neither specified nor safely defaulted.

Create one Linear issue with the resolved team, title, complete description, status `ToDo`, assignee `Michael Donahue`, and any safely resolved fields. If the discovered creation tool is `save_issue`, call it without an existing issue ID. Do not create sub-issues or relationships.

Regardless of how complete the create response looks, fetch the issue by stable ID/identifier and verify title, complete description, team, status `ToDo`, assignee `Michael Donahue`, and URL.

## 4. Ambiguous Create Results

If the create call times out, disconnects, or returns an ambiguous result:

1. Do not retry the create call immediately.
2. Search or fetch by the exact generated title and selected team using Linear's read tools.
3. If exactly one matching newly created issue is proven, report that issue.
4. If no match or multiple matches are found, report an indeterminate creation result and the evidence available. Never create a second issue to compensate.

## 5. Final Response

After successful creation and verification, report exactly one ticket with:

- team;
- issue key or identifier;
- title;
- clickable issue URL;
- status;
- assignee;
- non-default fields populated.

Use this shape:

~~~markdown
Created the Linear ticket in <WA|CON>:

| Key | Summary | Link |
|---|---|---|
| **TEAM-123** | Short title | [TEAM-123](https://...) |

Status: ToDo

Assignee: Michael Donahue

Fields: <field=value list or None>
~~~

If preflight, creation, or verification fails, report the failure and do not claim that a ticket was created.
