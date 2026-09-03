# db-guard

**Event:** PreToolUse · matcher `Bash` · fail-closed

## What it blocks

Commands matching destructive database operations:

- `rails db:drop` / `db:reset` / `db:migrate:reset` / `db:schema:load` (also via `rake`)
- SQL `DROP DATABASE|SCHEMA|TABLE`, `TRUNCATE`
- `prisma migrate reset`
- `docker compose down -v` (wipes volumes)

## Why

An agent "fixing" a migration by resetting the database is a classic irreversible mistake. These commands are sometimes legitimate in local dev — so it's a marker gate, not a ban.

## Approval flow

```bash
touch .agentkit/state/db-approved
```

One-shot — consumed by the next matching command.

## Config

```json
"db-guard": {
  "enabled": true,
  "extraPatterns": [
    { "pattern": "\\bflushall\\b", "label": "redis flushall" }
  ],
  "approvalMarker": "db-approved"
}
```

| Option | Default | Meaning |
|---|---|---|
| `extraPatterns` | `[]` | additional `{pattern, flags?, label?}` regexes on top of the built-ins |
| `approvalMarker` | `db-approved` | one-shot marker filename |

Built-ins cannot be disabled individually — disable the guardrail or approve per use.
