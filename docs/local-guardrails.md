# Local guardrails

Repo-local guardrails are the **prototyping tier**: try a rule in one repo without a kit release. Established project rules belong in a [project pack](project-packs.md) inside AgentKit; shared rules become built-ins. Same contract at every tier.

## Where

```
<repo>/.agentkit/guardrails/<name>.cjs
```

Filename must equal the guardrail's `name`. Scaffolded by `agentkit init`; override the dir with `"localGuardrailsDir"` in `agentkit.config.json`.

## Contract (identical to built-ins)

```js
'use strict';

function check(event, ctx) {
  if (event.command && /rails db:drop/.test(event.command)) {
    return { block: 'BLOCKED: never drop the database from an agent session.' };
  }
  return null;
}

module.exports = {
  name: 'no-db-drop',
  events: ['PreToolUse'],
  matcher: 'Bash',
  failClosed: false,
  defaults: {},
  check,
};
```

- `event` = `{ hookEvent, toolName, command, paths[], prompt, cwd, sessionId, raw }` — `raw` is the untouched hook input for fields the normalizer doesn't map (e.g. `transcript_path`, `trigger`, `source`)
- `ctx` = `{ repoRoot, options, markers, log }` — options come from `agentkit.config.json` under the guardrail's name; markers give one-shot approval files; log writes to the shared jsonl.
- Return `null` (allow), `{ block: reason }`, or `{ inject: text }`.

## Wiring

After adding a file, re-run:

```bash
npx agentkit init --tool claude   # wires it into .claude/settings.json (idempotent)
npx agentkit doctor               # confirms it loads
```

`agentkit list` shows it tagged `(local)`. Disable per repo like any built-in: `"guardrails": { "no-db-drop": { "enabled": false } }`.

## Rules of the layer

1. **Built-ins win** — a local guardrail can't shadow a built-in name (ignored at runtime, doctor warns).
2. **Promotion path** — used by one repo: keep local. Needed by a second repo: move the file into AgentKit `src/core/guardrails/`, add tests + a cookbook page, release.
3. **Document the rule too** — every local guardrail's rule must also be stated in the repo's agent rulebook (CLAUDE.md / AGENTS.md). The hook is the backstop, not the source of truth.
