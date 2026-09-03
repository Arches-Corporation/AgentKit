# Onboarding a repo

Five minutes per repo. Works for any shape — JS monorepo, pure Rails, anything.

## Steps

```bash
cd <repo>

echo "20" > .nvmrc && nvm use

# pure Rails / no package.json yet:
npm init -y
# then set "private": true and strip noise fields

npm i -D "github:Arches-Corporation/AgentKit#v1.0.0"

npx agentkit init --tool claude
npx agentkit doctor
```

SSH-only GitHub auth (host alias like `github-arches`)? The `github:` shorthand uses HTTPS. Use the git+ssh form instead:

```bash
npm i -D "git+ssh://git@github-arches/Arches-Corporation/AgentKit.git#v1.0.0"
```

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
```

## Gotchas

- **Every engineer runs `npm install` once after clone** — wiring points into `node_modules/`. `agentkit doctor` flags a missing install.
- **Global gitignores** can silently exclude source dirs (a `lib/` rule is common). `git check-ignore -v <path>` if something won't stage.
- Existing `.claude/settings.json` is **merged**, never overwritten — repo-local hooks survive. `init` is idempotent.
- Upgrade = bump the tag: `npm i -D "github:Arches-Corporation/AgentKit#v1.1.0"`.
- Repo-only rules go in `.agentkit/guardrails/<name>.cjs` — see [local-guardrails.md](local-guardrails.md); re-run `init` to wire.
