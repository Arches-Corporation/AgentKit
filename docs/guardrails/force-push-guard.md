# force-push-guard

**Event:** PreToolUse · matcher `Bash` · fail-closed

## What it blocks

`git push --force`, `git push -f`, and (by default) `--force-with-lease` — unless a one-shot approval marker exists.

## Why

Force pushes rewrite remote history: anyone tracking the branch loses commits, CI references break, review threads detach. Legitimate uses exist (own feature branch after a rebase) — hence the marker escape hatch, not a hard ban. Note `hard-stop` already gates *every* push behind approval; this guardrail adds a second, force-specific gate so a generic push approval can't smuggle a history rewrite.

## Approval flow

```bash
touch .agentkit/state/force-push-approved
```

One-shot — consumed by the next force push.

## Config

```json
"force-push-guard": {
  "enabled": true,
  "allowForceWithLease": false,
  "approvalMarker": "force-push-approved"
}
```

| Option | Default | Meaning |
|---|---|---|
| `allowForceWithLease` | `false` | `true` lets `--force-with-lease` through without a marker (it refuses to clobber unseen remote commits) |
| `approvalMarker` | `force-push-approved` | one-shot marker filename |
