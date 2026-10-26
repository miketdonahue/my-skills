"""Offline artifact export for an explicitly human-authorized rank-candidates run.

This program has no ATS client and never discovers or assesses candidates.
Input is the normalized, source-audited packet documented in references/prompt.md.
"""

import csv
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlparse

from validate_pack import load_and_validate

HEADERS = ("Candidate", "Ashby", "Location", "Stage", "Score", "Action")


def text(record: dict, key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string")
    return value


def boolean(record: dict, key: str) -> bool:
    value = record.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean")
    return value


def safe_cell(value: str) -> str:
    if value and (value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n"))):
        return "'" + value
    return value


def fit_score(ratings: list[int], unresolved: bool, pack: dict) -> Decimal:
    idx = {c["key"]: i for i, c in enumerate(pack["criteria"])}
    points = sum(Decimal(c["weight"]) * r / 4 for c, r in zip(pack["criteria"], ratings))
    score = max(Decimal(1), points / 10)
    for rule in pack["low_rating_caps"]:
        if any(ratings[idx[k]] <= rule["max_rating"] for k in rule["criteria"]):
            score = min(score, Decimal(rule["cap"]))
    ec = pack["excellence_cap"]
    if not (min(ratings) >= ec["exempt_all_min"] and any(ratings[idx[k]] == 4 for k in ec["exempt_any_at_4"])):
        score = min(score, Decimal(ec["cap"]))
    if unresolved:
        score = min(score, Decimal(pack["unresolved_cap"]))
    rounded = score.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return Decimal("8.9") if score < 9 and rounded >= 9 else rounded


def prepare_rows(packet: object, pack: dict) -> list[dict[str, str]]:
    if not isinstance(packet, dict) or not isinstance(packet.get("records"), list):
        raise ValueError("Input must contain a records array")
    idx = {c["key"]: i for i, c in enumerate(pack["criteria"])}
    n_criteria = len(pack["criteria"])
    ordered = []
    references: set[str] = set()
    applications: set[str] = set()
    for record in packet["records"]:
        if not isinstance(record, dict):
            raise ValueError("Every record must be an object")
        name = text(record, "candidate_name")
        reference = text(record, "reference_id")
        application = text(record, "application_id")
        link = text(record, "application_link")
        actual_stage = text(record, "actual_stage")
        location = text(record, "location")
        if not name.strip() or not reference.strip():
            raise ValueError("Candidate name and reference ID must not be empty")
        if reference in references or (application and application in applications):
            raise ValueError("Duplicate reference/application: reconcile before export")
        references.add(reference)
        if application:
            applications.add(application)
            parsed = urlparse(link)
            segments = parsed.path.split("/")
            if (parsed.scheme != "https" or parsed.netloc != "app.ashbyhq.com"
                    or parsed.username or parsed.password
                    or not any(segments[i] == "applications" and segments[i + 1] == application
                               for i in range(len(segments) - 1))):
                raise ValueError("Resolved application requires its actual HTTPS Ashby application link")
        elif link:
            raise ValueError("Unresolved references must not invent an application link")

        fraud = text(record, "fraud_state")
        status = text(record, "fraud_status")
        screening = text(record, "screening")
        completeness = text(record, "completeness")
        concerns = record.get("fraud_concerns")
        if fraud not in {"CLEAR", "REJECT", "UNKNOWN"}:
            raise ValueError("Unknown fraud state")
        if screening not in {"PASS", "FAIL", "UNKNOWN"}:
            raise ValueError("Unknown screening state")
        if completeness not in {"sufficient", "limited", "unavailable"}:
            raise ValueError("Unknown evidence completeness")
        if not isinstance(concerns, list) or any(not isinstance(c, str) or not c.strip() for c in concerns):
            raise ValueError("fraud_concerns must be an array of nonempty sourced strings")
        historical = boolean(record, "historical_fraud_disposition")
        unresolved = boolean(record, "unresolved_accomplishments")
        review_block = boolean(record, "review_block")
        ratings = record.get("ratings")
        rating_source = text(record, "rating_source")
        human_rating_reference = text(record, "human_rating_reference")

        reject = (fraud == "REJECT" or bool(concerns) or historical
                  or status.strip().casefold() == "needsmanualreview")
        score = None
        fraud_checks_complete = boolean(record, "fraud_checks_complete")
        evidence_unavailable = (
            fraud != "CLEAR" or not fraud_checks_complete or status != "PassedFraudCheck"
            or not application or completeness == "unavailable"
        )
        tiebreaker_vals = tuple(0 for _ in pack["tiebreakers"])
        stage = "Review required"
        group = 2
        if reject:
            stage, group = "Reject", 3
        elif not evidence_unavailable and screening != "FAIL":
            if ratings is None:
                raise ValueError(f"Fraud-clear readable records require {n_criteria} assigned ratings")
            if rating_source not in {"model", "human"}:
                raise ValueError("rating_source must be 'model' or 'human' when ratings are present")
            if rating_source == "human" and not human_rating_reference.strip():
                raise ValueError("Human-supplied ratings require a documented human rating reference")
            if (not isinstance(ratings, list) or len(ratings) != n_criteria
                    or any(type(r) is not int or not 0 <= r <= 4 for r in ratings)):
                raise ValueError(f"Ratings must be {n_criteria} integers in 0-4")
            score = fit_score(ratings, unresolved, pack)
            tiebreaker_vals = tuple(-ratings[idx[k]] for k in pack["tiebreakers"])
            eligible = (screening == "PASS" and completeness == "sufficient"
                        and not review_block and not unresolved and bool(actual_stage.strip())
                        and actual_stage not in {"Reject", "Review required"})
            stage = actual_stage if eligible else "Review required"
            group = 0 if eligible else 1
        # Reject/unknown/unavailable records deliberately ignore any stale ratings/score.
        if reject or evidence_unavailable or (score is not None and score < Decimal(pack["action_review_min"])):
            action = "Decline"
        else:
            action = "Review"
        row = dict(zip(HEADERS, (safe_cell(name), safe_cell(link), safe_cell(location),
                                safe_cell(stage), format(score, ".1f") if score is not None else "", action)))
        key = (group, -score if score is not None else Decimal(0), *tiebreaker_vals,
               application or reference)
        ordered.append((key, row))
    ordered.sort(key=lambda entry: entry[0])
    return [row for _, row in ordered]


def export(packet: object, directory: Path, pack: dict) -> Path:
    rows = prepare_rows(packet, pack)
    directory.mkdir(parents=True, exist_ok=True)
    stem = "rank-candidates-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = 1
    while True:
        path = directory / (stem + (f"_{suffix}" if suffix > 1 else "") + ".csv")
        try:
            handle = path.open("x", newline="", encoding="utf-8")
            break
        except FileExistsError:
            suffix += 1
    with handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != HEADERS or list(reader) != rows:
            raise RuntimeError("Written CSV failed read-back verification")
    return path


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python3 export.py <normalized-assessment-packet.json> <pack.json>")
    try:
        with Path(sys.argv[1]).expanduser().open(encoding="utf-8") as handle:
            packet = json.load(handle)
        pack = load_and_validate(Path(sys.argv[2]).expanduser().resolve())
        print(export(packet, Path.home() / "Downloads", pack))
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(f"Export failed: {error}") from error
