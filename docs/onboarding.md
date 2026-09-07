# Onboarding a repo

Five minutes per repo. Works for any shape — JS monorepo, pure Rails, anything. Node ≥ 20 via any version manager (`nvm use`, asdf `.tool-versions`, …).

## 1. Install

**Use the repo's own package manager** — check `packageManager` in package.json or the lockfile (`package-lock.json` = npm, `pnpm-lock.yaml` = pnpm, `yarn.lock` = yarn). Mixing managers corrupts the lockfile or fails on peer deps.

```bash
cd <repo>

# pure Rails / no package.json yet:
npm init -y
# then set "private": true and strip noise fields

# npm repo:
npm i -D "github:Arches-Corporation/AgentKit#semver:^2.3.1"
# pnpm workspace (-w = workspace root):
pnpm add -D -w "github:Arches-Corporation/AgentKit#semver:^2.3.1"
# yarn:
yarn add -D "Arches-Corporation/AgentKit#semver:^2.3.1"
```

The repo is public — no auth needed for installs (dev or CI). `#semver:^X.Y.Z` behaves like any npm caret: newest matching tag at install, lockfile freezes the exact commit for the team, `npm update` pulls newer minors/patches on request, a new major never auto-installs. Use `#vX.Y.Z` for an exact pin, or no ref to float `main`.

## 2. Wire

```bash
npx agentkit init --tool claude
```

Writes a complete `agentkit.config.json` (every guardrail with its defaults, `$schema` pointer for editor autocomplete) and wires the guardrails into `.claude/settings.json`. Idempotent; existing settings are merged, never overwritten.

## 3. Tune `agentkit.config.json`

Hand-edit the generated file — only the deltas from defaults. Usually that's `spec-first`:

| Repo style | Config |
|---|---|
| Ticket-keyed spec dirs (EKB: `docs/specs/features/EKB-1234/`) | `ticketPattern: "EKB-\\d+"`, `specDirTemplate: "docs/specs/features/{ticket}"` |
| Spec tool with slug dirs (openspec: `openspec/changes/<slug>/`) | `ticketPattern: "AIS2?-\\d+"`, `requireSpecDir: false` — ticket-in-branch enforced, spec layout left to the spec tool |
| No spec convention | `"spec-first": { "enabled": false }` |

Set `codePathPatterns` to what counts as product code: Rails `["^(app|lib|db)/"]`, monorepo per app dir, JS `["^src/"]`. Disable what doesn't apply (e.g. `db-guard` in a pure frontend).

Managed skills/commands/agents are **on by default — keep them on**: supply `skills.vars` (see [skills.md](skills.md)) and `exclude` only what genuinely doesn't fit, with a reason (wrong stack, tool not used). Guardrails-only (`"skills": false` etc.) is the explicit opt-out for repos that keep their own playbook system.

## 4. Check the gitignore

**A blanket `.claude/` gitignore line silently keeps the wiring out of git** — it works on your machine and nobody else ever gets guardrails. Use granular entries:

```gitignore
.claude/*
!.claude/settings.json
.claude/settings.local.json
.agentkit/state/
```

Gitignore `.agentkit/state/` only — never the whole `.agentkit/` dir, or local guardrails silently stop being shared.

## 5. Sync and prove

```bash
npx agentkit sync      # installs managed assets AND auto-wires your rulebook (CLAUDE.md/AGENTS.md/GEMINI.md/.cursor); seeds CLAUDE.md if none exists
npx agentkit doctor    # strict: config keys/types/regexes, wiring, asset drift
npx agentkit verify    # behavioral proof — every enabled guardrail actually blocks its fixture
```

All green = done.

## 6. Commit + PR

```
.nvmrc                       (if the repo uses nvm)
package.json + lockfile
agentkit.config.json
.gitignore
.claude/settings.json
.agentkit/guardrails/        (local guardrails — committed source)
+ synced assets, if any (.agents/skills/, .claude/commands/, .claude/agents/, .agentkit/skills.manifest.json)
```

Open a PR to the repo's default working branch as usual.

## For the rest of the team

After the adoption PR merges, each engineer's entire setup is:

```bash
git pull
npm install     # (repo's own manager) — guardrails run from node_modules; this activates them
```

Nothing else. `npx agentkit doctor` any time to check the install.

## Rulebook auto-wiring (no manual step)

`sync` maintains a marker-fenced block (`<!-- agentkit:start -->…<!-- agentkit:end -->`) in your rulebook files listing the synced skills/agents and the guardrail note — so agents actually discover and use them. It regenerates each sync, never touches content outside the markers, and seeds a `CLAUDE.md` if the repo has none. You never hand-edit the block. Opt out with `"rulebooks": false`, or target specific files with `"rulebooks": ["CLAUDE.md"]`. Full detail: [rulebook-injection.md](rulebook-injection.md).

## What to expect once it's live

Guardrails intercept agent tool calls in Claude Code sessions. **Blocks are normal and self-explanatory** — every block message states the compliant next step (e.g. "get user approval, then `touch <marker>`"). Approval markers are one-shot files under the configured `stateDir`, consumed per use. Every decision is logged to `<stateDir>/guardrail-log.jsonl`; `npx agentkit stats` summarizes it. A false positive is worth a kit issue — the same fix then reaches every repo.

## Refreshing to the latest kit

```bash
npm update @arches/agentkit            # newest tag within the pinned caret range; bumps the lock
# or widen the range for a new major: npm i -D "github:Arches-Corporation/AgentKit#semver:^3.0.0"
npx agentkit init --tool claude        # only when the update added a guardrail (idempotent)
npx agentkit doctor
```

Logic fixes inside existing guardrails need the update only. Commit the bumped lockfile so the team picks it up on next install.

## Migrating off the interim v2.0.x registry install (`@arches-corporation/agentkit`)

```bash
npm rm @arches-corporation/agentkit
npm i -D "github:Arches-Corporation/AgentKit#semver:^2.3.1"
npx agentkit init --tool claude   # auto-removes hooks wired to the interim package name
npx agentkit doctor
```

Also delete the GitHub Packages lines from `.npmrc`.

## Gotchas

- **Global gitignores** can silently exclude source dirs (a `lib/` rule is common). `git check-ignore -v <path>` if something won't stage.
- Existing `.claude/settings.json` is **merged**, never overwritten — repo-local hooks survive. `init` is idempotent.
- Rollback = pin an exact tag: `npm i -D "github:Arches-Corporation/AgentKit#v2.1.0"`.
- Repo-only rules go in `.agentkit/guardrails/<name>.cjs` — see [local-guardrails.md](local-guardrails.md); re-run `init` to wire.
- Leftovers from an old adoption trial (untracked `.claude/settings.json`, stale synced skills)? Delete them and start from step 1 — `init` also auto-migrates known legacy wiring.

## Removing the kit

npm ≥7 runs no uninstall lifecycle scripts, so removal is a two-step:

```bash
npx agentkit uninstall        # removes synced assets, unwires .claude/settings.json + .cursor/hooks.json, deletes manifest + state
npm uninstall @arches/agentkit
```

What stays, deliberately:

- `agentkit.config.json` + `.agentkit/guardrails/` — repo-owned; keeping them means a later `npm i` + `init` + `sync` restores the exact same state. `npx agentkit uninstall --purge` removes these too (and with them any local prototype guardrails).
- The markdown rulebook (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`, specs) — repo documentation, not kit-managed. The kit enforces rules; it doesn't own them.

Non-kit hooks and settings in `.claude/settings.json` / `.cursor/hooks.json` are preserved — only entries pointing at the kit's runners are stripped.
