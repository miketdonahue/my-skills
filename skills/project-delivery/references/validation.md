# Mechanical validation reference

The validator uses Python 3's standard library, explicit `ValidationError` exceptions and read-only input access. It has no project-specific IDs, graph sizes, external API calls, installs or product verification. Its validation logic is identical under `python3` and `python3 -O`; there are no correctness assertions to disable. This is an implementation property, not a claim that any command below has already run.

## Contents

- CLI
- Graph schema
- Frozen source and ledger schemas
- Concrete witness binding
- Staffing manifest and resource batches
- External scope reconciliation
- Reports and limits
- Reproducible positive and negative controls

## CLI

Run from any directory, substituting actual durable paths:

```sh
python3 /path/to/project-delivery/scripts/validate.py \
  --graph /absolute/project/graph.json \
  --ledger /absolute/project/requirements.json \
  --freeze /absolute/project/frozen-sources.json \
  --approved /absolute/project/approved-dependencies.json \
  --project /absolute/project/project.json \
  --developers 3 \
  --independent-groups /absolute/project/independent-groups.json \
  --require-witnesses \
  --report /absolute/project/validation-report.json
```

| Option | Meaning |
| --- | --- |
| `--graph PATH` | Required graph object, described below. |
| `--ledger PATH` | Required frozen-source-to-implementation ledger. |
| `--freeze PATH` | Required immutable source-ID-to-SHA-256 object. |
| `--approved PATH` | Required exact approved prerequisite object. This is not an approval receipt. |
| `--project PATH` | Optional renderer-compatible project manifest. Enables complete internal primary-owner validation, reconciled external-scope checks and conditional resource-batch/checkpoint derivation. |
| `--developers N` | Optional positive maximum active developers per batch. Requires `--project`; cannot exceed the number of declared developers. Defaults to the declared developer count. |
| `--independent-groups PATH` | Optional JSON array of ticket-ID arrays, added to `graph.independentGroups`. Every claim is checked. |
| `--require-witnesses` | Require every authoritative row or fragment to bind literal witness parts to a description heading. Otherwise missing bindings are listed, not silently claimed as verified. Any supplied witness binding is always checked. |
| `--report PATH` | Optional JSON report output. Parent directory must already exist. Cannot overwrite a supplied JSON input or a mapped description. No input file is otherwise changed. |

Exit status is `0` only for a local structural PASS. Invalid data, unreadable files or unwritable reports return `1`; argument syntax errors return `2`. Success and validation failures print JSON on stdout. Argument parser and report-write failures print diagnostics on stderr. A failure reports the first actionable error, not an exhaustive list.

JSON must be UTF-8. Duplicate object keys, invalid JSON numeric constants, duplicate IDs and duplicate relation entries are rejected rather than silently collapsed. Additional object fields are permitted for richer planning sidecars; only the fields documented here are validated.

## Graph schema

```json
{
  "prerequisites": {
    "FOUNDATION": [],
    "LEFT": ["FOUNDATION"],
    "RIGHT": ["FOUNDATION"],
    "JOIN": ["LEFT", "RIGHT"]
  },
  "artifacts": [
    {
      "id": "shared-contract",
      "producer": "FOUNDATION",
      "mergeConsumers": ["LEFT", "RIGHT"]
    },
    {
      "id": "current-parser",
      "producer": "existing-code",
      "sourceReference": "repository/path/parser.py:15-40 at inspected revision",
      "mergeConsumers": ["FOUNDATION"]
    }
  ],
  "independentGroups": [["LEFT", "RIGHT"]],
  "descriptionFiles": {
    "FOUNDATION": "tickets/foundation.md",
    "LEFT": "tickets/left.md",
    "RIGHT": "tickets/right.md",
    "JOIN": "tickets/join.md"
  }
}
```

- `prerequisites` is a nonempty object keyed by stable ticket IDs or draft aliases. Each value is an array of unique direct predecessor IDs. Parent order does not matter. Duplicate, self, dangling and cyclic dependencies fail.
- Every node and parent must be a nonempty string. `existing-code` is reserved and cannot be a ticket ID.
- `artifacts` is a required array; an empty array is valid but does not prove that an inventory is complete. Artifact `id` values must be unique. `producer` must be a graph node or the literal `existing-code`. `mergeConsumers` is a required unique array of graph nodes. Each producer must be the consumer itself or one of its transitive ancestors, unless it is existing code.
- `existing-code` requires a nonempty `sourceReference`. The validator checks presence, not whether the code really exists, has shipped or is compatible. Source reviewers establish those facts. Future work cannot be relabeled existing code to bypass ordering.
- `independentGroups` is optional. Each group must contain at least two distinct graph nodes; no member may transitively depend on another. Staffing availability is a different claim.
- `descriptionFiles` is optional unless witnesses need it. Paths resolve relative to the graph JSON file, never the caller's working directory. Keys must be graph nodes. Absolute paths are also accepted.

