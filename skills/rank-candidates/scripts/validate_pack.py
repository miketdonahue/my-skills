"""Validator for talent-ops role pack JSON files.

API:   load_and_validate(pack_path: Path) -> dict  (raises ValueError with named field)
CLI:   python3 validate_pack.py <pack.json>  ->  prints OK <role_slug> / exits 1
"""

import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _decimal_string(value: object, field: str, lo: str, hi: str) -> Decimal:
    """Parse and validate a one-decimal-place finite Decimal string in [lo, hi]."""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a decimal string")
    try:
        d = Decimal(value)
    except InvalidOperation:
        raise ValueError(f"{field} is not a valid decimal: {value!r}") from None
    if not d.is_finite():
        raise ValueError(f"{field} must be a finite decimal")
    if d.as_tuple().exponent != -1:
        raise ValueError(f"{field} must have exactly one decimal place (e.g. '7.0')")
    lo_d, hi_d = Decimal(lo), Decimal(hi)
    if not (lo_d <= d <= hi_d):
        raise ValueError(f"{field} must be in [{lo}, {hi}], got {value!r}")
    return d


def load_and_validate(pack_path: Path) -> dict:
    """Load and validate a role pack JSON file.

    Returns the parsed pack dict on success.
    Raises ValueError with a descriptive message naming the failing field.
    """
    # 1. JSON parse and schema_version
    try:
        raw = pack_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"Cannot read pack file: {exc}") from exc
    try:
        pack = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Pack is not valid JSON: {exc}") from exc
    if not isinstance(pack, dict):
        raise ValueError("Pack must be a JSON object")
    if type(pack.get("schema_version")) is not int or pack["schema_version"] != 1:
        raise ValueError("schema_version must be 1")

    # 2. role_slug
    slug = pack.get("role_slug")
    if not isinstance(slug, str) or not _SLUG_RE.fullmatch(slug):
        raise ValueError("role_slug must match ^[a-z0-9][a-z0-9-]*$")
    parent_name = pack_path.parent.name
    if slug != parent_name:
        raise ValueError(
            f"role_slug '{slug}' must equal parent directory name '{parent_name}'"
        )

    # 3. job
    job = pack.get("job")
    if not isinstance(job, dict):
        raise ValueError("job must be an object")
    for key in ("company", "title", "jd_url", "internal_job_id_hint", "stage"):
        v = job.get(key)
        if not isinstance(v, str) or not v.strip():
            raise ValueError(f"job.{key} must be a nonempty string")
    if not job["jd_url"].startswith("https://"):
        raise ValueError("job.jd_url must start with https://")

    # 4. criteria
    criteria = pack.get("criteria")
    if not isinstance(criteria, list) or not (3 <= len(criteria) <= 8):
        raise ValueError("criteria must be a list of 3-8 objects")
    criterion_keys: set[str] = set()
    for i, c in enumerate(criteria):
        if not isinstance(c, dict):
            raise ValueError(f"criteria[{i}] must be an object")
        ckey = c.get("key")
        if not isinstance(ckey, str) or not _KEY_RE.fullmatch(ckey):
            raise ValueError(f"criteria[{i}].key must match ^[a-z][a-z0-9_]*$")
        if ckey in criterion_keys:
            raise ValueError(f"criteria key '{ckey}' is not unique")
        criterion_keys.add(ckey)
        label = c.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"criteria[{i}].label must be a nonempty string")
        weight = c.get("weight")
        if type(weight) is not int or weight <= 0:
            raise ValueError(f"criteria[{i}].weight must be a positive integer")
    total = sum(c["weight"] for c in criteria)
    if total != 100:
        raise ValueError(f"criteria weights sum to {total}, expected 100")

    # 5. low_rating_caps
    lrc = pack.get("low_rating_caps")
    if not isinstance(lrc, list):
        raise ValueError("low_rating_caps must be a list")
    for i, rule in enumerate(lrc):
        if not isinstance(rule, dict):
            raise ValueError(f"low_rating_caps[{i}] must be an object")
        rc = rule.get("criteria")
        if (not isinstance(rc, list) or not rc
                or any(not isinstance(k, str) or k not in criterion_keys for k in rc)):
            raise ValueError(
                f"low_rating_caps[{i}].criteria must be a nonempty subset of criterion keys"
            )
        mr = rule.get("max_rating")
        if type(mr) is not int or not (0 <= mr <= 3):
            raise ValueError(f"low_rating_caps[{i}].max_rating must be an integer in 0-3")
        _decimal_string(rule.get("cap"), f"low_rating_caps[{i}].cap", "1.0", "9.9")

    # 6. excellence_cap
    ec = pack.get("excellence_cap")
    if not isinstance(ec, dict):
        raise ValueError("excellence_cap must be an object")
    _decimal_string(ec.get("cap"), "excellence_cap.cap", "1.0", "10.0")
    eam = ec.get("exempt_all_min")
    if type(eam) is not int or not (0 <= eam <= 4):
        raise ValueError("excellence_cap.exempt_all_min must be an integer in 0-4")
    eaa = ec.get("exempt_any_at_4")
    if (not isinstance(eaa, list) or not eaa
            or any(not isinstance(k, str) or k not in criterion_keys for k in eaa)):
        raise ValueError(
            "excellence_cap.exempt_any_at_4 must be a nonempty subset of criterion keys"
        )

    # 7. unresolved_cap and action_review_min
    _decimal_string(pack.get("unresolved_cap"), "unresolved_cap", "1.0", "10.0")
    _decimal_string(pack.get("action_review_min"), "action_review_min", "1.0", "10.0")

    # 8. tiebreakers
    tiebreakers = pack.get("tiebreakers")
    if not isinstance(tiebreakers, list):
        raise ValueError("tiebreakers must be a list")
    for k in tiebreakers:
        if not isinstance(k, str) or k not in criterion_keys:
            raise ValueError(f"tiebreaker '{k}' is not a criterion key")
    if len(set(tiebreakers)) != len(tiebreakers):
        raise ValueError("tiebreakers must be distinct")

    # 9. signoff
    so = pack.get("signoff")
    if not isinstance(so, dict):
        raise ValueError("signoff must be an object")
    for field in ("approved_by", "reference"):
        v = so.get(field)
        if not isinstance(v, str) or not v.strip():
            raise ValueError(f"signoff.{field} must be a nonempty string")
    date = so.get("date")
    if not isinstance(date, str) or not _DATE_RE.fullmatch(date):
        raise ValueError("signoff.date must match YYYY-MM-DD")

    # 10. sibling role-pack.md
    role_pack_path = pack_path.parent / "role-pack.md"
    if not role_pack_path.exists():
        raise ValueError("role-pack.md not found alongside pack.json")
    try:
        rp_text = role_pack_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"Cannot read role-pack.md: {exc}") from exc
    for heading in ("## Defaults", "## Rubric", "## Calibration"):
        if heading not in rp_text:
            raise ValueError(f"role-pack.md is missing required heading '{heading}'")
    for c in criteria:
        if c["label"] not in rp_text:
            raise ValueError(
                f"role-pack.md does not contain criterion label '{c['label']}'"
            )

    return pack


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 validate_pack.py <pack.json>")
    _pack_path = Path(sys.argv[1]).expanduser().resolve()
    try:
        _pack = load_and_validate(_pack_path)
    except ValueError as _error:
        print(_error, file=sys.stderr)
        sys.exit(1)
    print(f"OK {_pack['role_slug']}")
