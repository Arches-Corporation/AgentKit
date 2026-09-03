# privacy-block

**Event:** PreToolUse · matcher `Read|Edit|Write|Bash` · fail-closed

## What it blocks

Tool calls whose file path — or whose shell command references a token — matching a sensitive pattern: `.env*`, `.pem`, `.key`, `.p12`, `.pfx`, `id_rsa`, `credentials.*`, `secrets.*`. Template files (`.env.example`, `.env.sample`, `.env.template`) are allowed.

## Why

Secret-bearing files must not enter the agent's context: anything read can be echoed into output, logs, or a commit. Templates are safe by design and stay readable.

## Approval flow

Legitimate need (user asked to debug `.env`):

```
Read file_path: "APPROVED:/path/to/.env"
```

The `APPROVED:` prefix is per-call and visible in the transcript — the user grants it, the agent can't self-grant silently.

## Config

```json
"privacy-block": {
  "enabled": true,
  "sensitive": ["\\.env$", "\\.env\\.", "\\.pem$", "..."],
  "safe": ["\\.env\\.example$", "\\.env\\.sample$", "\\.env\\.template$"]
}
```

| Option | Default | Meaning |
|---|---|---|
| `sensitive` | EKB list (see example config) | case-insensitive regexes tested against full path and basename |
| `safe` | `.env.example/.sample/.template` | allowlist checked before `sensitive` |

Overriding `sensitive` **replaces** the default list — copy it from `agentkit.config.example.json` and extend.

## Behavior notes

- Fail-closed.
- Bash commands are scanned for secret-shaped tokens (e.g. `cat .env`, `less server.pem`), not just tool path arguments.
