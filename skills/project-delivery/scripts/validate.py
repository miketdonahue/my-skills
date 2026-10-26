#!/usr/bin/env python3
"""Read-only project graph, frozen coverage, witness and staffing validation."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


class ValidationError(ValueError):
    """An invalid input or unproven structural claim."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def object_value(value, label):
    require(isinstance(value, dict), f"{label}: expected an object")
    return value


def array_value(value, label):
    require(isinstance(value, list), f"{label}: expected an array")
    return value


def string_value(value, label):
    require(isinstance(value, str) and bool(value.strip()),
            f"{label}: expected a nonempty string")
    return value


def unique_strings(value, label):
    items = array_value(value, label)
    seen = set()
    for item in items:
        string_value(item, label)
        require(item not in seen, f"{label}: duplicate {item!r}")
        seen.add(item)
    return items


def sha_value(value, label):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value),
            f"{label}: expected a lowercase SHA-256 digest")
    return value


def json_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"JSON contains duplicate object key {key!r}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValidationError(f"Invalid JSON numeric constant {value}")


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"),
                          object_pairs_hook=json_pairs, parse_constant=reject_constant)
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValidationError(f"Cannot read JSON {path}: {exc}") from exc


def dependency_map(value, label):
    deps = object_value(value, label)
    require(bool(deps), f"{label}: empty project graph")
    require("existing-code" not in deps,
            f"{label}: 'existing-code' is reserved for existing artifact producers")
    for node, parents in deps.items():
        string_value(node, f"{label} node")
        unique_strings(parents, f"{label}.{node}")
        require(node not in parents, f"{label}: self dependency {node}")
        for parent in parents:
            require(parent in deps,
                    f"{label}: unreconciled external/dangling dependency {node} <- {parent}")
    return deps


def graph_order(deps):
    done, ancestors, waves = set(), {}, []
    while len(done) < len(deps):
        ready = sorted(node for node, parents in deps.items()
                       if node not in done and set(parents) <= done)
        require(bool(ready), "Dependency cycle among: " + ", ".join(sorted(set(deps) - done)))
        waves.append(ready)
        for node in ready:
            ancestors[node] = set(deps[node])
            for parent in deps[node]:
                ancestors[node].update(ancestors[parent])
        done.update(ready)
    return waves, ancestors


def heading_regions(text):
    """Find ATX heading subtrees, ignoring fenced code blocks."""
    lines = text.splitlines(keepends=True)
    headings, fence, offset = [], None, 0
    for line in lines:
        raw = line.rstrip("\r\n")
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", raw)
        if fence:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= fence[1] and not marker.group(2).strip():
                fence = None
        elif marker:
            # Backticks in a backtick fence's info string invalidate its opener.
            if marker.group(1)[0] != "`" or "`" not in marker.group(2):
                fence = (marker.group(1)[0], len(marker.group(1)))
        else:
            heading = re.match(r"^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$", raw)
            if heading:
                title = (heading.group(2) or "").strip()
                title = re.sub(r"[ \t]+#+[ \t]*$", "", title).strip()
                headings.append((len(heading.group(1)), title, offset, offset + len(line)))
        offset += len(line)
    regions = {}
    for index, (level, title, start, body_start) in enumerate(headings):
        end = len(text)
        for next_level, _, next_start, _ in headings[index + 1:]:
            if next_level <= level:
                end = next_start
                break
        regions.setdefault(title, []).append((start, body_start, end))
    return regions


def resolve_description_files(graph, graph_base, project=None, project_base=None):
    """Resolve manifest paths without changing graph data or the working directory."""
    result = {}
    mapping = object_value(graph.get("descriptionFiles", {}), "graph.descriptionFiles")
    for node, value in mapping.items():
        string_value(node, "graph.descriptionFiles key")
        result[node] = (Path(graph_base) / string_value(value, f"descriptionFiles.{node}")).resolve()
    if project is not None:
        object_value(project, "project")
        for collection in ("tickets", "externalTickets"):
            values = project.get(collection, []) if collection == "externalTickets" else project.get(collection)
            for index, ticket in enumerate(array_value(values, f"project.{collection}")):
                object_value(ticket, f"project.{collection}[{index}]")
                node = string_value(ticket.get("id"), f"project.{collection}[{index}].id")
                if "descriptionFile" in ticket:
                    path = (Path(project_base or graph_base) /
                            string_value(ticket["descriptionFile"], f"{node}.descriptionFile")).resolve()
                    require(node not in result or result[node] == path,
                            f"Conflicting description paths for {node}")
                    result[node] = path
    return result


