# spec-first

**Event:** PreToolUse · matcher `Bash` · fail-open

## What it blocks

`git commit` when staged files include product code and either:
- the current branch carries no ticket ID (`ticketPattern`), or
- the ticket's spec directory (`specDirTemplate`) contains no `.md` file.

Non-code commits (docs, config) pass untouched.

## Why

Enforces "no code without a spec": work is defined in a spec before implementation exists. Catches the agent (or human) skipping straight to code.

## Exemption flow

Genuinely exempt change (trivial fix, generated file):

```bash
touch .agentkit/state/spec-approved
```

One-shot — consumed by the next commit.

## Config

```json
"spec-first": {
  "enabled": true,
  "approvalMarker": "spec-approved",
  "ticketPattern": "EKB-\\d+",
  "codePathPatterns": ["^(apps/web/src/|apps/api/(app|lib|db)/)"],
  "specDirTemplate": "docs/specs/features/{ticket}"
}
```

| Option | Default | Meaning |
|---|---|---|
| `ticketPattern` | `[A-Z][A-Z0-9]+-\d+` | regex matched against the branch name; match = ticket ID |
| `codePathPatterns` | `["^(src|app|lib)/"]` | staged paths matching any regex count as product code |
| `specDirTemplate` | `docs/specs/features/{ticket}` | where a spec must exist; `{ticket}` is replaced (uppercased) |
| `requireSpecDir` | `true` | `false` = enforce ticket-in-branch only, skip the spec-dir lookup — for repos whose spec tool uses slug-named dirs (e.g. openspec) |
| `hintText` | `""` | repo-specific guidance appended to block messages (e.g. where the spec template lives) |
| `approvalMarker` | `spec-approved` | one-shot exemption marker |

**Tune these per repo** — the defaults fit a generic single-app layout; monorepos need explicit `codePathPatterns`.

## Behavior notes

- Fail-open: a git error (not a repo, detached state) allows rather than blocks.
- Ticket match is case-insensitive; the spec path uses the uppercased ID.
