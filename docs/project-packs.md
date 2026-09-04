# Project packs

All guardrails — shared *and* project-specific — live in AgentKit. A project's own rules sit in a pack directory:

```
src/projects/<project>/<name>.cjs     e.g. src/projects/ekb/pr-body-contract.cjs
```

A consuming repo opts into its pack with one config line (or `agentkit init --project <name>`):

```json
{ "project": "ekb" }
```

The runner then resolves guardrail names: **built-in → project pack → repo-local**. Pack guardrails get the same contract, config (`agentkit.config.json` entries by name), markers, and logging as built-ins.

## Adding a pack for a new project

1. `mkdir src/projects/<project>` in AgentKit; add `<name>.cjs` files (contract in [local-guardrails.md](local-guardrails.md)).
2. Add tests: `test/projects-<project>.test.cjs` (see `test/projects-ekb.test.cjs`).
3. Release the kit; in the repo: refresh install + `npx agentkit init --tool claude --project <project>`.

One repo = one pack. Packs shadow nothing: a pack guardrail named like a built-in is ignored (doctor warns).

## Packs vs repo-local guardrails

| | Project pack (`src/projects/` in kit) | Repo-local (`.agentkit/guardrails/` in repo) |
|---|---|---|
| Home | AgentKit — versioned, tested, reviewed with the kit | consuming repo |
| Use for | a project's established rules | prototyping a new rule before moving it into the kit |
| Update flow | kit release → repo refreshes install | edit in place |

Lifecycle: **prototype local → stabilize into the project's pack → generalize into a built-in** when a second project wants it.

Packs carry **skills** too: `src/projects/<pack>/skills/<name>/SKILL.md`, distributed by `agentkit sync` alongside shared skills (see [skills.md](skills.md)). A pack skill overrides a shared skill of the same name.

## Current packs

| Pack | Guardrails | Skills |
|---|---|---|
| `ekb` | `dev-rules-reminder` (context-aware rule injection), `pr-body-contract` (PR template + EKB ticket), `precompact-capture` + `session-restore` (session continuity) | `route` (EKB tool map), `design-check` (design-system gate), `attach-pr-recording`, `e2e-testing` (installs to `apps/web/.claude/skills/`) |