def validate_staffing(project, deps, capacity=None):
    object_value(project, "project")
    if "prerequisites" in project:
        supplied = dependency_map(project["prerequisites"], "project.prerequisites")
        require({node: sorted(parents) for node, parents in supplied.items()} ==
                {node: sorted(parents) for node, parents in deps.items()},
                "Project manifest prerequisites differ from the validated graph")
    developers = array_value(project.get("developers"), "project.developers")
    developer_ids = set()
    for index, developer in enumerate(developers):
        object_value(developer, f"project.developers[{index}]")
        ident = string_value(developer.get("id"), f"project.developers[{index}].id")
        string_value(developer.get("name"), f"project.developers[{index}].name")
        require(ident not in developer_ids, f"Duplicate developer ID {ident}")
        developer_ids.add(ident)
    require(bool(developer_ids), "Staffing requires at least one developer")
    if capacity is None:
        capacity = len(developer_ids)
    require(type(capacity) is int and 1 <= capacity <= len(developer_ids),
            "Developer capacity must be an integer from 1 through the declared developer count")
    owners = {}
    for index, ticket in enumerate(array_value(project.get("tickets"), "project.tickets")):
        object_value(ticket, f"project.tickets[{index}]")
        node = string_value(ticket.get("id"), f"project.tickets[{index}].id")
        require(node in deps, f"Staffing has unknown ticket {node}")
        require(node not in owners, f"Duplicate staffing ticket {node}")
        owner = string_value(ticket.get("developer"), f"{node}.developer")
        require(owner in developer_ids, f"{node}: invalid primary developer {owner}")
        owners[node] = owner
    external = {}
    for index, ticket in enumerate(array_value(project.get("externalTickets", []), "project.externalTickets")):
        label = f"project.externalTickets[{index}]"
        object_value(ticket, label)
        node = string_value(ticket.get("id"), f"{label}.id")
        require(node in deps, f"External scope has unknown ticket {node}")
        require(node not in external and node not in owners,
                f"Duplicate or overlapping external ticket {node}")
        require("developer" not in ticket and "stage" not in ticket,
                f"{node}: external tickets must not declare developer or stage")
        string_value(ticket.get("title"), f"{label}.title")
        string_value(ticket.get("descriptionFile"), f"{label}.descriptionFile")
        for field in ("url", "displayId"):
            if field in ticket:
                string_value(ticket[field], f"{label}.{field}")
        external[node] = ticket
    require(set(owners) | set(external) == set(deps),
            "Project scope missing tickets: " +
            ", ".join(sorted(set(deps) - set(owners) - set(external))))
    _, ancestors = graph_order(deps)
    planned_complete, batches, steps = set(), [], []
    while len(planned_complete) < len(deps):
        checkpoints = sorted(node for node in external
                             if node not in planned_complete and set(deps[node]) <= planned_complete)
        if checkpoints:
            steps.append({
                "type": "externalCheckpoint", "tickets": checkpoints,
                "prerequisites": {node: sorted(deps[node]) for node in checkpoints},
                "assumption": "Externally owned delivery must be established before proceeding; not verified complete."
            })
            # Conditional traversal only: this records a required checkpoint, not live readiness.
            planned_complete.update(checkpoints)
            continue
        used, selected = set(), []
        for node in sorted(owners):
            if (node not in planned_complete and set(deps[node]) <= planned_complete
                    and owners[node] not in used):
                selected.append(node)
                used.add(owners[node])
                if len(selected) == capacity:
                    break
        require(bool(selected), "Cannot derive conditional staffing steps from supplied graph")
        batch = [{"ticket": node, "developer": owners[node],
                  "externalPrerequisites": sorted(ancestors[node] & set(external))}
                 for node in selected]
        batches.append(batch)
        steps.append({"type": "internalBatch", "batch": len(batches), "tickets": batch})
        planned_complete.update(selected)
    return {
        "capacity": capacity, "developerCount": len(developer_ids),
        "internalTicketCount": len(owners), "externalTicketCount": len(external),
        "batches": batches, "steps": steps,
        "externalPrerequisites": {
            node: sorted(ancestors[node] & set(external)) for node in sorted(owners)},
        "externalConstraints": {
            node: {"prerequisites": sorted(deps[node]),
                   "internalAncestors": sorted(ancestors[node] & set(owners)),
                   "externalAncestors": sorted(ancestors[node] & set(external))}
            for node in sorted(external)},
        "assumption": (
            "Conditional proposed order only. Internal batches assume earlier planned deliveries finish; "
            "external checkpoints require independently established delivery and are not evidence of completion "
            "or current readiness. External work is never assigned to the declared developers."
        )
    }