`approved-dependencies.json` contains the prerequisite object directly, without a wrapping `prerequisites` key:

```json
{
  "FOUNDATION": [],
  "LEFT": ["FOUNDATION"],
  "RIGHT": ["FOUNDATION"],
  "JOIN": ["LEFT", "RIGHT"]
}
```

The validator compares exact node identities and parent sets, not counts. An equal-sized replacement graph fails. Both graphs must independently be valid closed-scope DAGs. It does not add edges, infer transitive reductions or silently repair either graph. Keep the approved object as an independent frozen artifact, not a value regenerated from the proposed graph immediately before validation.

## Frozen source and ledger schemas

`frozen-sources.json` is a nonempty object mapping each immutable source requirement ID to its lowercase, 64-character SHA-256 digest. Calculate each digest from the exact `sourceText` UTF-8 bytes before drafting. Whitespace and source line endings are significant; do not normalize text before comparing with its frozen digest.

`requirements.json`:

```json
{
  "sourceRequirementIds": ["SOURCE:001"],
  "requirements": [
    {
      "id": "SOURCE:001",
      "sourceIssue": "original-issue-or-document-identity",
      "sourceHeading": "Storage / behavior",
      "sourceOrdinal": 1,
      "sourceText": "Preserve the complete immutable source obligation.",
      "sourceSha256": "replace-with-the-real-digest-of-sourceText",
      "implementationOwner": "FOUNDATION",
      "mergeVerificationOwner": "LEFT",
      "integrationVerificationOwner": "JOIN",
      "destinationTicket": "FOUNDATION",
      "destinationSection": "Owned scope",
      "witnessParts": ["Preserve the complete immutable source obligation."]
    }
  ]
}
```

The digest placeholder above illustrates the field and is intentionally not valid evidence. The reproducible fixture below calculates a real digest.

- The row IDs, `sourceRequirementIds` and frozen-source keys must be exactly equal sets. Duplicate IDs in either array fail. Deleting both a row and its declared ID cannot conceal the missing frozen source.
- Each row requires nonempty `sourceIssue`, `sourceHeading` and exact `sourceText`, plus a nonnegative integer `sourceOrdinal`. Booleans are not integers for this purpose. These metadata fields are required but only source IDs/text digests are compared against this simple freeze format. Preserve occurrence identities and richer immutable metadata separately for review.
- The calculated source digest, row digest and frozen digest must all match. Changing text and updating only the row digest still fails.
- A simple row requires exactly one scalar `implementationOwner`, one `mergeVerificationOwner`, explicit `integrationVerificationOwner` and a nonempty `destinationSection`. Owner/proof fields must be graph nodes. `integrationVerificationOwner` may be JSON `null` when there is no separate integration proof.
- The implementation owner must be the merge verifier or an ancestor of it. The same rule applies to a non-null integration verifier. A verifier cannot precede its own implementation. Integration need not descend from the merge verifier, only from the implementation owner, matching the playbook structure.

### Compound requirements and authoritative fragments

A compound source row retains its immutable source identity/text/digest and adds a nonempty `implementationFragments` array:

```json
{
  "implementationFragments": [
    {
      "id": "helper",
      "scope": "The reusable helper, excluding request orchestration.",
      "implementationOwner": "FOUNDATION",
      "mergeVerificationOwner": "FOUNDATION",
      "integrationVerificationOwner": "JOIN",
      "destinationTicket": "FOUNDATION",
      "destinationSection": "Owned scope",
      "witnessParts": ["Implement the reusable helper."]
    },
    {
      "id": "request-orchestration",
      "scope": "The request-specific orchestration using the shared helper.",
      "implementationOwner": "LEFT",
      "mergeVerificationOwner": "LEFT",
      "integrationVerificationOwner": "JOIN",
      "destinationTicket": "LEFT",
      "destinationSection": "Owned scope",
      "witnessParts": ["Implement request orchestration using the shared helper."]
    }
  ]
}
```

