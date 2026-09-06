# Skill: route

Front door for EKB's agent tooling. Given a task, **classify it and point to the right skill / agent / command chain** — so you don't have to remember the whole catalog. Tool-agnostic; run it when unsure how to approach a piece of work.

## When to run
- Start of a task when the right tool/flow isn't obvious.
- Before reaching for a generic approach — check whether a dedicated skill/agent already covers it.

## How to use
1. Read the task. Classify it against the table below (match the closest row; tasks can chain rows).
2. Follow the mapped chain. Respect `AGENTS.md` (spec rule, boundary lock, DoD, HARD STOP) throughout.
3. If the task is a genuine trade-off with several viable options (architecture choice, ambiguous scope), **stop and escalate to the `advisor` agent** instead of guessing.

## Routing table

| Task shape | Chain |
|---|---|
| **Any code change** (first) | Write the spec → `docs/specs/features/<TICKET>/` (Light vs Full lane per `AGENTS.md`). No code without a spec. |
| Single-app change (FE only / BE only) | Work in that app dir directly (`apps/web` or `apps/api`). Boundary lock: never touch the other app. |
| Cross-cutting (FE **and** BE) | `conductor` agent — splits FE/BE tracks, dispatches `fe-agent` + `be-agent`. |
| Verify a spec is complete / code matches it | `spec-check` skill (Mode A pre, Mode B post). |
| Independent code review before PR | `deep-review` skill — separate agent, reviewer ≠ author. Required by DoD. |
| Security-sensitive BE change (auth, data, raw SQL, files) | `security-audit` skill (+ CI Brakeman/bundler-audit gate). |
| Query/serializer/list/job change at scale | `performance-optimization` skill (N+1, eager-load, index). |
| DB migration | `db-migration` skill (reversibility + index + lock check). |
| Create / update a Jira ticket | `jira-ticket` skill (to the §Jira standard). |
| Open a PR | `/pr` command (auto-detects app(s), runs checks). Never hand-roll `gh pr create`. |
| Promote to production | `/pr` Type 3 (production release): cut `release-prod-<date>` from `master`, cherry-pick the delta, PR → `master`. |
| Attach an e2e recording to a PR | `attach-pr-recording` skill (upload to release asset + link on the PR). |
| Fix a Sentry / production error | `sentry-investigator` skill (Sentry MCP). |
| Bring the stack up/down locally | `/ekb-up`. Run all checks → `/verify-all`. |
| Hard trade-off / ambiguous approach | **`advisor` agent** — returns scored options + a recommendation. |

## Output
Name the recommended chain + a one-line rationale. If several rows apply, order them. If it's a trade-off with no clear winner, route to `advisor`.

## Note
Some targets land via open PRs (`security-audit` / `performance-optimization` → PR #47). Keep this table in sync with `.agents/skills/` + `.claude/agents/` as they merge.
