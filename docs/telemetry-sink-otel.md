# Telemetry sink: OpenTelemetry (OTLP/HTTP logs)

`usage-telemetry`'s `otel` sink drains the kit's local event logs into **OTLP/HTTP Logs JSON** and POSTs them to any OTLP collector — one `LogRecord` per event, per-event so guardrail records keep their `tool_use_id`. This is the transport for teams that already run (or will run) an observability stack; the free, zero-infra alternative is the Google Sheet sink ([telemetry-sink-apps-script.md](telemetry-sink-apps-script.md)). Both are fed by the same kit events — run either or both.

## Config

```json
"usage-telemetry": {
  "enabled": true,
  "sinkMode": "otel",
  "otelEndpoint": "https://collector.internal/v1/logs",
  "otelAuthTokenEnv": "OTEL_EXPORTER_OTLP_AUTH"
}
```

- `otelEndpoint` — the collector's OTLP/HTTP **logs** URL (`/v1/logs`).
- `otelAuthTokenEnv` — name of an env var holding the **full** `Authorization` header value (e.g. `Basic <base64>` for Grafana Cloud, `Bearer <token>` for others). The kit reads it at export time — the credential never enters config or git, only the env-var name is committed (§Security). Overrides any `Authorization` in `otelHeaders`; unset → no auth header (fail-open). Set it the same place you set Claude Code's `OTEL_EXPORTER_OTLP_HEADERS` (shell / MDM-managed system file).
- `otelHeaders` — optional `"Key: Value"` strings for **non-secret** collector headers (e.g. tenant id). If an `Authorization` header ends up present (here or via `otelAuthTokenEnv`), the endpoint **must** be https (the kit refuses plaintext).

The export fires on the same 24 h debounce as every sink (detached, fail-open). A `<stateDir>/last-otel-cursor` file records the last-emitted `ts` per log so re-runs never duplicate; it advances only after a successful POST.

## What lands in the collector

Envelope (standard protobuf-JSON mapping — any OTLP collector ingests it):

```
resourceLogs[0].resource.attributes: service.name=agentkit, user.email, repo
  scopeLogs[0].scope.name = agentkit.usage-telemetry
    logRecords[]:
      body=<event>          attributes: kind, name, session.id, tool_use_id, adapter
      body=guardrail.block  attributes: kind=guardrail, guardrail.name, decision, tool_use_id
```

Metadata only — the same fields the local logs hold. No prompt text, tool inputs, or guardrail `reason` strings are emitted (fixture-tested).

## The join with Claude Code's native telemetry

Enable Claude Code's own OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_EXPORTER_OTLP_ENDPOINT` → the same collector). Anthropic emits `claude_code.tool_decision` with `source:"hook"` and a `tool_use_id`, but **no hook name** — every guardrail looks identical. The kit's `otel` records carry `guardrail.name` + the matching `tool_use_id`. Join them:

```sql
-- pseudo-query in your backend
SELECT k.attr['guardrail.name'] AS guardrail,
       a.attr['decision']       AS decision,
       count(*)                 AS n
FROM   claude_code_events a          -- Anthropic's tool_decision, source='hook'
JOIN   agentkit_logs      k          -- kit's guardrail records
  ON   a.tool_use_id = k.attr['tool_use_id']
WHERE  a.name = 'tool_decision' AND a.attr['source'] = 'hook'
GROUP BY 1, 2
```

(Attribute access syntax varies by backend — flat map, `attributes["x"]`, or a `->>` JSON operator. The join key is always `tool_use_id`.)

Result: named guardrail activity (`hard-stop`, `scout-block`, …) that native OTel alone cannot produce. Inject-type guardrails (rules-reminder, secret-output) and command names — which never appear in `tool_decision` — come straight from the kit records, no join needed.

## Collector

Any OTLP/HTTP collector works — a self-hosted **OpenTelemetry Collector** / **Grafana Alloy**, or a vendor endpoint (SigNoz, Honeycomb, Datadog, Grafana Cloud). Point `otelEndpoint` at its `/v1/logs` receiver. Standing up the collector is org infrastructure — this doc only covers the kit side.

## Cost note

The kit's OTLP emission is free and dependency-free. The **collector + storage** is the cost (a container to run, or a vendor bill) — the trade for real-time + tamper-proof (managed-settings-locked) telemetry over the Sheet's daily, zero-infra path.