This is a field excerpt, not a complete ledger. Every fragment requires a nonempty locally unique `id`, precise nonempty `scope`, and the same owner/proof/destination fields as a simple row. An empty fragment array fails, rather than falling back to scalar ownership. Concrete fragment owners are authoritative; optional scalar `implementationOwner` on the enclosing row is an indexing aid and must still name a valid node. Other scalar proof/destination fields on a compound row are not used. Do not use them as competing execution instructions.

Structural validation cannot establish that fragments partition all source behavior, that two differently named fragments do not overlap, or that a source occurrence inventory is complete. Independent coverage/ownership review must do so. Repeated source occurrences must retain their canonical requirement links in separate evidence; duplicate row IDs are not a substitute for occurrence references.

## Concrete witness binding

For each simple row or authoritative fragment:

1. `destinationTicket` must be its implementation, merge-verification or non-null integration-verification owner.
2. Map that ticket to a Markdown file using `graph.descriptionFiles` or the project manifest's `descriptionFile`. If both supply a mapping, they must resolve to the same file.
3. `destinationSection` is the exact unique ATX heading text without leading `#` markers. For example, `## Owned scope` is addressed as `Owned scope`. Markdown markup inside a heading remains literal. Duplicate headings with the same text are ambiguous and fail.
4. `witnessParts` is a nonempty array of unique nonempty exact strings. Each part must occur inside the heading's body/subheading subtree before the next heading of equal or higher level. The heading line itself does not satisfy a witness.

Nonadjacent obligations are separate parts; no artificial concatenation is performed. Only CRLF/CR-to-LF normalization is applied to descriptions and witness strings for portability. No whitespace collapse, Markdown rendering, autolink normalization, fuzzy matching or digest-only witness is accepted. Preserve whole-line context when inline code or table clipping could otherwise mislead. Description bytes are hashed into the report before newline normalization.

The heading locator supports ordinary ATX headings and ignores fenced backtick/tilde code blocks. It is deliberately not a complete Markdown parser: Setext headings and complex container/list nesting are unsupported. Use ordinary unambiguous ATX ticket sections. Witness checks read the actual current Markdown description files, not a presumed rendered HTML surface or tracker body. Publication readback and browser inspection remain separate gates.

Use `--require-witnesses` before claiming mechanically bound text coverage. Without it, absent witnesses appear in `bindingsWithoutWitnesses`. Even with all witnesses present, a PASS does not certify that the quoted text preserves the source obligation's meaning or that every executable input has been inventoried.

## Staffing manifest and resource batches

The staffing fields of the renderer-compatible `project.json` include the following excerpt. Add the `prerequisites` and `narratives` required by the rendering contract to render it:

```json
{
  "title": "Example delivery",
  "developers": [
    {"id": "A", "name": "Developer A (lead)"},
    {"id": "B", "name": "Developer B"}
  ],
  "tickets": [
    {"id": "FOUNDATION", "title": "Foundation", "developer": "A", "stage": "implementation", "descriptionFile": "tickets/foundation.md"},
    {"id": "LEFT", "title": "Left", "developer": "A", "stage": "implementation", "descriptionFile": "tickets/left.md"},
    {"id": "RIGHT", "title": "Right", "developer": "B", "stage": "implementation", "descriptionFile": "tickets/right.md"},
    {"id": "JOIN", "title": "Integration", "developer": "A", "stage": "qa", "descriptionFile": "tickets/join.md"}
  ]
}
```

`developers` must be a nonempty array with unique nonempty scalar `id` and nonempty `name`. Every internally staffed ticket must appear exactly once in `tickets`, with one scalar `developer` drawn from the developer IDs. Missing, duplicate, unknown or multiply represented ticket assignments fail. Unused developers are allowed. The validator does not resolve real tracker users or mutate assignees.

Skill-authored manifests use `A`, `B`, `C`, ... (`AA`, `AB`, ... after `Z`), named `Developer A (lead)`, `Developer B`, etc. This general validator verifies ownership structure, not that naming policy. The agent must check lettered labels separately. A later Linear-user mapping does not replace these stable lane IDs or authorize assigning external nodes.

For staffing it consumes developer `id`/`name` and internal ticket `id`/`developer`; `descriptionFile` is used for witnesses. Renderer-specific internal title/stage/narrative checks belong to the renderer. Description paths resolve relative to `project.json`.

