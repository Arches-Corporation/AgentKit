# Research memo — AI usage telemetry for the engineering team

Date: 2026-09-08. Context: director mandate (catchup Sep 8) — track who uses AI and how, before wide AgentKit distribution. Scope: skill/agent utilization, session counts, token summaries, adoption trends. Out of scope by explicit direction: prompt contents. Driver: IPO-readiness liability posture + input for half-year reviews.

## What the industry does

**Metadata-only telemetry is the standard, not an exception.** Cursor's Admin API never returns prompt text; GitHub Copilot metrics reports contain no prompts; Claude Code's OpenTelemetry export redacts prompt/response text by default (`<REDACTED>` unless `OTEL_LOG_USER_PROMPTS=1`). Our "no prompt capture" constraint is therefore free — it is the default posture of every major vendor.

**Standard scorecard rows** (Jellyfish, Worklytics, LinearB, DX):
- Adoption rate: % of engineers active per week, per tool
- Depth: sessions / agent requests per dev per week
- Token usage + estimated cost per dev per model
- Acceptance rate (edit-tool accept/reject) — the one free quality-ish signal
- Feature mix (autocomplete vs chat vs agentic) — maturity signal
- Output-linked counts: commits/PRs created via the AI tool

**Frameworks:**
- DX AI Measurement Framework (utilization / impact / cost): https://getdx.com/research/measuring-ai-code-assistants-and-agents/
- DORA 2025 AI report — AI amplifies existing org strengths/weaknesses; pair usage with quality signals: https://dora.dev/dora-report-2025/
- Copilot metrics API — de-facto dimension schema (active users, acceptances, per-surface/IDE/model): https://docs.github.com/en/rest/copilot/copilot-usage-metrics

**Compliance angle (IPO/SOC2-adjacent):** metadata-only logging avoids prompt logs becoming audit scope (retention, PII redaction, access control), while still providing the audit trail that engineers use the sanctioned framework — the "shadow AI" detection story. Ship a one-page telemetry policy stating what is/isn't collected, who sees per-user rows, retention window. The managed config itself is the control evidence.

**Caution (must be in the rollout framing):** DX explicitly warns against using these metrics for individual performance evaluation; volume metrics are gameable (Goodhart) and METR's RCT showed perceived speedup can be illusory (devs 19% slower while believing 20% faster — https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/). Recommended framing: adoption support + cost + compliance visibility. Per-user rows admin-only; reviews use them as enablement context ("is this person supported/trained"), not a ranked target. Announce collection before enabling — covert telemetry is the top trust-destroyer.

## Vendor-native options (per tool)

### Claude Code
1. **Analytics Admin API** — `GET /v1/organizations/usage_report/claude_code`: daily per-user (actor email) sessions, LOC added/removed, commits/PRs by Claude Code, edit accept/reject, per-model tokens + estimated cost. Zero infra (nightly script to Drive suffices). **Requires a Console org or Team/Enterprise plan with Admin API key — does not cover engineers on personal Max subscriptions.** https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api
2. **OpenTelemetry export** — `CLAUDE_CODE_ENABLE_TELEMETRY=1` + OTLP endpoint: token/cost/session metrics with per-skill, per-agent, per-MCP-tool attribution; `user.email` attribute; prompts redacted by default. Needs one OTLP collector (single container or vendor free tier). Enforceable org-wide via managed settings. https://code.claude.com/docs/en/monitoring-usage
3. **Hooks** — `PostToolUse` receives `tool_name` (`Skill`, `Agent`, …) + `tool_input`; `SessionStart`/`SessionEnd` bracket sessions. No token data, but full skill/agent invocation visibility, works on ANY account type. This is the AgentKit-native surface.

### Cursor
- **Admin API (Teams tier+)**: `POST /teams/daily-usage-data` (per-user daily: agent/chat/composer requests, tabs accepted, lines), `POST /teams/filtered-usage-events` (tokens, model, cost), `GET /teams/spend`. No prompt content in any response. https://cursor.com/docs/account/teams/admin-api

## Recommended metric set (minimal, matches director scope)

Common schema `date, user, tool`:

1. Weekly active users per tool (compliance core: WHO)
2. Sessions per dev per week (depth)
3. Skill / command / agent invocations by name (HOW they use the framework — the thing the director actually cares about: guardrails/review/testing usage)
4. Guardrail events (blocks/injects) — proves the safety layer is active
5. Token usage + est. cost per dev per model (where obtainable: Admin API or OTel; not from hooks)
6. Trend deltas week-over-week

Skip for now: acceptance-rate deep-dives, time-saved surveys, per-prompt event streams — overkill at team size.

## Recommended rollout (three layers, cheapest first)

| Layer | What | Covers | Cost | When |
|---|---|---|---|---|
| **A — AgentKit usage log** (this proposal) | Kit-native hook recorder: skills/commands/agents/guardrails/sessions to local JSONL + `agentkit report` daily rollup + configurable sink | Any Claude Code account (incl. personal Max); Cursor via adapter later | ~1 day impl, zero infra | Now, ship with Thursday release |
| **B — Vendor Admin APIs** | Nightly script pulls Claude Analytics API + Cursor Admin API into Drive/sheet | Tokens, cost, LOC, acceptance | Zero infra, needs org/Teams plans + admin keys | When plan/keys confirmed |
| **C — OpenTelemetry** | Managed-settings-enforced OTel to a small collector | Per-skill token/cost attribution, real-time | One collector to run | Only if B's granularity proves insufficient |

Layer A is the only one that answers "do they use OUR framework (skills/guardrails)" — vendor APIs can't see AgentKit assets. Layers A+B together satisfy every metric the director listed.
