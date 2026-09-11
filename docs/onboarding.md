# Onboarding a repo

Five minutes. Works for any shape — JS monorepo, pure Rails, anything. Node ≥ 20 (`nvm use`, asdf, …).

**Lead does steps 1–7 once per repo. Teammates then just `git pull && install` (see [For the team](#for-the-team)).**

## Quick start (one script)

The mechanical steps (§1, 2, 4, 5, 6) are one command — install → init → sync → doctor → verify, auto-detecting your package manager. **From a fresh repo** (no prior install needed — the script installs the kit):

```bash
curl -fsSL https://raw.githubusercontent.com/Arches-Corporation/AgentKit/main/scripts/onboard.sh | bash
```

(Already installed and want to re-run it? `bash node_modules/@arches/agentkit/scripts/onboard.sh`.)

It stops and hands you the only two human steps: **§3 tune the spec policy** in `agentkit.config.json`, then **commit + PR**. The rest of this doc explains each step (and what to put in §3).

---

## 1. Install

**Use the repo's own package manager** (check `packageManager` / the lockfile — mixing corrupts it). Public repo, no auth needed anywhere.

```bash
cd <repo>
# npm:
npm i  -D "github:Arches-Corporation/AgentKit#semver:^2.8.0"
# pnpm workspace (-w = workspace root):
pnpm add -D -w "github:Arches-Corporation/AgentKit#semver:^2.8.0"
# yarn:
yarn add -D "Arches-Corporation/AgentKit#semver:^2.8.0"
# pure Rails / no package.json: `npm init -y`, set "private": true, then the npm line above
```

`#semver:^X.Y.Z` = newest matching tag at install, frozen in the lockfile for the team; `npm update @arches/agentkit` pulls newer minors/patches on request; a new major never auto-installs.

## 2. Wire

```bash
npx agentkit init --tool claude          # add --project <RepoName> if a pack exists for your repo
```

Unsure whether a pack exists? Omit `--project` — it's safe to add later. Packs live in the kit under `src/projects/<RepoName>/`; ask, or add it once you know.

Writes a full `agentkit.config.json` (every guardrail + defaults, `$schema` pointer) and wires the guardrails into `.claude/settings.json`. Idempotent — existing settings merged, never overwritten. Also using Cursor? `npx agentkit init --tool cursor`.

## 3. Tune `agentkit.config.json`

Edit only the deltas. Two things matter most:

**`spec-first`** — what counts as product code, and the spec lanes:

| Repo style | Config |
|---|---|
| Ticket-keyed spec dirs (EKB) | `ticketPattern: "EKB-\\d+"`, `codePathPatterns: ["^(apps/web/src/\|apps/api/(app\|lib\|db)/)"]`, `specDirTemplate: "docs/specs/features/{ticket}"` |
| Slug-dir spec tool (openspec) | `ticketPattern: "…"`, `requireSpecDir: false` — ticket-in-branch only |
| No spec convention | `"spec-first": { "enabled": false }` |

Set `codePathPatterns` to your product code (Rails `["^(app|lib|db)/"]`, JS `["^src/"]`, monorepo per app dir).

**`lanes`** (enforced spec shape — migrations/endpoints need the Full trio, not a one-line spec):

```jsonc
"lanes": {
  "full":    { "triggers": ["db/migrate/", "config/routes", "_controller\\.rb$", "app/services/"],
               "requires": ["proposal.md", "design.md", "tasks.md"] },
  "default": { "requires": ["spec.md"] }
}
```

Omit `lanes` to keep the legacy any-`.md` gate. Add `"ticketUrlTemplate": "https://<jira>/browse/{ticket}"` so `/spec` fills the link. Scaffold specs with `/spec <TICKET>` (auto-detects the lane) — see [spec-first.md](guardrails/spec-first.md).

**No spec convention yet?** (greenfield repo — no `docs/specs`, no openspec, no ticket keys.) Establish the AgentKit-native one: keep `spec-first` on with `specDirTemplate: "docs/specs/features/{ticket}"`, `mkdir -p docs/specs/features`, and state the rule in your committed rulebook (`AGENTS.md`). `/spec <TICKET>` then scaffolds each ticket's dir. That's how a repo with nothing becomes spec-driven — same shape as EKB.

### Full spec-driven (the DoD) — enable `spec-conformance`

`spec-first`/`spec-in-commit` enforce that a spec *exists*. To also hold each PR to the spec's **Acceptance Criteria**, enable `spec-conformance` — pick the `specSource` that matches how your repo stores specs:

| Your spec model | Config |
|---|---|
| Ticket folders (`docs/specs/features/<TICKET>/`) | `"specSource": "ticket"` (default) + `ticketPattern`/`specDirTemplate` |
| Spec in the commit / flat files (`docs/features/2026-…​md`) | `"specSource": "changed"` + `"specPathPattern": "^docs/(features\|tasks\|enhancements)/"` |
| openspec (`openspec/changes/<slug>/`) | `"specSource": "changed"` + `"specPathPattern": "^openspec/changes/"` |

```json
"spec-conformance": { "enabled": true, "requireAcChecklist": true, "specSource": "changed", "specPathPattern": "^openspec/changes/" }
```

`requireAcChecklist` — every AC in the spec must be ticked in the PR body at `gh pr create`. Optional: `requireSpecCheck` (a `spec-check` review marker per PR) and Tier 3 `testCommand` + `{test: …}` AC refs run via `agentkit spec-verify` (executable ACs — see [spec-conformance.md](guardrails/spec-conformance.md)). **After adding it, re-run `agentkit init`** to wire the new guardrail.

Skills/commands/agents are **on by default — keep them on**: supply `skills.vars` ([skills.md](skills.md)), `exclude` only what genuinely doesn't fit. `"skills": false` is the opt-out for guardrails-only repos.

> **Skills with unset `{{vars}}` skip gracefully** — sync installs everything that resolves + the rulebook block, and warns (never aborts) on the rest. So a fresh repo works immediately; you refine later. On a **frontend** repo the backend skills (`performance-optimization`, `security-audit`, `sentry-investigator` — they need `beDir`/`sentryProjects`) skip until you either set those vars or `exclude` them; a **backend** repo is the mirror. `npx agentkit sync` and `doctor` name every skipped skill and its missing var. `exclude` the ones that don't fit your stack to silence the warnings.

## 4. Telemetry (org usage tracking) — on by default

`init` already seeds `usage-telemetry` pointed at the shared Google Sheet (`sinkMode: "endpoint"` + the org `sinkUrl`) — **nothing to wire.** Confirm after sync with `npx agentkit report --export` → `ok`.

Metadata only (session/skill/agent/command names + guardrail decisions — never prompt or code content), one POST per engineer per repo per day, fail-open. No token, no env, no per-engineer setup. To opt a repo out: `"usage-telemetry": { "enabled": false }`. Details + the Sheet setup: [telemetry-sink-apps-script.md](telemetry-sink-apps-script.md).

## 5. gitignore — auto-fixed by init

`init` already handled this: a blanket `.claude/` ignore (which silently keeps the wiring + `/spec` + subagents out of git) is rewritten to the granular form, and `.agentkit/state/` is added. Nothing to do — the result:

```gitignore
.claude/*
!.claude/settings.json
!.claude/commands/
!.claude/agents/
.claude/settings.local.json
.agentkit/state/
```

Never ignore the whole `.agentkit/` (that hides local guardrails) — only `state/`. If your repo ignores `CLAUDE.md` as personal, keep a committed **`AGENTS.md`** as the shared rulebook (auto-wired in step 6, read by every tool); init/sync won't un-ignore CLAUDE.md for you.

## 6. Sync and prove

```bash
npx agentkit sync      # installs managed assets + auto-wires the rulebook block (AGENTS.md/CLAUDE.md/GEMINI.md/.cursor); seeds one if none exists — works even for guardrails-only repos
npx agentkit doctor    # strict: config keys/types/regexes, wiring, asset drift, rulebook block
npx agentkit verify    # behavioral proof — every enabled guardrail blocks its fixture
```

All green = done. Test telemetry once: `npx agentkit report --export` → `export ok`.

## 7. Commit + PR

```
package.json + lockfile · .gitignore · agentkit.config.json · .claude/settings.json
AGENTS.md (or CLAUDE.md) with the wired block
+ synced assets: .agents/skills/ · .claude/commands/ · .claude/agents/ · .agentkit/skills.manifest.json
.agentkit/guardrails/  (only if you added repo-local guardrails — committed source)
```

PR to the repo's default working branch.

## Definition of Done — fully spec-driven

A repo is done when all of these hold (mirror of what EKB/RM/b2b run):

- [ ] **Latest kit**, `doctor` + `verify` green.
- [ ] **Spec enforced + tuned** — `spec-first` (or `spec-in-commit`) on, with *your* real `ticketPattern` / `codePathPatterns` (not the init defaults). Monorepo → per-app paths.
- [ ] **Lane-aware** — `spec-first.lanes` so migrations/endpoints require the Full trio (N/A for spec-in-commit / openspec).
- [ ] **Conformance enforced** — `spec-conformance.requireAcChecklist` with the matching `specSource` (or openspec's own validation).
- [ ] **`spec-check` available** (not excluded); **`/spec`** synced.
- [ ] **Telemetry** → the shared Sheet (`sinkMode: endpoint`); `agentkit report --export` returns `ok`.
- [ ] **Rulebook block committed** (a tracked `AGENTS.md`/`CLAUDE.md`), `/spec` + agents distribute (gitignore un-ignores `.claude/commands` + `.claude/agents`).
- [ ] **Committed + merged** to the default branch.

If a box is unchecked, the repo is *installed* but not *spec-driven*. Close the gap, don't ship half.

## For the team

After the adoption PR merges, every engineer's whole setup is:

```bash
git pull && npm install     # (repo's own manager) — guardrails run from node_modules; install activates them
```

Nothing else. `npx agentkit doctor` any time to check.

## Daily use

- **Blocks are normal** — each states the compliant next step.
- **Approvals are user-only.** When a guardrail blocks a commit/push, *you* run `npx agentkit approve <marker>` in your own terminal (or `! npx agentkit approve <marker>` in the Claude Code prompt — `!` runs as you). Agents cannot self-approve (`tamper-guard`). One-shot, consumed per use.
- **`/spec <TICKET>`** scaffolds the spec dir in the right lane before you write code.
- Every decision logged to `<stateDir>/guardrail-log.jsonl`; `npx agentkit stats` summarizes. False positive → file a kit issue; the fix reaches every repo. Scope & residual risk: [threat-model.md](threat-model.md).

## Refreshing

```bash
npm update @arches/agentkit         # newest tag in the caret range; bumps the lock
npx agentkit init --tool claude     # only when the update added a guardrail (idempotent) — doctor flags "enabled but not wired"
npx agentkit sync && npx agentkit doctor
```

Commit the bumped lockfile + any newly synced assets so the team picks them up.

## Gotchas

- **Global gitignores** can exclude source dirs (`lib/`, `package-lock.json`). `git check-ignore -v <path>` if something won't stage.
- **Repo ignores `CLAUDE.md`?** Use a committed `AGENTS.md` rulebook (step 5) — otherwise the block never distributes and agents don't discover the skills.
- Existing `.claude/settings.json` is **merged**, never overwritten. `init` is idempotent.
- Editor shows "property not allowed" on a new config key after a kit bump → stale JSON-schema cache; reload the window / clear schema cache. `agentkit doctor` is the source of truth.
- Repo-only rules → `.agentkit/guardrails/<name>.cjs` ([local-guardrails.md](local-guardrails.md)); run `npx agentkit trust` then `init`.
- Rollback = pin an exact tag: `npm i -D "github:Arches-Corporation/AgentKit#v2.7.1"`.

## Removing the kit

npm ≥7 runs no uninstall scripts — two steps:

```bash
npx agentkit uninstall          # removes synced assets, unwires settings + .cursor/hooks.json, deletes manifest + state
npm uninstall @arches/agentkit
```

`agentkit.config.json` + `.agentkit/guardrails/` stay (repo-owned — a later reinstall restores the exact state; `--purge` removes them too). The markdown rulebook stays — the kit enforces rules, doesn't own them. Non-kit hooks in settings are preserved.
