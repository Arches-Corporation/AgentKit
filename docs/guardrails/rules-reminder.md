# rules-reminder

**Event:** UserPromptSubmit · inject (never blocks) · fail-open

## What it does

Injects your repo's rule summary into the agent's context — by default once per session, on the first prompt. This is the *proactive* awareness layer: the agent knows HARD STOP, spec-first, etc. before hitting a wall, instead of learning by being blocked.

Silent until configured: no `text` = no-op.

## Why

Guardrails enforce reactively; a rule stated up front prevents the attempt entirely. Rule of thumb from the vendor-neutrality position: every enforced rule should also be written where the agent reads it — this guardrail is the delivery mechanism for repos whose agent rulebook isn't auto-loaded.

## Config

```json
"rules-reminder": {
  "enabled": true,
  "text": [
    "Repo rules: spec before code.",
    "HARD STOP: no git commit/push without explicit user approval.",
    "Never read .env or key files without an APPROVED: prefix."
  ],
  "oncePerSession": true
}
```

| Option | Default | Meaning |
|---|---|---|
| `text` | `""` | string or array of strings (joined with spaces); empty = disabled |
| `oncePerSession` | `true` | dedupe per session id; `false` = every prompt |

## Repo-specific variants

Need dynamic content (branch/ticket detection, per-directory context)? Write a local guardrail instead — see EKB's `dev-rules-reminder` in `.agentkit/guardrails/` for the pattern. This built-in covers the static-text 90% case.