The optional `externalTickets` array records reconciled graph nodes owned outside this staffing plan:

```json
{
  "externalTickets": [
    {
      "id": "EXTERNAL-CONTRACT",
      "title": "Externally owned contract delivery",
      "descriptionFile": "tickets/external-contract.md",
      "url": "https://tracker.example/EXTERNAL-CONTRACT",
      "displayId": "EXTERNAL-CONTRACT"
    }
  ]
}
```

This is a field excerpt, not a complete graph. External entries require nonempty `id`, `title` and `descriptionFile`; `url` and `displayId` are optional nonempty strings. They must not have `developer` or `stage` fields, including null values. IDs cannot repeat or overlap internal ticket IDs. The exact union of `tickets` and `externalTickets` must equal the graph node set. External descriptions can supply witness bindings exactly like internal descriptions. Listing an external ticket does not assert its completion or availability.

If the manifest supplies `prerequisites`, its exact node/parent sets must equal `graph.prerequisites`. Parent order is irrelevant. This prevents a renderer from presenting a different DAG from the validated one. No graph node or external ancestor is removed for staffing.

Conditional resource ordering is deterministic. Starting with no planned completions, walk currently prerequisite-satisfied external nodes as explicit `externalCheckpoint` steps. These steps state that externally owned delivery must be independently established before proceeding; they are not claims that the nodes are done. Then select internal tickets in lexicographic ID order, at most one per developer and up to the capacity, producing an `internalBatch` step. All selected tickets become conditionally complete only for later steps. Repeat across the full graph. External nodes that depend on internal work cannot be traversed before that work's earlier planned batch.

The report provides ordered `steps`, an internal-only `batches` view, all transitive `externalPrerequisites` per internal ticket, and `externalConstraints` containing each external node's exact direct prerequisites and internal/external ancestors. Every staffed batch entry also contains its external ancestor inputs, including previously encountered checkpoints. For `INTERNAL-A -> EXTERNAL-E -> INTERNAL-B`, the conditional steps are an A batch, an E checkpoint and a B batch, never an assertion that E was initially available. A chain of external nodes yields checkpoints in dependency order.

This is a conservative conditional suggested order, not an optimal schedule, a calendar forecast, a current ready queue or evidence of equal workloads. It does not change dependencies, assign external work, or use manifest stages as hidden blockers. `topologicalWaves` includes the full graph and ignores staffing, so it is a different view. External checkpoint delivery and real predecessor completion must be verified outside this planning validator.

## External scope reconciliation

This validator intentionally has a closed, reconciled node universe. An unrepresented external prerequisite is a failure, never a relation to drop. External nodes included in that universe remain real graph nodes even when they are not staffed internally. Before validation:

1. Retrieve and inspect the actual external node and recursively reachable prerequisites.
2. Reconcile its implementation and proof constraints with the proposed scope.
3. Either include those nodes, edges, artifacts and any relevant coverage in the approved validation universe, or obtain approval for a precise new boundary supported by evidence.
4. Preserve tracker identities, raw observed relations and the reconciliation record. Reapprove materially changed direct edges or scope under the applicable governance.

Do not convert an unlanded external prerequisite into `existing-code`, delete a relation to get a PASS, or regenerate the approved graph without approval. If staffing is supplied, classify each reconciled graph node exactly once as internally staffed or `externalTickets`. Preserve all external dependencies and their recursively reachable constraints in both approved and proposed graphs. External checkpoints make the suggested staffing order explicitly conditional; they do not prove external delivery, assign owners, waive scope approval or authorize a release.

## Reports and limits

A success report includes exact canonical prerequisites, topological waves, ancestor sets, artifact/source/binding/witness counts, missing witness labels, input paths/digests, checked description paths/digests, checked independent groups and optional conditional staffing batches, ordered external checkpoint steps and external constraint inputs. `status: PASS` means only the checks exercised on these local supplied files passed. It is not semantic coverage, a fresh live-tracker audit, current work readiness, implementation completion, test execution, measured performance, deployment readiness or authorization. `status: FAIL` includes the first error. Save independent review findings, contract-inventory equality checks and fresh publication receipts separately; the validator does not invent them.

