# Verification history

Append-only log of exporter/contract and registration checks for the rank-candidates skill. Reading this file is maintenance context only; it never authorizes a hiring run.

## Contents
- Registration and baseline guardrail checks
- Current human-review policy verification
- Model-scored restore (v6) verification
- Location column (v7) verification

## Registration and baseline guardrail checks

- OMP 18.4.4 fresh RPC startup advertised the human file command `rank-candidates`; its automatic model system prompt contained no `rank-candidates` skill entry. No model/ATS invocation was used for that discovery check. The native command reads the physical skill path, so it does not depend on the current session refreshing `skill://` resolution.
- The offline exporter passed 17 routing cases, 6,250 rating/uncertainty combinations, 100 shuffled-order checks and actual temporary CSV write/read-back, collision, empty-cohort, formula-escaping and invalid-input checks.
- Two stateless no-tool synthetic prompt simulations returned the exact four columns, blank-score Reject for sourced flags and blank-score Review required for missing fraud data; profile privacy alone did not alter ratings.
- This verifies registration and guardrails, not a fresh live-cohort run, deployed Ashby fraud-surface completeness or predictive hiring quality. Existing v3 CSVs were not rewritten or regenerated.
- Initial Action-column update (before the missing-evidence policy change): actual temporary CSV export/read-back verified the five-column schema, Review/Decline enum, 7.0 Review boundary, capped/provisional scores below 7.0 as Decline, fraud-triggered Decline with blank Score, and unavailable non-fraud records as Review. No ATS calls or earlier CSV rewrites occurred.
- Missing-evidence policy update: actual 14-record temporary CSV export/read-back verified Decline for unknown/incomplete fraud checks, missing/unmapped fraud status, unresolved applications and unavailable resumes, with blank Score and Stage Review required preserved. Fraud precedence, the 7.0 boundary, provisional scoring and screening-only failure routing also passed. Missing-evidence reasons remain in the audit, not fraud allegations. No ATS calls, real-cohort rerun or earlier CSV rewrites occurred.

### Current human-review policy verification

- Ran the actual exporter CLI against a 19-record synthetic packet with temporary HOME/Downloads, then read the written CSV back. The five headers, blank-score Review without human ratings, low-score Review (including 5.9 and 6.9 ceilings), limited-evidence Review and existing fraud/unavailable-evidence Decline gates passed.
- Numeric ratings without a human approval reference were rejected before any output directory/file was created. All 3,125 possible five-integer human-rating combinations produced Review when no fraud/unavailable-evidence gate applied; score values cannot trigger Decline.
- Twenty shuffled inputs preserved output ordering; collision handling preserved the first CSV; empty-cohort export produced only the five-column header. Python compilation and Ruff check passed. Temporary artifacts were removed.
- These are exporter/runtime and contract checks, not a new live-cohort run, a model-semantic prompt evaluation, proof of human provenance from a reference string alone or validation of hiring quality. No Ashby calls or historical CSV rewrites occurred.
- Output simplification: removed interview-question and dossier-generation requirements; supporting audit is limited to sources, provenance, calculations, routing reasons and run counts/access limits. An actual five-record CLI CSV export/read-back confirmed unchanged headers, ordering and score/Action behavior. Temporary artifacts were removed; no ATS calls or live ranking run occurred.

### Model-scored restore (v6) verification

- Ran the actual exporter CLI against a 10-record synthetic packet with temporary HOME/Downloads and read the CSV back: model-scored Review (9.3, 7.5), score-boundary Decline (6.8, 5.9 ceiling), human-override 10.0 with approval reference, provisional 8.8 Review required, fraud Reject blank Decline, unknown-fraud blank Decline, screening-FAIL blank Review, unavailable-resume blank Decline, and group/score-descending ordering with Reject last all passed.
- The exporter rejected fraud-clear readable records with null ratings, ratings without a `rating_source`, human-sourced ratings without an approval reference, and malformed rating arrays before writing any file.
- All 6,250 rating/unresolved combinations stayed within 1.0-10.0 and respected the 5.9/6.9/8.9 ceilings; the rounded 7.0 boundary split 590 Review-side from 5,660 Decline-side combinations. Python compilation and Ruff passed; temporary artifacts were removed.
- These are exporter/contract checks, not a live-cohort rerun or hiring-quality validation. No Ashby calls occurred and no historical CSVs were rewritten.

### Location column (v7) verification

- Ran the actual exporter CLI against a 6-record synthetic packet with temporary HOME/Downloads and read the CSV back: six headers in order `Candidate,Ashby,Location,Stage,Score,Action`; verbatim Location passthrough for scored, unknown-fraud and unresolved rows; blank Location preserved; a formula-leading Location (`=2+2 Evil City`) was apostrophe-escaped; Reject stayed last with blank Score.
- A record missing the `location` key was rejected (`location must be a string`) before any output file was created; empty-cohort export produced only the six-column header. Python compilation and Ruff passed; temporary artifacts were removed.
- These are exporter/contract checks only: no Ashby calls, no live-cohort rerun, and no rewrite of earlier five-column CSVs or audits.

## Structure optimization (Anthropic best-practices pass)

- Aligned with the published skill-authoring best practices: description rewritten in third person with explicit what/when triggers; verification history moved from SKILL.md into this reference file (one level deep); a copyable run-progress checklist added to the workflow; a table of contents added to references/prompt.md.
- No scoring, gate, CSV-contract, exporter or guardrail text changed; `connectors-mcp-v7-location` remains current. No Ashby calls occurred and no prior outputs were touched.

## Pack-driven engine migration (v8)

- Captured the original v7 exporter output for a 10-record synthetic packet before migration. The pack-driven exporter produced a byte-identical CSV, including scores, group/tie ordering, Location, blank scores and Review/Decline actions.
- Ran the exporter CLI with an alternate three-criterion pack (50/30/20 weights, no low-rating caps, 10.0 excellence cap, 6.0 Review boundary, no tiebreakers): `[4,2,1]` produced `7.0` / Review and `[1,1,1]` produced `2.5` / Decline.
- Both packs passed generalized smoke exports. Connectors reference vectors, Location passthrough/escaping, missing-Location rejection before output, empty cohorts, fraud precedence and unresolved references passed. Invalid weights, malformed policy keys, missing signoff and invalid decimal values were rejected.
- No engine gate or CSV-contract behavior changed. Role-specific rubric, ceilings, boundary and tie policy moved into the signed-off pack; documentation now references those fields instead of hardcoded connectors values. Python compilation and Ruff passed.
- No ATS calls, live candidate ranking, or historical output rewrites occurred. These checks prove exporter compatibility and policy parameterization, not hiring accuracy.
