# AgentKit

The shared agentic layer for Arches repos, one versioned package instead of copy-paste: **guardrails** (enforcement — vendor-neutral core, per-tool adapters) and **skills** (agent playbooks — templated, synced, drift-checked). Both come in three tiers: built-in/shared, project pack, repo-local.

Extracted from EKB's battle-tested `.claude/hooks/` (spec `docs/specs/features/EKB-2256/` in EKB). Rationale: `EKB/docs/architecture/vendor-lock-in-position.md` — rules stay markdown-portable, enforcement becomes a shared package.

## Install (any repo)

```bash
nvm use
npm i -D "github:Arches-Corporation/AgentKit"   # use the repo's own package manager; pnpm: add -D -w · yarn: add -D
npx agentkit init --tool claude
npx agentkit sync      # install managed skills/commands/agents (set skills.vars first — see docs/skills.md)
npx agentkit doctor
```

Installs track latest `main`. The lockfile freezes the resolved commit for the team — to pull the newest kit, re-run the install command (it re-resolves and bumps the lock). Tags (`#vX.Y.Z`) exist for rollback if a release misbehaves.

`init` writes an `agentkit.config.json` skeleton and wires the guardrails into `.claude/settings.json` (idempotent — safe to re-run). Adjust the config to your repo (ticket pattern, code paths, spec dir), commit both files. Full per-repo recipe incl. pure-Rails repos and SSH installs: [docs/onboarding.md](docs/onboarding.md).

## Guardrails (the cookbook)

| Guardrail | Event | Blocks | Doc |
|---|---|---|---|
| `hard-stop` | PreToolUse (Bash) | `git commit`/`push` without a one-shot approval marker; any `--no-verify` | [docs/guardrails/hard-stop.md](docs/guardrails/hard-stop.md) |
| `spec-first` | PreToolUse (Bash) | committing product code with no ticket in the branch or no spec on disk | [docs/guardrails/spec-first.md](docs/guardrails/spec-first.md) |
| `privacy-block` | PreToolUse (Read/Edit/Write/Bash) | reading or touching secret-bearing files (`.env`, keys, credentials) | [docs/guardrails/privacy-block.md](docs/guardrails/privacy-block.md) |
| `secret-output` | UserPromptSubmit | prompts containing private keys, AWS keys, inline credentials | [docs/guardrails/secret-output.md](docs/guardrails/secret-output.md) |
| `scout-block` | PreToolUse (Read/Bash) | reading vendored/generated dirs (`node_modules`, `dist`, …) that flood context | [docs/guardrails/scout-block.md](docs/guardrails/scout-block.md) |
| `force-push-guard` | PreToolUse (Bash) | `git push --force`/`-f` (and `--force-with-lease` unless allowed) without a one-shot marker | [docs/guardrails/force-push-guard.md](docs/guardrails/force-push-guard.md) |
| `db-guard` | PreToolUse (Bash) | destructive db ops — `rails db:drop/reset`, SQL `DROP`/`TRUNCATE`, `docker compose down -v` | [docs/guardrails/db-guard.md](docs/guardrails/db-guard.md) |
| `rules-reminder` | UserPromptSubmit | nothing — injects your configured rule summary once per session (silent until `text` is set) | [docs/guardrails/rules-reminder.md](docs/guardrails/rules-reminder.md) |

Every block message tells the agent the compliant next step. Escape hatches are deliberate and auditable: one-shot marker files (`hard-stop`, `spec-first`) or an `APPROVED:` prefix (`privacy-block`, `scout-block`), each logged to `.agentkit/state/guardrail-log.jsonl`.

## Skills, commands, agents (synced assets)