def validate_project(graph, ledger, frozen_sources, approved_dependencies,
                     independent_groups=None, description_files=None,
                     require_witnesses=False, project=None, capacity=None):
    """Raise ValidationError on invalid input; return serializable evidence on success."""
    object_value(graph, "graph")
    object_value(ledger, "ledger")
    deps = dependency_map(graph.get("prerequisites"), "graph.prerequisites")
    approved = dependency_map(approved_dependencies, "approved dependencies")
    waves, ancestors = graph_order(deps)
    graph_order(approved)
    canonical = {node: sorted(parents) for node, parents in deps.items()}
    expected = {node: sorted(parents) for node, parents in approved.items()}
    require(canonical == expected, "Approved exact graph changed (node identities or direct parent sets)")

    artifact_ids = set()
    for index, artifact in enumerate(array_value(graph.get("artifacts"), "graph.artifacts")):
        label = f"graph.artifacts[{index}]"
        object_value(artifact, label)
        ident = string_value(artifact.get("id"), f"{label}.id")
        require(ident not in artifact_ids, f"Duplicate artifact ID {ident}")
        artifact_ids.add(ident)
        producer = string_value(artifact.get("producer"), f"{label}.producer")
        require(producer == "existing-code" or producer in deps,
                f"Artifact {ident}: unknown producer {producer}")
        if producer == "existing-code":
            string_value(artifact.get("sourceReference"), f"Artifact {ident} existing-code sourceReference")
        for consumer in unique_strings(artifact.get("mergeConsumers"), f"Artifact {ident}.mergeConsumers"):
            require(consumer in deps, f"Artifact {ident}: unknown consumer {consumer}")
            require(producer == "existing-code" or producer == consumer or producer in ancestors[consumer],
                    f"Artifact {ident}: nonancestor merge input {producer} -> {consumer}")

    groups = array_value(graph.get("independentGroups", []), "graph.independentGroups")[:]
    if independent_groups is not None:
        groups.extend(array_value(independent_groups, "independent groups"))
    for index, group in enumerate(groups):
        members = set(unique_strings(group, f"independent group {index}"))
        require(len(members) >= 2, f"Independent group {index} must contain at least two tickets")
        require(members <= set(deps), f"Independent group {index} has unknown tickets")
        for node in sorted(members):
            conflicts = ancestors[node] & (members - {node})
            require(not conflicts,
                    f"False independence: {node} depends on {', '.join(sorted(conflicts))}")

    frozen = object_value(frozen_sources, "frozen sources")
    require(bool(frozen), "Frozen source inventory must not be empty")
    for ident, digest in frozen.items():
        string_value(ident, "frozen source ID")
        sha_value(digest, f"Frozen source {ident}")
    declared = unique_strings(ledger.get("sourceRequirementIds"), "ledger.sourceRequirementIds")
    rows = array_value(ledger.get("requirements"), "ledger.requirements")
    by_id = {}
    for index, row in enumerate(rows):
        object_value(row, f"ledger.requirements[{index}]")
        ident = string_value(row.get("id"), f"ledger.requirements[{index}].id")
        require(ident not in by_id, f"Duplicate source requirement ID {ident}")
        by_id[ident] = row
    require(set(by_id) == set(declared) == set(frozen),
            "Source ID sets differ: " + json.dumps({
                "missingRows": sorted(set(frozen) - set(by_id)),
                "extraRows": sorted(set(by_id) - set(frozen)),
                "missingDeclared": sorted(set(frozen) - set(declared)),
                "extraDeclared": sorted(set(declared) - set(frozen))}, sort_keys=True))

    paths = {} if description_files is None else object_value(description_files, "description files")
    require(set(paths) <= set(deps), "Description file mapping contains unknown tickets")
    documents, witness_count, binding_count, missing_witnesses = {}, 0, 0, []

    def witness(binding, label, owner, merge, final):
        nonlocal witness_count
        if "witnessParts" not in binding:
            require(not require_witnesses, f"{label}: missing witnessParts")
            missing_witnesses.append(label)
            return
        parts = unique_strings(binding["witnessParts"], f"{label}.witnessParts")
        require(bool(parts), f"{label}: empty witnessParts")
        target = string_value(binding.get("destinationTicket"), f"{label}.destinationTicket")
        require(target in {owner, merge, final},
                f"{label}: destinationTicket must be its implementation or proof owner")
        require(target in paths, f"{label}: no description file mapped for {target}")
        if target not in documents:
            path = Path(paths[target])
            try:
                data = path.read_bytes()
                text = data.decode("utf-8")
            except (OSError, UnicodeError) as exc:
                raise ValidationError(f"Cannot read description {target} at {path}: {exc}") from exc
            # Universal newlines make exact Markdown witnesses portable across line endings.
            text = text.replace("\r\n", "\n").replace("\r", "\n")
            documents[target] = (text, heading_regions(text), {
                "path": str(path.resolve()), "sha256": hashlib.sha256(data).hexdigest()})
        text, regions, _ = documents[target]
        section = binding["destinationSection"]
        matches = regions.get(section, [])
        require(len(matches) == 1,
                f"{label}: expected one ATX destination heading {section!r} in {target}, found {len(matches)}")
        _, start, end = matches[0]
        body = text[start:end]
        for part_index, part in enumerate(parts):
            normalized = part.replace("\r\n", "\n").replace("\r", "\n")
            require(normalized in body,
                    f"{label}: witness part {part_index + 1} missing from {target} / {section}")
        witness_count += len(parts)

    for ident, row in by_id.items():
        string_value(row.get("sourceIssue"), f"{ident}.sourceIssue")
        string_value(row.get("sourceHeading"), f"{ident}.sourceHeading")
        ordinal = row.get("sourceOrdinal")
        require(type(ordinal) is int and ordinal >= 0,
                f"{ident}.sourceOrdinal: expected a nonnegative integer")
        source = string_value(row.get("sourceText"), f"{ident}.sourceText")
        digest = sha_value(row.get("sourceSha256"), f"{ident}.sourceSha256")
        require(hashlib.sha256(source.encode("utf-8")).hexdigest() == digest == frozen[ident],
                f"{ident}: source text/digest differs from frozen source digest")
        if "implementationFragments" in row:
            bindings = array_value(row["implementationFragments"], f"{ident}.implementationFragments")
            require(bool(bindings), f"{ident}: implementationFragments must not be empty")
            fragment_ids = set()
            if "implementationOwner" in row:
                primary = string_value(row["implementationOwner"], f"{ident}.implementationOwner")
                require(primary in deps, f"{ident}: invalid indexing implementationOwner {primary}")
            for fragment in bindings:
                object_value(fragment, f"{ident} fragment")
                fragment_id = string_value(fragment.get("id"), f"{ident} fragment.id")
                require(fragment_id not in fragment_ids, f"{ident}: duplicate fragment ID {fragment_id}")
                fragment_ids.add(fragment_id)
                string_value(fragment.get("scope"), f"{ident}/{fragment_id}.scope")
        else:
            bindings = [row]
        for index, binding in enumerate(bindings):
            label = ident if bindings[0] is row else f"{ident}/fragment[{index}]"
            owner = string_value(binding.get("implementationOwner"), f"{label}.implementationOwner")
            merge = string_value(binding.get("mergeVerificationOwner"), f"{label}.mergeVerificationOwner")
            require(owner in deps and merge in deps, f"{label}: invalid implementation/merge owner")
            require(merge == owner or owner in ancestors[merge], f"{label}: merge proof precedes implementation")
            require("integrationVerificationOwner" in binding,
                    f"{label}: integrationVerificationOwner must be explicit, null when not applicable")
            final = binding["integrationVerificationOwner"]
            require(final is None or (isinstance(final, str) and final in deps and
                    (final == owner or owner in ancestors[final])),
                    f"{label}: invalid integration proof owner or ancestry")
            string_value(binding.get("destinationSection"), f"{label}.destinationSection")
            witness(binding, label, owner, merge, final)
            binding_count += 1

    require(capacity is None or project is not None, "Developer capacity requires --project staffing")
    staffing = validate_staffing(project, deps, capacity) if project is not None else None
    return {
        "status": "PASS", "scope": "local structural validation only",
        "ticketCount": len(deps), "edgeCount": sum(len(parents) for parents in deps.values()),
        "prerequisites": canonical, "topologicalWaves": waves,
        "ancestors": {node: sorted(value) for node, value in sorted(ancestors.items())},
        "artifactCount": len(artifact_ids), "sourceRequirementCount": len(rows),
        "implementationBindingCount": binding_count, "witnessPartCount": witness_count,
        "bindingsWithoutWitnesses": missing_witnesses,
        "descriptionEvidence": {node: value[2] for node, value in sorted(documents.items())},
        "independentGroups": groups, "staffing": staffing,
        "limits": [
            "Input freezes and approvals are supplied evidence, not authenticated authorization.",
            "Literal witnesses prove text presence, not semantic completeness or unique behavioral ownership.",
            "Artifact inventory completeness and existing-code reference truth require source review.",
            "No tracker readback, rendered HTML audit, product verification or operational authorization is performed.",
            "Resource batches assume predecessor completion, not elapsed time or equal workloads."
        ]
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", required=True, type=Path)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--freeze", required=True, type=Path,
                        help="JSON object mapping frozen source IDs to lowercase SHA-256")
    parser.add_argument("--approved", required=True, type=Path,
                        help="JSON object mapping approved ticket IDs to direct prerequisites")
    parser.add_argument("--independent-groups", type=Path,
                        help="Additional JSON array of independent ticket-ID arrays")
    parser.add_argument("--project", type=Path, help="Renderer-compatible staffing manifest")
    parser.add_argument("--developers", type=int, help="Maximum active developers per derived batch")
    parser.add_argument("--require-witnesses", action="store_true")
    parser.add_argument("--report", type=Path, help="Optionally write this run's JSON report")
    args = parser.parse_args(argv)
    try:
        graph, ledger = load_json(args.graph), load_json(args.ledger)
        object_value(graph, "graph")
        project = load_json(args.project) if args.project else None
        descriptions = resolve_description_files(graph, args.graph.resolve().parent, project,
                                                 args.project.resolve().parent if args.project else None)
        report = validate_project(
            graph, ledger, load_json(args.freeze), load_json(args.approved),
            load_json(args.independent_groups) if args.independent_groups else None,
            descriptions, args.require_witnesses, project, args.developers)
        report["inputEvidence"] = {}
        for label in ("graph", "ledger", "freeze", "approved", "independent_groups", "project"):
            path = getattr(args, label)
            if path is not None:
                report["inputEvidence"][label] = {
                    "path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        code = 0
    except (ValidationError, OSError, UnicodeError, RecursionError) as exc:
        report, code = {"status": "FAIL", "error": str(exc)}, 1
    serialized = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.report:
        protected = [args.graph, args.ledger, args.freeze, args.approved,
                     args.independent_groups, args.project]
        if "descriptions" in locals():
            protected.extend(Path(path) for path in descriptions.values())
        if any(path is not None and path.resolve() == args.report.resolve() for path in protected):
            print("FAIL: --report must not overwrite an input or description", file=sys.stderr)
            return 1
        try:
            args.report.write_text(serialized, encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            print(f"FAIL: cannot write report {args.report}: {exc}", file=sys.stderr)
            return 1
    print(serialized, end="")
    return code


if __name__ == "__main__":
    sys.exit(main())
