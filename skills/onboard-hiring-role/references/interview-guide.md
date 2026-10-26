# Interview guide: onboarding a new role pack

Use this guide during a `/onboard-hiring-role` session. Work through each topic with the hiring team in order, recording verbatim answers before moving on.

---

## Question list

### Topic 1: Role basics

1. What is the exact job title as it will appear in Ashby?
2. What is the canonical JD URL (the public Ashby posting)?
3. What is the internal Ashby job ID (UUID from the job settings page)?
4. What is the ATS pipeline stage name where this skill will run (e.g. `Application Review`)?

### Topic 2: Entry-required vs learnable capabilities

5. Which capabilities are strict entry requirements -- things a candidate absolutely must have demonstrated, with no learning curve acceptable?
6. Which capabilities are learnable on the job -- important but not blockers if the candidate is otherwise strong?

(These answers inform the rubric anchors and the `## Defaults` section of `role-pack.md`, not the validation checks. Record them verbatim.)

### Topic 3: Scoring criteria

Define 3 to 8 criteria. For each criterion:

7. What is a short slug (lowercase letters/numbers/underscores, e.g. `integration`)?
8. What is the full human-readable label (e.g. `Integration/tool-platform delivery`)?
9. What is an example of a rating-3 (strong but not exceptional) performance? Be concrete: a shipped artifact, a scope of ownership, a measurable impact.
10. What weight (positive integer) should this criterion carry? All weights must sum to exactly 100.

Repeat for each criterion.

### Topic 4: Low-rating ceilings

11. Are there any criteria so foundational that a weak rating on them should cap the overall score regardless of performance elsewhere? If yes: which criteria, what is the maximum rating that triggers the cap (0-3 inclusive), and what is the cap value (one decimal, e.g. `5.9`)?

(If none, `low_rating_caps` will be `[]`.)

### Topic 5: Excellence cap

12. Should there be a score ceiling for candidates who are strong but not exceptional across all criteria? If yes: what is the cap value (e.g. `8.0`)? Exemption requires both a minimum rating on all criteria (`exempt_all_min`, 0-4) and a rating of 4 on at least one named criterion (`exempt_any_at_4`). Ask for both conditions. When the cap is `"10.0"`, these exemption fields still need valid values but cannot lower the score.

(If no ceiling is desired, `excellence_cap.cap` defaults to `"10.0"`.)

### Topic 6: Review/Decline boundary

13. At what score should a candidate move to `Review` rather than `Decline`? (Must be a decimal string, e.g. `"7.0"`.)

Ask what ceiling applies to unresolved accomplishments (`unresolved_cap`) and which criteria, in priority order, should break equal-score ties (`tiebreakers`, or `[]` for none). Record explicit answers; do not invent these policies.

### Topic 7: Calibration profiles

Provide 2 to 3 named calibration examples -- real or hypothetical candidates -- to anchor the rubric. For each:

14. Name (can be anonymized as "Profile A", etc.).
15. Which criteria are this person's strongest and which are weakest?
16. What score range would you expect, and should they be `Review` or `Decline`?

### Topic 8: Designated approver

17. Who is the accountable approver for this role pack? (Full name and GitHub handle.) This person will be named in `signoff.approved_by` and will be notified that they are accountable for the rubric.

---

## Templates

### pack.json template

```json
{
  "schema_version": 1,
  "role_slug": "<role-slug>",
  "version": "<role-slug>-v1-pack",
  "job": {
    "company": "<COMPANY>",
    "title": "<Job title>",
    "jd_url": "https://<jd-url>",
    "internal_job_id_hint": "<uuid>",
    "stage": "<ATS stage name>"
  },
  "criteria": [
    {"key": "<slug>", "label": "<Full label>", "weight": <int>},
    {"key": "<slug>", "label": "<Full label>", "weight": <int>},
    {"key": "<slug>", "label": "<Full label>", "weight": <int>}
  ],
  "low_rating_caps": [
    {"criteria": ["<key>"], "max_rating": <0-3>, "cap": "<decimal>"}
  ],
  "excellence_cap": {"cap": "<decimal>", "exempt_all_min": <0-4>, "exempt_any_at_4": ["<key>"]},
  "unresolved_cap": "<decimal>",
  "action_review_min": "<decimal>",
  "tiebreakers": ["<key>", "<key>"],
  "signoff": {
    "approved_by": "<Full Name (handle)>",
    "date": "<YYYY-MM-DD>",
    "reference": "<Brief description of approval context>"
  }
}
```

Notes:
- `low_rating_caps` may be `[]` if no ceilings were specified.
- `excellence_cap.cap` should be `"10.0"` if no excellence cap was specified.
- `tiebreakers` may be `[]`.
- Obtain `unresolved_cap` and ordered `tiebreakers` explicitly from the team.
- Fill `signoff` only after the designated approver has acknowledged their accountability in the session (workflow step 5).

### role-pack.md template

```markdown
# Role pack: <role-slug>

## Defaults

- Company: <COMPANY>
- Job title: <Full title>
- JD URL: <https://...>
- Internal job ID hint: <uuid>
- Stage: <ATS stage name>

<Two paragraphs: one describing how to fetch and pin the JD before scoring, and one listing default learnable specializations and entry capabilities the team identified in Topic 2.>

## Rubric

| Criterion | Weight | Rating-3 evidence |
|-----------|--------|-------------------|
| <Label> | <weight>% | <verbatim rating-3 anchor from Topic 3> |
| <Label> | <weight>% | <verbatim rating-3 anchor from Topic 3> |

<One paragraph noting any cross-criterion context the team provided, e.g. what qualifies as direct experience.>

## Arithmetic reference cases

<One paragraph with reference ratings from the team's calibration profiles (Topic 7): for each profile, list ratings in criterion order and the expected score. Include at least the boundary case (score just above and just below action_review_min).>

## Calibration

<Two to three bullet points, one per profile from Topic 7, naming the profile, key strong/weak criteria, and expected Review/Decline outcome.>

These examples do not substitute for independent rubric application; they are anchors to prevent drift.
```
