# Rulebook auto-wiring

Guardrails run from `node_modules` (wired in `.claude/settings.json`) — they need no rulebook reference. **Skills, commands, and subagents are different: an agent only uses them if the repo's rulebook tells it they exist.** `.agents/skills/` is not an auto-discovered path, so a synced skill sits dormant until something points at it.

`agentkit sync` closes that gap automatically — no hand-editing.

## What it does

After installing assets, `sync` writes a marker-fenced block into the repo's rulebook file(s):

```markdown
<!-- agentkit:start -->
## Agentic layer (AgentKit — auto-generated, do not edit between the markers)

Enforcement + reusable playbooks come from `@arches/agentkit` …

**Skills — invoke the matching one when its situation applies:**

| Skill | Use when |
|---|---|
| `deep-review` | Independent 14-dimension review of a diff before a PR. |
| … | … |

**Subagents — dispatch when relevant:**
- `advisor` — escalate hard trade-offs …
<!-- agentkit:end -->
```

- **Idempotent** — regenerated every sync; the block is replaced in place, content outside the markers is never touched.
- **Multi-tool** — injected into every target rulebook that exists: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/agentkit.md`.
- **Seeds when absent** — if the repo has none of those, `sync` creates a minimal `CLAUDE.md` carrying just the block, so a bare repo is still wired with zero manual work.
- **Descriptions** come from each skill's `meta.json` `description` (agents: frontmatter `description`); missing → derived from the asset's first prose line.

## Config

```jsonc
// default: auto-detect the four files above; seed CLAUDE.md if none
"rulebooks": ["CLAUDE.md"]   // target specific files only
"rulebooks": false           // opt out entirely (repo manages its own references)
```

## doctor

When managed assets exist, `doctor` warns if a target rulebook is missing the block or it's stale (asset added/removed since last sync) — run `sync` to reconcile.

## Why a block, not free prose

The fence makes it safe to regenerate on every kit update: new skills appear, removed ones disappear, descriptions refresh — all without a human editing the rulebook and without clobbering the repo's own instructions around it.
