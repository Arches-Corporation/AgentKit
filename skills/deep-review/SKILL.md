# Skill: deep-review

Independent code review. Run in a **separate agent session** — never the agent that wrote the code being reviewed.

## When to run
Before opening any PR. Required by `{{rulebook}}` Definition of Done.

## Input
- The diff or list of changed files.
- The spec: Full lane → `proposal.md` + `design.md`; Light lane → `spec.md`.
- The ticket AC.

## Calibrate depth to the diff (do this first)
- **Small diff (≤ ~15 lines, single file — the Light lane):** review only the dimensions that apply — usually **correctness + spec-alignment + one adversarial edge check** (the way an input could break the change). Do **not** enumerate N/A dimensions; skip them silently. Keep reviewer ≠ author.
- **Large / feature / cross-repo / migration / auth (Full lane):** run all applicable dimensions below.
- Review only what changed + what it directly touches. Don't re-audit the whole file for a 3-line diff.

## Steps

1. Read `{{rulebook}}` (boundary rules, security, DoD) — skim for Light.
2. Read the spec for the ticket under review.
3. Review the diff against the applicable dimensions. For each finding: `path:line severity: problem. fix.`
4. Independent verifier pass: for each finding, re-check — confirm real vs false positive. Mark `[confirmed]` or `[rejected]`.
5. Return only confirmed findings, grouped by severity. Clean diff → say so in one line; don't pad with N/A dimensions.

## 14 Dimensions

| # | Dimension | What to check |
|---|---|---|
| 1 | **Correctness** | Code does what the spec says; no off-by-one, wrong condition, or missing branch |
| 2 | **Security** | Injection, auth bypass, secret exposure, OWASP top 10; no credentials in code/logs |
| 3 | **Authorization** | Pundit policy present and correct; no cross-tenant data leak; internal endpoints use token auth |
| 4 | **API contract** | {{apiContractRow}} |
| 5 | **Error handling** | Failure paths return correct HTTP codes; no silent exception swallows; graceful degradation where required |
| 6 | **Edge cases** | Empty arrays, nulls, zero, over-cap inputs, missing optional params handled |
| 7 | **Test coverage** | Happy path + failure paths tested; bug fix ships regression test (fail before fix, pass after) |
| 8 | **Performance** | N+1 queries; missing indexes on FK or query columns; unbounded `WHERE IN` without cap |
| 9 | **Data integrity** | DB constraints match model validations; migrations reversible; no data loss on rollback |
| 10 | **Duplication** | No copy-paste of existing logic; reuses existing models, helpers, concerns |
| 11 | **Naming / readability** | Identifiers self-document; no misleading names; no unexplained magic numbers |
| 12 | **Observability** | Errors logged where useful; no PII or secrets in logs |
| 13 | **Spec alignment** | Diff matches spec AC exactly — no scope creep, no undocumented behavior, no skipped AC |
| 14 | **Design-system conformance** *(FE visual diffs only — skip silently otherwise)* | {{designSystemRow}} |

## Severity labels
- `critical` — blocks merge (security, data loss, broken AC)
- `major` — should fix before merge (correctness, missing tests)
- `minor` — fix or accept with reason (readability, minor duplication)

## Output format
```
path/to/file.rb:42 critical: SQL injection via unsanitized param. Use parameterized query.
path/to/file.rb:67 major: Missing Pundit policy check on #update. Add authorize @record.
path/to/spec.rb:12 minor: Test name does not describe the failure case. Rename to "returns 401 when token missing".
```

## Anti-self-approval rule
If you are the agent that wrote the code under review, stop. Hand off to a different agent or a new session with no memory of the implementation.