Templated agent playbooks distributed by `agentkit sync` in three kinds — **skills** (`.agents/skills/`), **slash commands** (`.claude/commands/`), **subagents** (`.claude/agents/`). Shared tier: skills deep-review, spec-check, pr-review, security-audit, performance-optimization, db-migration, jira-ticket, sentry-investigator + agent advisor. ekb pack: skills route, design-check, attach-pr-recording, e2e-testing · commands pr, ekb-up, verify-all · agents conductor, fe-agent, be-agent. Repo supplies `skills.vars` (single pool for all kinds); unresolved placeholders fail the sync; local edits to managed assets fail `doctor`; per-kind opt-out via `skills.exclude` / `commands.exclude` / `agents.exclude`. Full model: [docs/skills.md](docs/skills.md).

## Configuration

`agentkit.config.json` at the consuming repo root. Full reference: [agentkit.config.example.json](agentkit.config.example.json) (shown with EKB's values); JSON Schema for editor autocomplete: [agentkit.config.schema.json](agentkit.config.schema.json) (`init` writes the `$schema` pointer). Per guardrail: `enabled` plus options documented in its cookbook page. Defaults are sane for a generic repo; `spec-first` is the one you almost always tune (`ticketPattern`, `codePathPatterns`, `specDirTemplate`).

`agentkit doctor` validates strictly (`--check-remote` additionally compares the installed version against the latest kit tag — catches silently stale unpinned installs): unknown keys, wrong option types, and invalid regexes **fail**; so does wiring drift (an enabled guardrail missing from `.claude/settings.json`, a stale entry, or a wrong event/matcher).

## CLI

```
agentkit init --tool claude   wire guardrails + write config skeleton
agentkit sync [--check]       render + install managed assets (skills, commands, agents)
agentkit doctor               check node version, config validity, wiring, asset drift
agentkit verify               doctor + behavioral smoke of every enabled guardrail + sync state
agentkit stats [--json]       aggregate the guardrail log — events, top block reasons, recent blocks
agentkit new <kind> <name>    scaffold a kit asset (guardrail|skill|command|agent) — kit repo only
agentkit uninstall [--purge]  remove synced assets, unwire hooks, delete state (then npm uninstall)
agentkit list                 list guardrails and synced assets with their tiers
agentkit hook <name>          run one guardrail (stdin JSON) — what settings.json calls
```

`uninstall` is the clean-removal pre-step: npm runs no uninstall scripts, so run `npx agentkit uninstall` first, then `npm uninstall @arches/agentkit`. Default keeps `agentkit.config.json` + `.agentkit/guardrails/` (reinstall restores everything identically from them); `--purge` removes those too. The repo's markdown rulebook (`AGENTS.md` etc.) is repo-owned and never touched.

## Architecture

```
src/core/guardrails/*   pure checks: check(event, ctx) -> null | {block} | {inject}
src/projects/<name>/*   project packs — same contract, selected via config "project"
src/core/lib/*          config, one-shot markers, text parsing, jsonl log
src/adapters/claude/*   stdin JSON -> normalized event -> exit 0/2 contract (stable)
src/adapters/cursor/*   Cursor hooks protocol -> permission/continue replies (beta)
bin/agentkit.cjs        CLI — init --tool claude|cursor, doctor, list, hook
```

Adapter status & event mapping: [docs/adapters.md](docs/adapters.md). Gemini has no hook surface yet — rules reach it via the repo's `GEMINI.md` only.

Core never touches stdin or `process.exit` — that's the adapter's job. Adding a vendor = one new adapter; guardrail logic is untouched.

**Project-specific rules** also live in the kit, as packs: `src/projects/<project>/` (today: `ekb`). A repo opts in with `"project": "<name>"` in its config (`agentkit init --project <name>`). Resolution: built-in → pack → repo-local (`.agentkit/guardrails/`, the prototyping tier). Lifecycle: prototype local → stabilize into the pack → generalize into a built-in. See [docs/project-packs.md](docs/project-packs.md) and [docs/local-guardrails.md](docs/local-guardrails.md).

## Development

```bash
nvm use
npm test        # node --test
```

`main` is protected — changes land via PR (CI must pass). On merge, the release workflow versions automatically: manual bump in package.json → tagged as-is; otherwise auto-bump from the merge commit message (`feat:` → minor, breaking (`!`/`BREAKING`) → major, else patch) and tagged `vX.Y.Z`.
