# Code Style

## Scope

**Excluded directories — do NOT apply these rules:**

- Any `backend/` directory (Python service — has its own standards)

For files under `backend/`: read and follow the `AGENTS.md` found in that directory
(`/Users/michael/development/writer/fs.action-ai/backend/AGENTS.md`) instead of these rules.

**All other directories** — apply the rules below.

---

Apply to all files changed in a wave. No other style changes.

1. No one-line conditionals — always use braces and a block body
2. Blank line before `return`, `throw`, and `try/catch` only when they follow other statements in the same block; no blank line when they are the first or only statement in that block
3. Newline before every conditional (`if`, `else if`, `else`, ternaries on their own line)
4. Group `const` declarations together, then `let` declarations together, at the top of each scope; add newline between multi-line groups
5. All filenames must be kebab-case — rename files and update all imports/references if violated
6. Default to no comments. The only allowed source comments are concise TSDoc (`/** ... */`) immediately above a function or class definition, and only when they explain non-obvious intent, an invariant, an external contract, or a trade-off that the code cannot express. Keep allowed TSDoc to at most six non-empty lines and 600 characters.
7. Simple ternaries are acceptable; nested or complex ternaries are not — refactor to `if/else` or early returns instead
8. Domain-specific naming — no vague identifiers (`data`, `item`, `value`, `result`), no misleading names, no one-letter variables outside tiny local scopes
9. Prefer guard clauses and early returns over deeply nested conditionals
10. TypeScript: literal unions or `as const` for known value sets (not bare `string`); no `any` (prefer `unknown` and narrow); no `as` or `!` silencing except `as const` and narrowing after a discriminant check
11. File section order — top to bottom: (1) imports, (2) `type` / `interface` declarations, (3) file-specific constants, (4) main code logic, (5) file-specific helper functions declared with `function`. Put all type and interface declarations together below imports and above constants; do not interleave them with runtime code.
12. Extract a named constant at the top of the scope when a value is used 2+ times in the file
13. Prefer dot property access over bracket access except dynamic typed keys
14. No boolean flag arguments — use separate named functions or variants instead
15. Return new values — do not mutate caller objects or arrays in place (spread, `toSorted()`, etc.)
16. No empty `catch` blocks; error messages must include operation/entity context — not bare `Error('failed')`
17. Delete commented-out code, file/module headers, section separators, inline narration, and any comment that is not compliant TSDoc on a function or class definition. Never put ticket IDs, PR numbers, personal or agent names, author metadata, or AI-attribution metadata in source comments; keep that context in commit and PR metadata.

Commit fixes in a single commit: `style: enforce code style rules`.
