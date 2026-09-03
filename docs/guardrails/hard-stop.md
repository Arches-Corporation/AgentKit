# hard-stop

**Event:** PreToolUse · matcher `Bash` · fail-closed

## What it blocks

- Any `git commit` or `git push` issued by the agent, unless a one-shot approval marker exists.
- Any attempt to bypass git hooks: `--no-verify` or `commit -n` — blocked even with the marker.

## Why

The agent must never publish work without explicit human approval, and must never skip the quality gates (typecheck/lint/tests) that pre-commit hooks run. The block message instructs the agent to report its changes and wait; the human approves by placing the marker.

## Approval flow

```bash
touch .agentkit/state/git-approved
```

The next `git commit`/`git push` consumes the marker (one-shot). Every decision is logged to `.agentkit/state/guardrail-log.jsonl`.

## Config

```json
"hard-stop": { "enabled": true, "approvalMarker": "git-approved" }
```

| Option | Default | Meaning |
|---|---|---|
| `approvalMarker` | `git-approved` | filename of the one-shot marker inside `stateDir` |

## Behavior notes

- Fail-closed: an internal error blocks rather than allows.
- `commit -n` detection covers combined short flags (e.g. `-anm`).
