# Proposal: lane-aware spec-first + spec scaffold — close the gap to full spec-driven

**Status:** draft
**Problem:** EKB's spec workflow is spec-*gated*, not spec-*driven*. `spec-first` only checks that `docs/specs/features/<TICKET>/` contains *some* `.md`. It does not know Light vs Full lane, does not require the right files for the change, and does not help create them. Which files land, and whether a Light change was correctly promoted to Full, is entirely on the engineer (honor-based).
**Goal:** make the lane mechanical — the guardrail enforces the *right shape* of spec for the change, and a scaffold command produces that shape in one step. Verification (spec↔code conformance) is noted as the remaining gap but kept out of core scope.

---

## Today (baseline)

- `spec-first` (kit built-in): on `git commit`, if staged files match `codePathPatterns` AND branch carries a ticket → require the spec dir to contain `≥1 .md`. Missing → block; escape = user `agentkit approve spec-approved`.
- Lanes (Light = `spec.md`; Full = `proposal.md`+`design.md`+`tasks.md`) + the Light→Full "promote" rule are **prose in AGENTS.md** — unenforced, unassisted.
- Only template is `_TEMPLATE-light.md`. No scaffold command. No Full-lane template.

Net: existence check, lane-blind.

---

## Part 1 — Lane-aware `spec-first`

Config-driven, backward compatible (no `lanes` key → current any-`.md` behavior).

New `spec-first.lanes` option:

```jsonc
"spec-first": {
  "enabled": true,
  "ticketPattern": "EKB-\\d+",
  "codePathPatterns": ["^(apps/web/src/|apps/api/(app|lib|db)/)"],
  "specDirTemplate": "docs/specs/features/{ticket}",
  "lanes": {
    // First matching lane wins (top-to-bottom). A lane matches when ANY staged
    // file hits one of its `triggers`. Files with no lane match fall to `default`.
    "full": {
      "triggers": [
        "apps/api/db/migrate/",           // migrations
        "apps/api/config/routes",         // new/changed endpoints
        "_controller\\.rb$",              // new controllers
        "apps/api/app/services/"          // new services
      ],
      "requires": ["proposal.md", "design.md", "tasks.md"]
    },
    "default": { "requires": ["spec.md"] }   // Light lane
  }
}
```

**Guardrail logic (extends `check()` in `src/core/guardrails/spec-first.cjs`):**
1. Existing gate unchanged: staged code + ticket in branch, marker not present.
2. Classify lane: for each configured lane in order, if any staged file matches a `triggers` regex → that lane. No match → `default`.
3. Read the spec dir; block if any file in the chosen lane's `requires` is absent. Block message lists the *specific* missing files + the lane that triggered (e.g. *"Full lane (migration staged: `…/db/migrate/2026…`) needs proposal.md, design.md — missing: design.md"*).
4. No `lanes` config → today's behavior (any `.md`).

**Escalation/promote becomes mechanical:** a change that adds a migration now *cannot* commit with only `spec.md` — the guardrail forces the Full trio. That's the "promote to Full" rule, enforced instead of remembered.

Validation: add `lanes` to `BUILT_IN_OPTION_SPECS['spec-first']` in `validate.cjs` (new type: object of `{triggers: regexArray, requires: stringArray}`) + schema entry. `doctor` fails on malformed lanes.

**Scope guard:** lanes gate spec *shape* (which files exist), never spec *content*. Still fail-open (`failClosed:false`) so a guardrail bug never bricks commits.

## Part 2 — `agentkit spec` scaffold command

New CLI subcommand (`bin/agentkit.cjs`), mirrors `approve`/`trust` shape.

```
agentkit spec <TICKET> [--full | --light]   scaffold the spec dir for a ticket
```

- Resolves dir from `specDirTemplate` (`docs/specs/features/<TICKET>/`).
- Lane: explicit flag, else **auto-detect** by running the same `lanes.triggers` against currently staged/changed files (reuse Part 1's classifier — single source of truth). Prints which lane it picked and why.
- Writes the lane's `requires` files from kit templates, each pre-filled: ticket id, date (CLI can use real `Date`), the What/Why/AC headings, and a Jira URL stub. **Idempotent** — never overwrites an existing file; reports created vs skipped.
- Templates ship in the kit: `templates/spec/light/spec.md`, `templates/spec/full/{proposal,design,tasks}.md`. Rendered with the existing `renderVars` (`{{ticket}}`, `{{specDirDisplay}}`, …).

Also expose as a **rendered slash command** (`/spec`) via the shared commands tier, so a Claude Code agent invokes the same scaffold in-session (command body just calls `npx agentkit spec`). Agents get the right skeleton without hand-creating files — matches the "auto, not manual" bar.

## Part 3 (noted, not in core scope) — spec↔code conformance

The remaining honor-based gap: nothing checks the code *matches* the spec. Options, in ascending cost:
- **a.** Promote `spec-check` from optional skill to a `/pr`-time step (already an artifact; make it non-skippable in the PR command).
- **b.** ACs as a checklist the PR body must mirror (extend `pr-body-contract` to require each AC line ticked).
- **c.** Full: ACs authored as executable e2e assertions (`spec.md` AC ↔ Playwright test id), CI gates on them. This is the only path to "spec as executable contract."

Recommend shipping Parts 1+2 first (mechanical lanes + scaffold — high value, low risk), then **a** as a cheap follow-up. **c** is a separate initiative.

---

## Deliverables (Parts 1+2)

| Area | Change |
|---|---|
| `src/core/guardrails/spec-first.cjs` | lane classifier + per-lane `requires` check; keep no-`lanes` fallback |
| `src/core/lib/validate.cjs` + schema | `lanes` option type; doctor validates |
| `bin/agentkit.cjs` | `spec <TICKET> [--full|--light]` subcommand + usage line |
| `templates/spec/{light,full}/*.md` | shipped, var-rendered stubs |
| `commands/spec/` (shared tier) | `/spec` slash command wrapping the CLI |
| `test/` | lane classification (migration→full, view-only→light, mixed→full), missing-file block messages, scaffold idempotency + auto-detect, backward-compat (no lanes = any .md) |
| docs | `docs/guardrails/spec-first.md` lanes section; onboarding note |

## EKB adoption (first consumer)

Set `spec-first.lanes` in EKB's `agentkit.config.json` (Full triggers = `db/migrate/`, `routes`, `_controller.rb`, `app/services/`). Replaces the prose promote rule in AGENTS.md §Spec rule with a pointer to the enforced lanes. Existing 35 spec dirs already conform (Full-lane ones carry the trio); no migration.

## Rollout

`feat(spec-first): lane-aware requirements + scaffold command` → minor kit release. Additive: repos without `lanes` see zero change. EKB opts in via config + `/spec` in the next sync.
