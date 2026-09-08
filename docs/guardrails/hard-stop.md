# hard-stop

**Event:** PreToolUse · matcher `Bash` · fail-closed

## What it blocks

- Any `git commit` or `git push` issued by the agent, unless a one-shot approval marker exists.
- Any attempt to bypass git hooks: `--no-verify` or `commit -n` — blocked even with the marker.

## Why

The agent must never publish work without explicit human approval, and must never skip the quality gates (typecheck/lint/tests) that pre-commit hooks run. The block message instructs the agent to report its changes and wait; the human grants approval **themselves**.

## Approval flow (user-only)

```bash
npx agentkit approve            # default marker: git-approved
```

Run it in your own terminal (in a Claude Code session, `! npx agentkit approve` works — user-typed `!` commands do not pass through agent hooks). The next `git commit`/`git push` consumes the marker (one-shot). Every decision is logged to `.agentkit/state/guardrail-log.jsonl`.

The block message deliberately does **not** tell the agent where the marker lives or how to place it, and `tamper-guard` blocks agents from running `agentkit approve` or writing into the state dir. If the marker exists but cannot be consumed (state-dir permission games), the guardrail treats it as NOT approved — a stuck marker never becomes a standing approval.

## Config

```json
"hard-stop": { "enabled": true, "approvalMarker": "git-approved" }
```

| Option | Default | Meaning |
|---|---|---|
| `approvalMarker` | `git-approved` | filename of the one-shot marker inside `stateDir` |

## Behavior notes

- Fail-closed: an internal error blocks rather than allows; a malformed hook event on stdin also blocks.
- `commit -n` detection covers combined short flags (e.g. `-anm`).
- Wrapper-aware detection: `command git commit`, `\git commit`, `env git push`, `sh -c "git push"`, `xargs git push`, `$(git push)`, `nohup`/`timeout`/`nice` prefixes are all matched. A prose mention (`echo "git commit"`) is not.
- Residual (by design of hook-based guards): an agent with arbitrary shell can still construct exotic bypasses (e.g. spawning git from another interpreter). The guard raises friction and logs; the HARD STOP rule itself lives in the rulebook. See [threat-model.md](../threat-model.md).
