# Adapters

Core guardrails are vendor-neutral (`check(event, ctx)`); an adapter translates one tool's hook protocol into the normalized event and back. Adding a vendor never touches guardrail logic.

| Tool | Status | Wiring |
|---|---|---|
| Claude Code | **stable** | `agentkit init --tool claude` → `.claude/settings.json`; one runner invocation per guardrail; exit 0/2 protocol; `inject` supported |
| Cursor | **beta** (requires Cursor ≥1.7 hooks) | `agentkit init --tool cursor` → `.cursor/hooks.json`; one runner invocation per *event*, all matching guardrails evaluated in order; JSON `permission`/`continue` protocol |
| Gemini CLI | not possible yet | no hook/extension surface for tool-call interception; rules reach Gemini only via the repo's entry file (`GEMINI.md`) |

## Event mapping (Cursor)

| Cursor event | Guardrails run |
|---|---|
| `beforeShellExecution`, `beforeMCPExecution` | everything with a `Bash` matcher: hard-stop, spec-first, force-push-guard, db-guard, privacy-block, scout-block, + local Bash guardrails |
| `beforeReadFile` | `Read` matchers: privacy-block, scout-block |
| `beforeSubmitPrompt` | `UserPromptSubmit` guardrails: secret-output (blocks stop the prompt) |

Cursor limitations vs Claude Code:

- **No context injection** — `inject` results (rules-reminder, session-restore-style) are dropped; Cursor has no additionalContext channel. Blocking guardrails work fully.
- First blocking guardrail wins per event (deny short-circuits).
- Hooks are a Cursor beta; field names may shift — treat the adapter as beta and run `npm test` (`test/cursor-adapter.test.cjs`) against protocol changes.

## Writing a new adapter

1. `src/adapters/<tool>/run.cjs`: read the tool's hook payload, build the normalized event `{ hookEvent, toolName, command, paths, prompt, cwd, sessionId, raw }`, resolve guardrails (registry + `loadAll` locals), call `check`, translate `{block}`/`{inject}` to the tool's reply format.
2. Add an `init --tool <tool>` branch in `bin/agentkit.cjs` writing the tool's hook config idempotently.
3. Smoke tests mirroring `test/cursor-adapter.test.cjs`.
