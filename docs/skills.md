# Skills (and other synced assets)

AgentKit distributes agent skills (markdown playbooks) the same way it distributes guardrails — shared tier, project-pack tier, repo-local tier — with one mechanical difference: guardrails execute from `node_modules`; skills must exist as real files where tools read them (`.agents/skills/`, `.claude/skills/`). So skills use a **sync model**: the kit is the source of truth, `agentkit sync` renders and installs them, a manifest detects drift.

## Asset kinds

The same engine syncs three kinds of markdown assets:

| Kind | Kit source | Canonical file | Default install target | Exclude config key |
|---|---|---|---|---|
| skill | `skills/<name>/` (shared) · `src/projects/<pack>/skills/<name>/` | `SKILL.md` | `.agents/skills/<name>/SKILL.md` | `skills.exclude` |
| command | `commands/<name>/` · `src/projects/<pack>/commands/<name>/` | `COMMAND.md` | `.claude/commands/<name>.md` | `commands.exclude` |
| agent | `agents/<name>/` · `src/projects/<pack>/agents/<name>/` | `AGENT.md` | `.claude/agents/<name>.md` | `agents.exclude` |

Commands and agents install under `.claude/` — they are Claude Code surfaces (slash commands, subagents); Cursor and Gemini have no equivalent today. A `meta.json` `installPath` can retarget if that changes. Everything below (tiers, template vars, manifest, drift) applies to all three kinds; `skills.vars` is the single variable pool.

## Tiers

| Tier | Where | Examples |
|---|---|---|
| Shared | kit `skills/<name>/SKILL.md` | skills: deep-review, spec-check, pr-review, security-audit, performance-optimization, db-migration, jira-ticket, sentry-investigator · agents: advisor |
| Project pack | kit `src/projects/<pack>/skills/<name>/SKILL.md` | ekb skills: route, design-check, attach-pr-recording, e2e-testing · ekb commands: pr, ekb-up, verify-all · ekb agents: conductor, fe-agent, be-agent |
| Repo-local | any skill dir in the repo not in the manifest | prototypes — sync never touches them |

Promotion path: local → pack → shared, same as guardrails. A pack asset with the same name overrides a shared one of the same kind.

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
agentkit sync           render + install all kinds; writes .agentkit/skills.manifest.json; removes managed assets dropped from the kit or excluded
agentkit sync --check   dry-run — exit 1 on any pending change or drift (CI-able)
agentkit list           per-kind sections show name -> target (tier)
agentkit doctor         drift enforcement (below)
```

The manifest is versioned: version 2 entries carry a `kind`; version-1 manifests (skills only) read compatibly.

## Drift rules (doctor)

| State | Result |
|---|---|
| Managed file edited locally (hash ≠ manifest) | **FAIL** — revert, or copy to a repo-local name and add the original to the kind's `exclude` |
| Managed file missing | **FAIL** — run sync |
| Kit updated (rendered ≠ manifest) | warn — run sync |
| Never synced (no manifest) | warn |

The rule in one line: **managed assets are edited in the kit, never in the repo.** Repo-specific tweaks = exclude + own the copy locally, or push the change into the pack/shared asset via a kit PR.

## Adding an asset

- Shared: `skills/<name>/SKILL.md`, `commands/<name>/COMMAND.md`, or `agents/<name>/AGENT.md` (+ `meta.json` if it needs vars/defaults or a custom `installPath`), tests in `test/skills.test.cjs`, docs row in README.
- Pack: same under `src/projects/<pack>/skills|commands|agents/`.
- Manifest and consuming repos pick it up on their next refresh + `sync`.
