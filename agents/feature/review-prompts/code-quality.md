# Code Quality Review

Maintainability and structure of changed code — not security or performance.

## Focus

- **DRY** — flag repetition aggressively; duplicated logic, copy-pasted blocks, parallel structures that should share one abstraction
- **Error handling** — missing catches, swallowed errors, wrong error types, inconsistent error shapes
- **Edge cases** — null/undefined, empty collections, boundary values, race windows the code ignores
- **Engineering balance** — over-abstracted or premature generalization vs under-engineered / fragile shortcuts
- **Technical debt** — hotspots that will hurt the next change; tight coupling; hidden dependencies
- **Clarity** — naming, function size, control flow; clever code that should be obvious

## Output

Group findings under **Code Quality**. Per finding: severity, file path (line range when possible), description, concrete fix suggestion when not a Nit.
