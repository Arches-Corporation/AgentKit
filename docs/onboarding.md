# Onboarding a repo

Five minutes per repo. Works for any shape — JS monorepo, pure Rails, anything.

## Steps

**Use the repo's own package manager** — check `packageManager` in package.json or the lockfile (`package-lock.json` = npm, `pnpm-lock.yaml` = pnpm, `yarn.lock` = yarn). Mixing managers corrupts the lockfile or fails on peer deps.

```bash
cd <repo>

nvm use   # repo's .nvmrc; if none: echo "20" > .nvmrc && nvm use

# pure Rails / no package.json yet:
npm init -y
# then set "private": true and strip noise fields

# npm repo:
npm i -D "github:Arches-Corporation/AgentKit"
# pnpm workspace (-w = workspace root):
pnpm add -D -w "github:Arches-Corporation/AgentKit"
# yarn:
yarn add -D "Arches-Corporation/AgentKit"

npx agentkit init --tool claude
npx agentkit sync    # managed skills — set skills.vars first (docs/skills.md); exclude what doesn't apply
npx agentkit doctor
```

The repo is public — no auth needed for installs (dev or CI). Unpinned = latest `main` at install time; the lockfile freezes the resolved commit for everyone else. Append `#vX.Y.Z` only to roll back to a known release.

## Refreshing to the latest kit

```bash
npm i -D "github:Arches-Corporation/AgentKit"   # repo's own manager — re-resolves main, bumps the lock
npx agentkit init --tool claude   # only when the update added a guardrail (idempotent)
npx agentkit doctor
```

Logic fixes inside existing guardrails need the install only. Commit the bumped lockfile so the team picks it up on next install.

## Migrating off the interim v2.0.x registry install (`@arches-corporation/agentkit`)

```bash
npm rm @arches-corporation/agentkit
npm i -D "github:Arches-Corporation/AgentKit"
npx agentkit init --tool claude   # auto-removes hooks wired to the interim package name
npx agentkit doctor
```

Also delete the GitHub Packages lines from `.npmrc`.

## Tune `agentkit.config.json`

Only `spec-first` usually needs attention:

| Repo style | Config |
|---|---|
| Ticket-keyed spec dirs (EKB: `docs/specs/features/EKB-1234/`) | `ticketPattern: "EKB-\\d+"`, `specDirTemplate: "docs/specs/features/{ticket}"` |
| Spec tool with slug dirs (openspec: `openspec/changes/<slug>/`) | `ticketPattern: "AIS2?-\\d+"`, `requireSpecDir: false` — ticket-in-branch enforced, spec layout left to the spec tool |
| No spec convention | `"spec-first": { "enabled": false }` |

Set `codePathPatterns` to what counts as product code: Rails `["^(app|lib|db)/"]`, monorepo per app dir, JS `["^src/"]`.

## Commit

```
.nvmrc
package.json + package-lock.json
agentkit.config.json
.claude/settings.json
.agentkit/guardrails/        (local guardrails — committed source)
```

Gitignore `.agentkit/state/` only — never the whole `.agentkit/` dir, or local guardrails silently stop being shared.

## Gotchas

- **Every engineer runs `npm install` once after clone** — wiring points into `node_modules/`. `agentkit doctor` flags a missing install.
- **Global gitignores** can silently exclude source dirs (a `lib/` rule is common). `git check-ignore -v <path>` if something won't stage.
- Existing `.claude/settings.json` is **merged**, never overwritten — repo-local hooks survive. `init` is idempotent.
- Upgrade = re-run the install command (re-resolves `main`); rollback = pin a tag (`npm i -D "github:Arches-Corporation/AgentKit#v2.1.0"`).
- Repo-only rules go in `.agentkit/guardrails/<name>.cjs` — see [local-guardrails.md](local-guardrails.md); re-run `init` to wire.

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
