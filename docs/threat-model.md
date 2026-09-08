# Threat model

What AgentKit's guardrails do and do not defend against. Written after an
internal pentest of v2.4.1 (2026-09); the v2.5.0 hardening implements the fixes
referenced here.

## Two tiers of protection

### Tier A — drift protection (guardrails)

Guardrails are **seatbelts for a cooperating agent**: they stop an AI coding
agent from *drifting* into a forbidden action (committing without approval,
touching secrets, force-pushing) and re-route it to the compliant step. They run
as tool-call hooks inside the agent harness.

They are **not a sandbox**. An agent with arbitrary shell access can, by
construction, eventually route around any hook-based control (spawn git from
another interpreter, encode commands, abuse tools the hooks don't cover). The
real security boundary against a *malicious* agent is the harness's permission
system and the human review gate (PRs, protected branches) — not AgentKit.

What we still harden, because friction + auditability matter:

| Attack (pentest finding) | v2.5.0 response |
|---|---|
| Block message leaked the marker path; agent could `touch` it (1) | Message no longer reveals the mechanism; approval is `agentkit approve`, user-only |
| Agent edits `agentkit.config.json` → `enabled: false` (2) | `tamper-guard` (always-on, cannot be config-disabled) blocks writes to the enforcement layer |
| Marker survives failed unlink → permanent approval (3) | `consume()` fails closed — unconsumable marker = not approved |
| Shell wrappers (`command git`, `\git`, `env git`, `sh -c`, `xargs`, `$( )`) evade detection (4) | Wrapper-aware git detection in `hard-stop` + `force-push-guard` |

Residual tier-A risk (accepted, documented): interpreter indirection
(`python -c "os.system('git push')"`), novel wrappers, or tools outside hook
coverage. Every guardrail decision is logged to
`<stateDir>/guardrail-log.jsonl`; `agentkit stats` surfaces block/bypass
patterns for review.

### Tier B — real vulnerabilities (fixed, not accepted)

These were bugs in AgentKit itself, exploitable beyond the cooperative-agent
model:

| Vulnerability (finding) | v2.5.0 fix |
|---|---|
| Malformed hook stdin → fail-open even for `failClosed` guardrails (5) | Adapters block on unparseable stdin for fail-closed guardrails (empty stdin = manual no-op stays allowed) |
| Missing `hookEventName` in inject output (6) | Adapter echoes the incoming event name per the Claude Code hook contract |
| `doctor`/`verify`/adapter `require()` every repo-local `.cjs` → RCE on cloning an untrusted repo (7) | Trust-on-first-use: local guardrails only execute after `agentkit trust`; hashes live outside the repo (`~/.agentkit/trust/`), any edit re-requires trust |
| Path traversal via manifest targets / `meta.installPath` / `stateDir` / `localGuardrailsDir` / `rulebooks` (8) | All file writes/deletes are containment-checked against the repo root; escaping values are skipped (warned) or clamped to defaults |

## Trust boundaries

- **The kit package** (`@arches/agentkit` from the org repo) is trusted — it
  ships the guardrails, packs, and the adapter that `settings.json` executes.
  Supply-chain protection = the usual npm/git controls, not AgentKit's.
- **The consumer repo working tree** is *not* trusted at CLI time: manifests,
  configs, and local guardrails are agent- and attacker-writable. Hence
  containment checks, the trust store, and tamper-guard.
- **The user's terminal** is trusted: `agentkit approve` and `agentkit trust`
  are meaningful only when a human runs them. Inside a Claude Code session,
  `!`-prefixed commands run as the user and do not pass through agent hooks.

## Reporting

Found a bypass? File it in the AgentKit repo — a fix here reaches every
consumer on the next sync.
