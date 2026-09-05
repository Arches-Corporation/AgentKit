# Onboarding a repo

Five minutes per repo. Works for any shape — JS monorepo, pure Rails, anything.

## Steps

**Use the repo's own package manager** — check `packageManager` in package.json or the lockfile (`package-lock.json` = npm, `pnpm-lock.yaml` = pnpm, `yarn.lock` = yarn). Mixing managers corrupts the lockfile or fails on peer deps.

**Registry auth first** (the kit is a private package on GitHub Packages). Commit a repo `.npmrc`:

```ini
@arches-corporation:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Each engineer, one-time: classic PAT with `read:packages` → `export NODE_AUTH_TOKEN=<pat>` in the shell profile. CI: `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` as `env` on every install step (403 → add the repo under the package's Manage Actions access).

```bash
cd <repo>

nvm use   # repo's .nvmrc; if none: echo "20" > .nvmrc && nvm use

# pure Rails / no package.json yet:
npm init -y
# then set "private": true and strip noise fields

# npm repo:
npm i -D @arches-corporation/agentkit
# pnpm workspace (-w = workspace root):
pnpm add -D -w @arches-corporation/agentkit
# yarn:
yarn add -D @arches-corporation/agentkit

npx agentkit init --tool claude
npx agentkit sync    # managed skills — set skills.vars first (docs/skills.md); exclude what doesn't apply
npx agentkit doctor
```

Standard semver: the dep saves as `^2.x`, releases publish automatically, rollback = pin an older version.

## Refreshing to the latest kit

```bash
npm update @arches-corporation/agentkit
npx agentkit init --tool claude   # only when the update added a guardrail (idempotent)
npx agentkit doctor
```

Logic fixes inside existing guardrails need the install only. Commit the bumped lockfile so the team picks it up on next install.

## Migrating from the pre-2.0 git install (`@arches/agentkit`)

```bash
npm rm @arches/agentkit
# add the .npmrc above, set NODE_AUTH_TOKEN
npm i -D @arches-corporation/agentkit
npx agentkit init --tool claude   # auto-removes hooks wired to the old package name
npx agentkit doctor
```

Optionally fix `$schema` in `agentkit.config.json` to `./node_modules/@arches-corporation/agentkit/agentkit.config.schema.json`.

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
.npmrc
.claude/settings.json
.agentkit/guardrails/        (local guardrails — committed source)
```

Gitignore `.agentkit/state/` only — never the whole `.agentkit/` dir, or local guardrails silently stop being shared.

## Gotchas

- **Every engineer runs `npm install` once after clone** — wiring points into `node_modules/`. `agentkit doctor` flags a missing install.
- **Global gitignores** can silently exclude source dirs (a `lib/` rule is common). `git check-ignore -v <path>` if something won't stage.
- Existing `.claude/settings.json` is **merged**, never overwritten — repo-local hooks survive. `init` is idempotent.
- Upgrade = `npm update @arches-corporation/agentkit`; rollback = pin an older version (`npm i -D @arches-corporation/agentkit@2.0.0`).
- Repo-only rules go in `.agentkit/guardrails/<name>.cjs` — see [local-guardrails.md](local-guardrails.md); re-run `init` to wire.

## Removing the kit

npm ≥7 runs no uninstall lifecycle scripts, so removal is a two-step:

```bash
npx agentkit uninstall        # removes synced assets, unwires .claude/settings.json + .cursor/hooks.json, deletes manifest + state
npm uninstall @arches-corporation/agentkit
```

What stays, deliberately:

- `agentkit.config.json` + `.agentkit/guardrails/` — repo-owned; keeping them means a later `npm i` + `init` + `sync` restores the exact same state. `npx agentkit uninstall --purge` removes these too (and with them any local prototype guardrails).
- The markdown rulebook (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`, specs) — repo documentation, not kit-managed. The kit enforces rules; it doesn't own them.

Non-kit hooks and settings in `.claude/settings.json` / `.cursor/hooks.json` are preserved — only entries pointing at the kit's runners are stripped.
