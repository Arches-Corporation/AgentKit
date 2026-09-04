# Skill: spec-check

Verify a feature has a valid spec before coding starts, and that completed code matches the spec AC.

## Mode A — Pre-implementation gate

Run before writing any code for a ticket.

### Steps
1. Check `{{specDirDisplay}}/proposal.md` exists. If missing: stop, write it first.
2. Check `{{specDirDisplay}}/design.md` exists. If missing: stop, write it first.
3. Check `{{specDirDisplay}}/tasks.md` exists. If missing: stop, write it first.
4. Confirm all three are non-empty and contain acceptance criteria.
5. Report: `PASS — spec complete, proceed to implementation` or list what is missing.

## Mode B — Post-implementation check

Run after implementation, before `deep-review`.

### Steps
1. Read `{{specDirDisplay}}/proposal.md` acceptance criteria.
2. Read the diff (changed files).
3. For each AC item: mark `[covered]` or `[missing]`.
4. Flag any code behavior NOT described in the spec (scope creep).
5. Report: `PASS — all AC covered, no scope creep` or list gaps.

## Output format
```
Mode A:
  PASS — spec complete for <TICKET-ID>. Proceed.
  -- or --
  FAIL — missing: design.md. Write it before coding.

Mode B:
  AC 1: POST /v1/internal_api/company_lookups returns {codes, articles} [covered]
  AC 2: Rejects bad token with 401 [covered]
  AC 3: Rejects over-cap with 400 [covered]
  AC 4: execute1() verified in test channel [missing — not yet done]
  Scope creep: none
```
