"""Smoke test for export.py: validates CSV invariants against a given role pack.

CLI: python3 smoke_export.py <pack.json>
Exit 0 on success; nonzero with failed assertion message on failure.
"""

import csv
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_SCRIPT_DIR = Path(__file__).parent
_EXPORT_PY = _SCRIPT_DIR / "export.py"


# ---------------------------------------------------------------------------
# Record constructors
# ---------------------------------------------------------------------------

def _record(name, ref_id, app_id, location, ratings, *, unresolved=False,
            stage="Application Review"):
    """Eligible, fraud-clear, fully scored record."""
    link = f"https://app.ashbyhq.com/applications/{app_id}" if app_id else ""
    return {
        "candidate_name": name,
        "reference_id": ref_id,
        "application_id": app_id or "",
        "application_link": link,
        "actual_stage": stage,
        "location": location,
        "fraud_state": "CLEAR",
        "fraud_status": "PassedFraudCheck",
        "screening": "PASS",
        "completeness": "sufficient",
        "fraud_concerns": [],
        "historical_fraud_disposition": False,
        "unresolved_accomplishments": unresolved,
        "review_block": False,
        "fraud_checks_complete": True,
        "ratings": ratings,
        "rating_source": "model",
        "human_rating_reference": "",
    }


def _reject_record(name, ref_id, location="Boston, MA"):
    """Fraud-REJECT record: blank Score, Decline, last in CSV."""
    return {
        "candidate_name": name,
        "reference_id": ref_id,
        "application_id": "",
        "application_link": "",
        "actual_stage": "",
        "location": location,
        "fraud_state": "REJECT",
        "fraud_status": "",
        "screening": "UNKNOWN",
        "completeness": "unavailable",
        "fraud_concerns": [],
        "historical_fraud_disposition": False,
        "unresolved_accomplishments": False,
        "review_block": False,
        "fraud_checks_complete": False,
        "ratings": None,
        "rating_source": "",
        "human_rating_reference": "",
    }


def _unknown_record(name, ref_id, location="Austin, TX"):
    """Fraud-UNKNOWN record: blank Score, Decline."""
    return {
        "candidate_name": name,
        "reference_id": ref_id,
        "application_id": "",
        "application_link": "",
        "actual_stage": "",
        "location": location,
        "fraud_state": "UNKNOWN",
        "fraud_status": "",
        "screening": "UNKNOWN",
        "completeness": "unavailable",
        "fraud_concerns": [],
        "historical_fraud_disposition": False,
        "unresolved_accomplishments": False,
        "review_block": False,
        "fraud_checks_complete": False,
        "ratings": None,
        "rating_source": "",
        "human_rating_reference": "",
    }


def _unresolved_ref_record(name, ref_id, location="Chicago, IL"):
    """Record with blank application_id/link: Ashby column is blank."""
    return {
        "candidate_name": name,
        "reference_id": ref_id,
        "application_id": "",
        "application_link": "",
        "actual_stage": "",
        "location": location,
        "fraud_state": "CLEAR",
        "fraud_status": "PassedFraudCheck",
        "screening": "PASS",
        "completeness": "sufficient",
        "fraud_concerns": [],
        "historical_fraud_disposition": False,
        "unresolved_accomplishments": False,
        "review_block": False,
        "fraud_checks_complete": True,
        "ratings": None,
        "rating_source": "",
        "human_rating_reference": "",
    }


# ---------------------------------------------------------------------------
# Subprocess runner and CSV reader
# ---------------------------------------------------------------------------

def _run_export(packet_dict, pack_path, home_dir):
    """Write packet JSON to home_dir, invoke export.py, return CompletedProcess."""
    packet_file = home_dir / "packet.json"
    packet_file.write_text(json.dumps(packet_dict), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(_EXPORT_PY), str(packet_file), str(pack_path)],
        capture_output=True,
        text=True,
        env={**os.environ, "HOME": str(home_dir)},
    )


def _read_csv(home_dir):
    """Return (fieldnames_tuple, rows_list) from the single CSV in home_dir/Downloads/."""
    downloads = home_dir / "Downloads"
    csvs = list(downloads.glob("rank-candidates-*.csv"))
    _assert(len(csvs) == 1, f"Expected 1 CSV in Downloads, found {len(csvs)}: {csvs}")
    with csvs[0].open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = tuple(reader.fieldnames or ())
    return fieldnames, rows


def _assert(condition, message):
    if not condition:
        raise AssertionError(message)


# ---------------------------------------------------------------------------
# Individual test suites
# ---------------------------------------------------------------------------