The freeze cannot authenticate itself. Replacing both the freeze and the ledger can manufacture matching hashes. Freeze before drafting and retain independent provenance and approval fingerprints. Existing-code reference truth, completeness of consumed artifacts, exact operation/caller/permission inventories and meaning-preserving source coverage require independent source-backed review. Generic strings or heading matches are not sufficient semantic proof.

### Python API

Load `scripts/validate.py` using `importlib.util` if importing by file path, then call:

```python
report = module.validate_project(
    graph, ledger, frozen_sources, approved_dependencies,
    independent_groups=None,       # additional list of groups
    description_files=None,        # ticket ID -> resolved path
    require_witnesses=False,
    project=None,                  # renderer manifest, enables staffing
    capacity=None                  # defaults to declared developer count
)
```

Invalid inputs raise `module.ValidationError`; the function does not print or write. The API expects dictionaries/lists already decoded from JSON. Use `module.load_json(path)` to retain duplicate-key rejection. Use `module.resolve_description_files(graph, graph_directory, project, project_directory)` for the same relative-path handling as the CLI. CLI input fingerprints are added by `main`, not the pure structural API. Description witnesses are read by the API when supplied.

## Reproducible positive and negative controls

The following standalone command creates temporary local fixtures and runs the validator in both normal and optimized mode. It uses no tracker, repository product checks or runtime services, modifies no real planning evidence and cleans up its temporary directory. Substitute the real installed validator path. The controls are instructions to execute, not a record of execution. Keep test expectations as explicit exceptions rather than Python assertions so the harness itself remains meaningful under `-O`.

