# AgentKit

Shared agentic guardrails for Arches repos. One versioned package instead of copy-pasted hook scripts: vendor-neutral core checks, thin per-tool adapters (Claude Code today).

Extracted from EKB's battle-tested `.claude/hooks/` (spec `docs/specs/features/EKB-2256/` in EKB). Rationale: `EKB/docs/architecture/vendor-lock-in-position.md` — rules stay markdown-portable, enforcement becomes a shared package.

## Install (any repo)

```bash
nvm use 20
npm install github:Arches-Corporation/AgentKit
npx agentkit init --tool claude
npx agentkit doctor
```

`init` writes an `agentkit.config.json` skeleton and wires the guardrails into `.claude/settings.json` (idempotent — safe to re-run). Adjust the config to your repo (ticket pattern, code paths, spec dir), commit both files. Full per-repo recipe incl. pure-Rails repos and SSH installs: [docs/onboarding.md](docs/onboarding.md).

## Guardrails (the cookbook)

| Guardrail | Event | Blocks | Doc |
|---|---|---|---|
| `hard-stop` | PreToolUse (Bash) | `git commit`/`push` without a one-shot approval marker; any `--no-verify` | [docs/guardrails/hard-stop.md](docs/guardrails/hard-stop.md) |
| `spec-first` | PreToolUse (Bash) | committing product code with no ticket in the branch or no spec on disk | [docs/guardrails/spec-first.md](docs/guardrails/spec-first.md) |
| `privacy-block` | PreToolUse (Read/Edit/Write/Bash) | reading or touching secret-bearing files (`.env`, keys, credentials) | [docs/guardrails/privacy-block.md](docs/guardrails/privacy-block.md) |
| `secret-output` | UserPromptSubmit | prompts containing private keys, AWS keys, inline credentials | [docs/guardrails/secret-output.md](docs/guardrails/secret-output.md) |
| `scout-block` | PreToolUse (Read/Bash) | reading vendored/generated dirs (`node_modules`, `dist`, …) that flood context | [docs/guardrails/scout-block.md](docs/guardrails/scout-block.md) |

Every block message tells the agent the compliant next step. Escape hatches are deliberate and auditable: one-shot marker files (`hard-stop`, `spec-first`) or an `APPROVED:` prefix (`privacy-block`, `scout-block`), each logged to `.agentkit/state/guardrail-log.jsonl`.

## Configuration

`agentkit.config.json` at the consuming repo root. Full reference: [agentkit.config.example.json](agentkit.config.example.json) (shown with EKB's values). Per guardrail: `enabled` plus options documented in its cookbook page. Defaults are sane for a generic repo; `spec-first` is the one you almost always tune (`ticketPattern`, `codePathPatterns`, `specDirTemplate`).

## CLI

```
agentkit init --tool claude   wire guardrails + write config skeleton
agentkit doctor               check node version, config validity, wiring
agentkit list                 list guardrails and their events
agentkit hook <name>          run one guardrail (stdin JSON) — what settings.json calls
```

## Architecture

```
src/core/guardrails/*   pure checks: check(event, ctx) -> null | {block} | {inject}
src/core/lib/*          config, one-shot markers, text parsing, jsonl log
src/adapters/claude/*   stdin JSON -> normalized event -> exit 0/2 contract
bin/agentkit.cjs        CLI
```

Core never touches stdin or `process.exit` — that's the adapter's job. Adding a vendor = one new adapter; guardrail logic is untouched.

**Repo-specific rules** live in the consuming repo at `.agentkit/guardrails/<name>.cjs` — same contract, same runner, wired by `init`, shown as `(local)` in `list`. Used by a second repo? Promote it into the kit. See [docs/local-guardrails.md](docs/local-guardrails.md).

## Development

```bash
nvm use
npm test        # node --test, 41 cases
```
