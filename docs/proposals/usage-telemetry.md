# Proposal — AgentKit usage telemetry (Layer A)

Status: IMPLEMENTED on `feat/usage-telemetry` (2026-09-08) — user-facing doc: `docs/telemetry.md`. Companion research: `usage-telemetry-research.md`.
Implementation deviation: config lives flat under `guardrails."usage-telemetry"` (`sinkMode`/`sinkPath`/`sinkUrl`/`sinkAuthTokenEnv`) instead of a top-level `telemetry` block — the guardrail option machinery (defaults validation, `optionsFor`, schema) already handles per-guardrail config, and a top-level key would need parallel plumbing the adapters never pass to `check()`.
Target: v2.6.0 (`feat:` minor bump). Requested by Masaki (catchup 2026-09-08) — usage tracking must ship in the kit before wide distribution.

## What

A kit-native usage recorder + reporter + optional daily export:

1. **Recorder** — a new built-in observer (`usage-telemetry`) on the existing guardrail pipeline. Always returns `null` (never blocks, never injects); side effect only: append one JSONL line per observed event.
2. **Reporter** — new CLI command `agentkit report [--json|--csv] [--since <days>]`: per-user, per-day, per-tool rollup of the usage log (mirrors the existing `stats` command over `guardrail-log.jsonl`).
3. **Export** — optional sink for the daily rollup: a file path (e.g. a Drive-synced folder) or an HTTP endpoint. Off by default; fail-open (an unreachable sink never blocks or delays work).

## Why

- Director mandate: automated visibility into who uses the sanctioned framework and how (skills, agents, guardrails), for compliance (IPO liability posture) and adoption support. Vendor analytics APIs cannot see AgentKit assets; only the kit itself can answer "are they using our skills/guardrails."
- Works on any account type (including personal Claude Max), any consumer repo, zero infra — unlike the Admin-API and OTel layers (see research memo, Layers B/C).

## Events recorded

| Event | Source hook | Payload |
|---|---|---|
| `session_start` | `SessionStart` | — |
| `skill` | `PostToolUse`, matcher `Skill` | skill name |
| `agent` | `PostToolUse`, matcher `Task\|Agent` | agent type |
| `command` | `UserPromptSubmit` (leading `/name` in prompt) | command name |
| `guardrail_block` / `guardrail_inject` | derived from existing `guardrail-log.jsonl` at report time — no new recording | guardrail name |

Log line shape (`<stateDir>/usage-log.jsonl`, same `createLog` util + 512 KB rotation as the guardrail log):

```json
{"ts":"2026-09-10T08:12:03Z","user":"lam.phan@arches-global.com","repo":"EKB","session":"<session_id>","event":"skill","name":"deep-review"}
```

`user` = `git config user.email`, fallback OS username. `repo` = repo directory basename.

## Privacy boundary (hard rule, documented in `docs/telemetry.md`)

Recorded: event names and counts, timestamps, user email, repo name, session id.
Never recorded: prompt text, tool inputs/outputs, command arguments, file paths, code content. The recorder receives `tool_input` from the hook and discards everything except the skill/agent name field. Enforced by test fixtures (a canned event with sensitive `tool_input` must produce a log line containing none of it).

## Config surface (`agentkit.config.json`)

```json
{
  "telemetry": {
    "enabled": true,
    "sink": { "mode": "none" }
  }
}
```

- `enabled` (default `true` once the section exists; `init` writes it) — controls the recorder.
- `sink.mode`: `"none"` (default) | `"file"` (+ `path`) | `"endpoint"` (+ `url`, optional `headers` via env var reference only — no secrets in config, per §Security rules).
- Export cadence: on `SessionStart`, if the last successful export is >24 h old, the adapter spawns a detached best-effort export of the previous day's rollup. Manual: `agentkit report --export`.
- Disabling is a visible, committed config change — auditable by design, no hidden opt-outs.

## Non-goals (this PR)

- Token/cost data — not visible to hooks. Landed instead in the follow-up `feat/usage-telemetry-tokens` branch via local `~/.claude/**` transcript mining (usage fields only), since the vendor Analytics API is Enterprise-gated and unavailable on our Team plan. `report` leaves columns for that merge.
- Cursor skill/agent depth — the beta hook surface has no PostToolUse; Cursor records `prompt`/`command` activity only (implemented). Deeper Cursor metrics, if ever needed, come from its Admin API.
- Central database/dashboard — rollup rows in a Google Sheet (via the Apps Script sink) are sufficient at current team size.

## Touch points

- `src/core/guardrails/usage-telemetry.cjs` (new observer + test)
- `src/core/lib/usage.cjs` (log append, rollup aggregation — pattern from `src/core/lib/stats.cjs`)
- `src/adapters/claude/settings-fragment.cjs` (register `PostToolUse` matchers `Skill`/`Task`, `SessionStart`)
- `bin/agentkit.cjs` (`cmdReport`)
- `agentkit.config.schema.json` (`telemetry` section)
- `docs/telemetry.md` (user-facing: what is/isn't collected, retention, who sees it — doubles as the compliance policy page)

## Acceptance criteria

- [ ] Skill/agent invocations and session starts in a consumer repo produce usage-log lines; no prompt/input content ever appears in the log (fixture-tested).
- [ ] `agentkit report` prints per-user/day/tool counts; `--json`/`--csv` machine-readable; guardrail block/inject counts included from the existing log.
- [ ] `telemetry.enabled: false` produces zero recording; `doctor` shows telemetry status either way.
- [ ] Sink failure (offline, 500, missing dir) never blocks or slows a session; export retries next day.
- [ ] `verify` passes; recorder adds no measurable latency to hook execution (observer returns immediately, async append).
- [ ] Rollout note ships with the Thursday announcement: one paragraph stating collection scope (metadata only), visibility (admins), and purpose (adoption support + compliance) — per research memo, announced before enabling.
