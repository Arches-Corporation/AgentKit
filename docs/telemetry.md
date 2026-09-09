# usage-telemetry

**Events:** SessionStart · PostToolUse (matcher `Skill|Task|Agent`) · UserPromptSubmit — observer, never blocks, never injects.

Records how engineers use the kit — session starts, skill invocations, subagent dispatches, slash commands — so the team can see adoption without anyone standing next to a terminal. Rollups feed the org's compliance posture (everyone works inside the sanctioned framework) and adoption support.

## What is collected (the complete list)

Each event appends one JSONL line to `<stateDir>/usage-log.jsonl`:

```json
{"ts":"2026-09-10T08:12:03Z","event":"skill","name":"deep-review","user":"lam.phan@arches-global.com","repo":"EKB","session":"<session_id>"}
```

| Field | Content |
|---|---|
| `event` | `session_start` · `skill` · `agent` · `command` · `prompt` (content-free activity tick) |
| `name` | skill / subagent / slash-command name only (absent for `session_start`/`prompt`) |
| `user` | `git config user.email`, fallback OS username |
| `repo` | repo directory basename |
| `session` | tool session id |
| `adapter` | `claude` · `cursor` |

## What is never collected

Prompt text, tool inputs and outputs, command arguments, file paths, code content. The recorder extracts the single name field and discards the rest of the event; the log writer additionally strips any field outside the allow-list (`src/core/lib/usage.cjs` `RECORD_FIELDS`) — enforced by fixture tests that pass sensitive tool input through and assert none of it lands in the log. A plain prompt (no leading `/command`) produces only `{"event":"prompt"}` — a count, zero content.

Data stays in the repo's state dir (same 512 KB rotation as the guardrail log) unless a sink is configured. The kit makes zero network calls when `sinkMode` is `none` (the default).

## Reading it

```
agentkit report                 per-user/day rollup: sessions · skills · agents · commands + top names
agentkit report --json          machine-readable (includes guardrail block/inject counts by day)
agentkit report --csv           spreadsheet-ready usage rows
agentkit report --since 7       limit to the last 7 days
agentkit report --export        build the rollup and ship it to the configured sink
```

`report` also folds in `guardrail-log.jsonl` block/inject counts per day, so one command answers both "are they using the framework" and "is the safety layer active".

## Export sink

```json
"usage-telemetry": {
  "enabled": true,
  "sinkMode": "file",
  "sinkPath": "/Users/me/Google Drive/agentkit-usage"
}
```

| Option | Default | Meaning |
|---|---|---|
| `sinkMode` | `none` | `none` (local only) · `file` (write JSON into `sinkPath`) · `endpoint` (POST rollup JSON to `sinkUrl`) · `otel` (drain per-event OTLP/HTTP logs to `otelEndpoint`) |
| `sinkPath` | `""` | directory for file mode — absolute paths allowed (export targets live outside the repo) |
| `sinkUrl` | `""` | URL for endpoint mode |
| `sinkAuthTokenEnv` | `""` | name of an env var holding a bearer token — never the token itself (§Security: no secrets in config). If the env var is unset the POST goes out without the header (fail-open); https is required whenever a token is present |
| `otelEndpoint` | `""` | OTLP/HTTP logs URL for otel mode (e.g. `https://collector/v1/logs`) |
| `otelHeaders` | `[]` | extra headers for otel mode as `"Key: Value"` strings (non-secret collector headers); https required if an `Authorization` header is present |
| `otelAuthTokenEnv` | `""` | name of an env var holding the full `Authorization` header value for otel mode (e.g. `"Basic <base64>"` or `"Bearer <token>"`) — never the credential itself (§Security). Injected at export time, overrides any `Authorization` in `otelHeaders`; unset → no auth header (fail-open); https required |

With a sink configured, the first session start of the day fires a detached, best-effort `report --export` (at most once per 24 h, stamped by `<stateDir>/last-usage-export`). Fail-open by design: an unreachable sink never blocks, slows, or errors a session — the export just retries next day.

Zero-infra team receiver (Google Apps Script → Sheet): [telemetry-sink-apps-script.md](telemetry-sink-apps-script.md).

## OTLP sink (`sinkMode: "otel"`)

For teams that run an OpenTelemetry collector, `otel` mode ships the same metadata as **per-event OTLP/HTTP Logs** instead of a daily rollup. One `LogRecord` per event (session/skill/agent/command + each guardrail decision), under `resourceLogs → scopeLogs (agentkit.usage-telemetry) → logRecords`. Resource attributes carry `service.name=agentkit`, `user.email`, `repo`. Dependency-free — the OTLP JSON is hand-built and POSTed over raw https, reusing the same retry/backoff/jitter as the endpoint sink.

**Why per-event (vs the rollup):** each guardrail record keeps its `tool_use_id`. Claude Code's own OpenTelemetry emits `claude_code.tool_decision` with `source:"hook"` and the *same* `tool_use_id` — but no hook name. Joining the two streams on `tool_use_id` turns Anthropic's anonymous "a hook blocked" into "**hard-stop** blocked", plus recovers inject-type guardrails and command names that native OTel can't see at all. The kit is the source of that identity; OTLP is just the transport.

A `<stateDir>/last-otel-cursor` marker tracks the last-emitted timestamp per log so re-runs never duplicate events; the cursor only advances after a successful POST (fail-open — a dead collector re-sends next day). Setup + the join query: [telemetry-sink-otel.md](telemetry-sink-otel.md).

This is orthogonal to the Apps Script sink — both are fed by the same kit events; you can run either, or both.

## Behavior notes

- Disabling is a visible config change (`"usage-telemetry": { "enabled": false }`) — auditable in git history, no hidden opt-outs. Tell the team before enabling a sink; covert telemetry destroys trust.
- Per-user rows are for adoption support and enablement, not ranked scoring — usage volume is not a productivity measure.
- Cursor: the beta hook surface has no SessionStart/PostToolUse equivalents, so Cursor records `prompt` and `command` activity only (no skill/agent detail — Cursor doesn't invoke those as tools); prompt events also arm the daily export there. Depth metrics (requests, tokens, spend) come from Cursor's own team analytics.
- Uses a per-event matcher map (`matchers`) so the PostToolUse hook fires only for `Skill|Task|Agent` tools — no overhead on Read/Edit/Bash traffic.
