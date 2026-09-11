# spec-first

**Event:** PreToolUse · matcher `Bash` · fail-open

## What it blocks

`git commit` when staged files include product code and either:
- the current branch carries no ticket ID (`ticketPattern`), or
- the ticket's spec directory (`specDirTemplate`) lacks the required spec file(s) — any `.md` by default, or the specific files the change's **lane** demands when `lanes` is configured.

Non-code commits (docs, config) pass untouched.

## Why

Enforces "no code without a spec": work is defined in a spec before implementation exists. Catches the agent (or human) skipping straight to code.

## Exemption flow

Genuinely exempt change (trivial fix, generated file):

```bash
npx agentkit approve spec-approved   # user-only, run in your own terminal
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
| `lanes` | `null` | lane-aware requirements (see below); `null` = any single `.md` satisfies the gate |
| `ticketUrlTemplate` | `""` | URL template with `{ticket}`; `agentkit spec` fills the link into scaffolded specs |
| `hintText` | `""` | repo-specific guidance appended to block messages (e.g. where the spec template lives) |
| `approvalMarker` | `spec-approved` | one-shot exemption marker |

**Tune these per repo** — the defaults fit a generic single-app layout; monorepos need explicit `codePathPatterns`.

## Lanes — enforce the right spec *shape* per change

Without `lanes`, the gate is existence-only (any `.md` passes), so a migration can land with a one-line `spec.md`. `lanes` makes the requirement depend on what the change touches:

```json
"lanes": {
  "full":    { "triggers": ["db/migrate/", "config/routes", "_controller\\.rb$", "app/services/"],
               "requires": ["proposal.md", "design.md", "tasks.md"] },
  "default": { "requires": ["spec.md"] }
}
```

- **First lane whose `triggers` match a staged file wins**; a change with no trigger match falls to `default`.
- The chosen lane's `requires` files must all exist in the ticket dir — the block message names exactly which are missing and why (which staged file triggered the lane).
- This makes the Light→Full "promotion" mechanical: staging a migration forces the Full trio; you can't commit it with only `spec.md`.
- `default` needs no `triggers` (it's the fallthrough). Omit `lanes` entirely to keep legacy behavior.

Scaffold the right files in one step with [`agentkit spec`](#scaffold) — it auto-detects the lane from staged files using these same rules.

## Scaffold

```bash
npx agentkit spec EKB-1234            # lane auto-detected from staged files
npx agentkit spec EKB-1234 --full     # or force a lane
```

Creates `docs/specs/features/EKB-1234/` with the lane's files, pre-filled (ticket, link, What/Why/AC headings). Idempotent — never overwrites an existing file. Also available in Claude Code as the `/spec` slash command.

## Behavior notes

- Fail-open: a git error (not a repo, detached state) allows rather than blocks.
- Ticket match is case-insensitive; the spec path uses the uppercased ID.