```sh
python3 - /absolute/path/to/project-delivery/scripts/validate.py <<'PY'
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

validator = Path(sys.argv[1]).resolve()
source = "Preserve exact source behavior."
digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
deps = {"ROOT": [], "LEFT": ["ROOT"], "RIGHT": ["ROOT"], "JOIN": ["LEFT", "RIGHT"]}
graph = {
    "prerequisites": deps,
    "artifacts": [{"id": "contract", "producer": "ROOT", "mergeConsumers": ["LEFT", "RIGHT"]}],
    "independentGroups": [["LEFT", "RIGHT"]]
}
row = {
    "id": "S1", "sourceIssue": "source", "sourceHeading": "Scope", "sourceOrdinal": 1,
    "sourceText": source, "sourceSha256": digest, "implementationOwner": "ROOT",
    "mergeVerificationOwner": "LEFT", "integrationVerificationOwner": "JOIN",
    "destinationTicket": "ROOT", "destinationSection": "Owned scope", "witnessParts": [source]
}
ledger = {"sourceRequirementIds": ["S1"], "requirements": [row]}
project = {
    "title": "Diamond", "developers": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
    "tickets": [{"id": node, "title": node, "developer": "B" if node in {"RIGHT", "JOIN"} else "A",
                 "stage": "Example", "descriptionFile": node + ".md"} for node in deps]
}
base = {"graph": graph, "ledger": ledger, "freeze": {"S1": digest}, "approved": copy.deepcopy(deps), "project": project}
cases = []

def invalid(name, edit):
    data = copy.deepcopy(base)
    edit(data)
    cases.append((name, data, False))

cases.append(("valid diamond", copy.deepcopy(base), True))
fragmented = copy.deepcopy(base)
fragment = {key: value for key, value in fragmented["ledger"]["requirements"][0].items()
            if key in {"implementationOwner", "mergeVerificationOwner", "integrationVerificationOwner",
                       "destinationTicket", "destinationSection", "witnessParts"}}
fragment.update({"id": "behavior", "scope": source})
fragmented["ledger"]["requirements"][0]["implementationFragments"] = [fragment]
cases.append(("valid authoritative fragment", fragmented, True))
external = copy.deepcopy(base)
external["project"]["tickets"] = [t for t in external["project"]["tickets"] if t["id"] != "LEFT"]
external["project"]["externalTickets"] = [
    {"id": "LEFT", "title": "External left", "descriptionFile": "LEFT.md"}]
external["project"]["prerequisites"] = copy.deepcopy(deps)
cases.append(("valid external intermediate", external, True))
invalid("cycle", lambda d: d["graph"]["prerequisites"]["ROOT"].append("JOIN"))
invalid("missing source", lambda d: d["ledger"].update({"requirements": [], "sourceRequirementIds": []}))
invalid("changed text", lambda d: d["ledger"]["requirements"][0].update({"sourceText": "Changed"}))
invalid("changed digest", lambda d: d["ledger"]["requirements"][0].update({"sourceSha256": "0" * 64}))
invalid("nonancestor artifact", lambda d: d["graph"]["artifacts"][0].update({"producer": "LEFT", "mergeConsumers": ["RIGHT"]}))
invalid("duplicate artifact", lambda d: d["graph"]["artifacts"].append(copy.deepcopy(d["graph"]["artifacts"][0])))
invalid("missing existing evidence", lambda d: d["graph"]["artifacts"][0].update({"producer": "existing-code"}))
invalid("duplicate edge", lambda d: d["graph"]["prerequisites"]["LEFT"].append("ROOT"))
invalid("self edge", lambda d: d["graph"]["prerequisites"]["LEFT"].append("LEFT"))
invalid("external edge", lambda d: d["graph"]["prerequisites"]["LEFT"].append("OUTSIDE"))
invalid("same count changed graph", lambda d: d["graph"]["prerequisites"].update({"RIGHT": ["LEFT"]}))
invalid("invalid owner", lambda d: d["ledger"]["requirements"][0].update({"implementationOwner": "OUTSIDE"}))
invalid("proof before implementation", lambda d: d["ledger"]["requirements"][0].update({"implementationOwner": "JOIN"}))
invalid("missing witness", lambda d: d["ledger"]["requirements"][0].update({"witnessParts": ["Absent text"]}))
invalid("duplicate staffing", lambda d: d["project"]["tickets"].append(copy.deepcopy(d["project"]["tickets"][0])))
invalid("invalid primary owner", lambda d: d["project"]["tickets"][0].update({"developer": "UNKNOWN"}))
invalid("manifest graph mismatch", lambda d: d["project"].update({
    "prerequisites": {"ROOT": [], "LEFT": ["ROOT"], "RIGHT": ["LEFT"], "JOIN": ["LEFT", "RIGHT"]}}))

def false_independence(data):
    # Also update approved parents so rejection actually reaches independence validation.
    data["graph"]["prerequisites"]["RIGHT"] = ["LEFT"]
    data["approved"]["RIGHT"] = ["LEFT"]
invalid("false independent group", false_independence)

with tempfile.TemporaryDirectory(prefix="project-delivery-validation-") as directory:
    root = Path(directory)
    for node in deps:
        (root / (node + ".md")).write_text("# Ticket\n\n## Owned scope\n\n" + source + "\n", encoding="utf-8")
    for optimized in (False, True):
        for name, data, expected in cases:
            for key, value in data.items():
                (root / (key + ".json")).write_text(json.dumps(value), encoding="utf-8")
            command = [sys.executable] + (["-O"] if optimized else []) + [str(validator)]
            for flag in ("graph", "ledger", "freeze", "approved", "project"):
                command += ["--" + flag, str(root / (flag + ".json"))]
            command += ["--developers", "2", "--require-witnesses"]
            completed = subprocess.run(command, capture_output=True, text=True, cwd=root.parent)
            if (completed.returncode == 0) != expected:
                raise RuntimeError(f"{name}, optimized={optimized}: unexpected result\n{completed.stdout}\n{completed.stderr}")
            report = json.loads(completed.stdout)
            if expected:
                if report["status"] != "PASS" or report["topologicalWaves"] != [["ROOT"], ["LEFT", "RIGHT"], ["JOIN"]]:
                    raise RuntimeError(f"{name}: wrong positive report")
                for batch in report["staffing"]["batches"]:
                    owners = [entry["developer"] for entry in batch]
                    if len(batch) > 2 or len(owners) != len(set(owners)):
                        raise RuntimeError("Invalid resource batch")
            elif report["status"] != "FAIL":
                raise RuntimeError(f"{name}: wrong negative report")
            print(("optimized" if optimized else "normal") + ": " + name + ": expected result observed")
PY
```

For additional hardening, repeat with duplicated JSON object keys, omitted declared IDs, duplicate source rows, empty fragments, duplicate fragment IDs, invalid integration ancestry, ambiguous/missing headings, a witness only present in another section, an invalid report destination and an invalid developer capacity. Exercise overlapping internal/external IDs, duplicate external IDs, external developer/stage fields and chained external prerequisites after internal work. Inspect ordered steps to ensure external checkpoints never precede their internal prerequisites. Mutate in-memory copies or temporary fixtures only. A graph PASS and these negative controls never replace semantic reviews, frozen contract equality or fresh live readbacks.
