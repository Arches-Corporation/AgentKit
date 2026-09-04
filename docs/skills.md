# Skills

AgentKit distributes agent skills (markdown playbooks) the same way it distributes guardrails — shared tier, project-pack tier, repo-local tier — with one mechanical difference: guardrails execute from `node_modules`; skills must exist as real files where tools read them (`.agents/skills/`, `.claude/skills/`). So skills use a **sync model**: the kit is the source of truth, `agentkit sync` renders and installs them, a manifest detects drift.

## Tiers

| Tier | Where | Examples |
|---|---|---|
| Shared | kit `skills/<name>/SKILL.md` | deep-review, spec-check, pr-review, security-audit, performance-optimization, db-migration, jira-ticket, sentry-investigator |
| Project pack | kit `src/projects/<pack>/skills/<name>/SKILL.md` | ekb: route, design-check, attach-pr-recording, e2e-testing |
| Repo-local | any skill dir in the repo not in the manifest | prototypes — sync never touches them |

Promotion path: local → pack → shared, same as guardrails. A pack skill with the same name overrides a shared one.

## Template variables

Shared skills carry `{{var}}` placeholders where content is repo-specific (paths, stack names, org ids). Values come from:

1. `skills.vars` in `agentkit.config.json` (highest)
2. the skill's own `meta.json` defaults
3. derived vars: `ticketPattern`, `specDirTemplate` (from `guardrails.spec-first`), `specDirDisplay` (template with `<TICKET-ID>`)

An unresolved placeholder **fails the sync** with the var name — nothing renders half-templated. A repo that can't (or won't) supply a skill's vars excludes it: `"skills": { "exclude": ["sentry-investigator"] }`.

```json
"skills": {
  "vars": {
    "feDir": "apps/web",
    "beDir": "apps/api",
    "beStack": "Rails 7 · MySQL 8 · Elasticsearch/searchkick · Sidekiq",
    "sentryProjects": "`ekb-dev` / `ekb-staging` / `ekb-production`"
  },
  "exclude": []
}
```

## Install targets

Default `.agents/skills/<name>/SKILL.md`. A skill's `meta.json` can set `installPath` (e.g. e2e-testing installs to `apps/web/.claude/skills/e2e-testing/SKILL.md` for Claude Code native discovery).

## Commands

```
agentkit sync           render + install; writes .agentkit/skills.manifest.json; removes managed skills dropped from the kit or excluded
agentkit sync --check   dry-run — exit 1 on any pending change or drift (CI-able)
agentkit list           skills section shows name -> target (tier)
agentkit doctor         drift enforcement (below)
```

## Drift rules (doctor)

| State | Result |
|---|---|
| Managed file edited locally (hash ≠ manifest) | **FAIL** — revert, or copy to a repo-local skill name and add the original to `skills.exclude` |
| Managed file missing | **FAIL** — run sync |
| Kit updated (rendered ≠ manifest) | warn — run sync |
| Never synced (no manifest) | warn |

The rule in one line: **managed skills are edited in the kit, never in the repo.** Repo-specific tweaks = exclude + own the copy locally, or push the change into the pack/shared skill via a kit PR.

## Adding a skill

- Shared: `skills/<name>/SKILL.md` (+ `meta.json` if it needs vars/defaults or a custom `installPath`), tests in `test/skills.test.cjs`, docs row in README.
- Pack: same under `src/projects/<pack>/skills/`.
- Manifest and consuming repos pick it up on their next refresh + `sync`.