def _run_basic_invariants(pack, pack_path):
    """Headers, Location passthrough, formula escape, fraud rows, ordering."""
    n = len(pack["criteria"])
    high_ratings = [4] * n
    low_ratings = [3] * n

    packet = {
        "records": [
            _record("Alice High",       "REF-HIGH",       "app-001", "New York, NY", high_ratings),
            _record("Bob Low",          "REF-LOW",        "app-002", "Remote",       low_ratings),
            _record("Carol Blank",      "REF-BLANK",      "app-003", "",             low_ratings),
            _record("Dave Formula",     "REF-FORMULA",    "app-004", "=SUM(A1)",     low_ratings),
            _unknown_record("Eve Unknown",     "REF-UNKNOWN"),
            _unresolved_ref_record("Frank Unresolved", "REF-UNRESOLVED"),
            _reject_record("Grace Reject", "REF-REJECT"),
        ]
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        home = Path(tmpdir)
        result = _run_export(packet, pack_path, home)
        _assert(result.returncode == 0, f"export.py failed:\n{result.stderr}")
        fieldnames, rows = _read_csv(home)

    # 6 exact headers
    _assert(
        fieldnames == ("Candidate", "Ashby", "Location", "Stage", "Score", "Action"),
        f"Expected 6 exact headers, got: {fieldnames}",
    )

    by_name = {row["Candidate"]: row for row in rows}

    # Verbatim Location passthrough
    _assert(
        by_name["Alice High"]["Location"] == "New York, NY",
        f"Location 'New York, NY' must pass through verbatim, got: {by_name['Alice High']['Location']!r}",
    )

    # Blank-Location row
    _assert(
        by_name["Carol Blank"]["Location"] == "",
        f"Blank location must remain blank, got: {by_name['Carol Blank']['Location']!r}",
    )

    # Formula-leading Location gets apostrophe-escaped
    _assert(
        by_name["Dave Formula"]["Location"] == "'=SUM(A1)",
        f"Formula location must be apostrophe-escaped, got: {by_name['Dave Formula']['Location']!r}",
    )

    # Fraud REJECT row last with blank Score and Decline
    _assert(
        rows[-1]["Candidate"] == "Grace Reject",
        f"REJECT record must be last, got: {rows[-1]['Candidate']!r}",
    )
    _assert(rows[-1]["Score"] == "", "REJECT row must have blank Score")
    _assert(rows[-1]["Action"] == "Decline", "REJECT row Action must be Decline")

    # Fraud UNKNOWN: blank Score, Decline
    _assert(
        by_name["Eve Unknown"]["Score"] == "",
        "UNKNOWN row must have blank Score",
    )
    _assert(
        by_name["Eve Unknown"]["Action"] == "Decline",
        "UNKNOWN row Action must be Decline",
    )

    # Unresolved reference has blank Ashby column
    _assert(
        by_name["Frank Unresolved"]["Ashby"] == "",
        f"Unresolved reference must have blank Ashby, got: {by_name['Frank Unresolved']['Ashby']!r}",
    )

    # Scored ordering descends (non-increasing)
    scored = [row for row in rows if row["Score"]]
    for i in range(len(scored) - 1):
        s1 = float(scored[i]["Score"])
        s2 = float(scored[i + 1]["Score"])
        _assert(
            s1 >= s2,
            f"Score ordering broken at position {i}: {s1} followed by {s2}",
        )


def _run_missing_location(pack, pack_path):
    """A record without 'location' must fail before any CSV is created."""
    n = len(pack["criteria"])
    bad_record = {
        "candidate_name": "No Location",
        "reference_id": "REF-NOLOC",
        "application_id": "app-noloc",
        "application_link": "https://app.ashbyhq.com/applications/app-noloc",
        "actual_stage": "Application Review",
        # "location" key intentionally absent
        "fraud_state": "CLEAR",
        "fraud_status": "PassedFraudCheck",
        "screening": "PASS",
        "completeness": "sufficient",
        "fraud_concerns": [],
        "historical_fraud_disposition": False,
        "unresolved_accomplishments": False,
        "review_block": False,
        "fraud_checks_complete": True,
        "ratings": [4] * n,
        "rating_source": "model",
        "human_rating_reference": "",
    }
    packet = {"records": [bad_record]}

    with tempfile.TemporaryDirectory() as tmpdir:
        home = Path(tmpdir)
        result = _run_export(packet, pack_path, home)
        _assert(
            result.returncode != 0,
            "Export must fail when location field is missing",
        )
        _assert(
            "location must be a string" in result.stderr,
            f"Error must mention 'location must be a string', got:\n{result.stderr!r}",
        )
        downloads = home / "Downloads"
        csv_files = list(downloads.glob("rank-candidates-*.csv")) if downloads.exists() else []
        _assert(
            not csv_files,
            f"No CSV must exist after location error, found: {csv_files}",
        )


def _run_empty_cohort(pack, pack_path):
    """Empty records array must produce a CSV with the header row only."""
    packet = {"records": []}

    with tempfile.TemporaryDirectory() as tmpdir:
        home = Path(tmpdir)
        result = _run_export(packet, pack_path, home)
        _assert(
            result.returncode == 0,
            f"Empty cohort export must succeed:\n{result.stderr}",
        )
        fieldnames, rows = _read_csv(home)

    _assert(
        fieldnames == ("Candidate", "Ashby", "Location", "Stage", "Score", "Action"),
        f"Empty-cohort CSV must have correct headers, got: {fieldnames}",
    )
    _assert(rows == [], "Empty cohort must yield header only (no data rows)")


def _run_connectors_vectors(pack, pack_path):
    """Connectors-mcp reference scoring vectors and boundary routing."""
    # (ref_id, ratings, unresolved, expected_score, expected_action)
    vectors = [
        ("V-ALL1",  [1, 1, 1, 1, 1], False, "2.5", "Decline"),
        ("V-ALL3",  [3, 3, 3, 3, 3], False, "7.5", "Review"),
        ("V-9P1",   [4, 3, 4, 3, 4], False, "9.1", "Review"),
        ("V-5P9",   [1, 4, 4, 4, 4], False, "5.9", "Decline"),
        ("V-6P9",   [4, 4, 1, 4, 4], False, "6.9", "Decline"),
        ("V-8P0",   [2, 4, 4, 4, 4], False, "8.0", "Review"),
        ("V-8P9",   [4, 4, 4, 3, 3], True,  "8.9", "Review"),
    ]

    records = []
    for i, (ref, ratings, unresolved, _score, _action) in enumerate(vectors):
        records.append(_record(
            f"Candidate {ref}", ref, f"app-v{i+1:02d}",
            "San Francisco, CA", ratings, unresolved=unresolved,
        ))
    packet = {"records": records}

    with tempfile.TemporaryDirectory() as tmpdir:
        home = Path(tmpdir)
        result = _run_export(packet, pack_path, home)
        _assert(
            result.returncode == 0,
            f"Connectors vector export failed:\n{result.stderr}",
        )
        _fieldnames, rows = _read_csv(home)

    by_ref = {}
    for row in rows:
        for ref, *_ in vectors:
            if row["Candidate"] == f"Candidate {ref}":
                by_ref[ref] = row
                break

    for ref, ratings, unresolved, expected_score, expected_action in vectors:
        row = by_ref.get(ref)
        _assert(row is not None, f"Row for {ref} not found in CSV")
        _assert(
            row["Score"] == expected_score,
            f"{ref} ratings={ratings} unresolved={unresolved}: "
            f"expected Score={expected_score!r}, got {row['Score']!r}",
        )
        _assert(
            row["Action"] == expected_action,
            f"{ref} ratings={ratings}: expected Action={expected_action!r}, got {row['Action']!r}",
        )

    # Boundary routing: explicit labels
    _assert(
        by_ref["V-ALL3"]["Action"] == "Review",
        "Score 7.5 must route to Review (>= action_review_min 7.0)",
    )
    _assert(
        by_ref["V-6P9"]["Action"] == "Decline",
        "Score 6.9 must route to Decline (< action_review_min 7.0)",
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 smoke_export.py <pack.json>")

    pack_path = Path(sys.argv[1]).expanduser().resolve()
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    role_slug = pack.get("role_slug", "")

    tests = [
        ("basic invariants",   lambda: _run_basic_invariants(pack, pack_path)),
        ("missing location",   lambda: _run_missing_location(pack, pack_path)),
        ("empty cohort",       lambda: _run_empty_cohort(pack, pack_path)),
    ]
    if role_slug == "connectors-mcp":
        tests.append((
            "connectors-mcp reference vectors",
            lambda: _run_connectors_vectors(pack, pack_path),
        ))

    for name, test in tests:
        try:
            test()
        except AssertionError as exc:
            print(f"FAIL [{name}]: {exc}", file=sys.stderr)
            sys.exit(1)

    print(f"OK smoke {role_slug}")


if __name__ == "__main__":
    main()
