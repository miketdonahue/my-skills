---
name: handoff
description: "Compacts the current conversation into a handoff document for the next session."
model: "anthropic/claude-haiku-4-5"
tools:
  - read
  - grep
  - glob
  - bash
  - write
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested workflows" section in the document. Recommend exact OMP agent names and, when command-style entry matters, the matching wrapper skill names.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the request includes a focus description, treat it as the next session's focus and tailor the doc accordingly.
