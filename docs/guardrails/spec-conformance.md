# spec-conformance

**Event:** PreToolUse · matcher `Bash` · fail-open · shared · **opt-in**

Part 3 of spec-driven: holds a PR to the ticket's spec at `gh pr create`. Off by default; a repo turns on the tiers it wants.

## What it blocks (only when enabled)

- **`requireAcChecklist`** (Tier 1) — every Acceptance Criterion in the ticket's spec must appear as a **ticked** (`- [x]`) item in the PR body. Missing/unticked ACs block, listed by name. Deterministic (text match).
- **`requireSpecCheck`** (Tier 2) — the `spec-check` review marker must exist before the PR opens; blocks otherwise. Proves the AI conformance review actually ran.

No ticket in the branch, or no ACs in the spec → nothing to enforce (passes).

## Config

```json
"spec-conformance": {
  "enabled": true,
  "requireAcChecklist": true,
  "requireSpecCheck": true,
  "ticketPattern": "EKB-\\d+",
  "specDirTemplate": "docs/specs/features/{ticket}",
  "testCommand": "npx playwright test -g {test}"
}
```

| Option | Default | Meaning |
|---|---|---|
| `requireAcChecklist` | `false` | Tier 1 — ACs mirrored + ticked in the PR body |
| `requireSpecCheck` | `false` | Tier 2 — `spec-check-passed` marker required |
| `specCheckMarker` | `spec-check-passed` | marker name for Tier 2 |
| `ticketPattern` / `specDirTemplate` | same as spec-first | how the spec dir is found |
| `testCommand` | — | Tier 3 template with `{test}` for `agentkit spec-verify` |

Match `ticketPattern`/`specDirTemplate` to your `spec-first` config.

## The Tier-2 marker (user-only)

The `spec-check` skill reviews code↔spec and reports. When it passes, the **user** records it:

```bash
npx agentkit approve spec-check-passed   # user-only; agents can't self-certify (tamper-guard)
```

Reuses the approval infrastructure — one-shot, consumed by the next PR-create.

## Tier 3 — executable ACs (`agentkit spec-verify`)

The strongest tier: make each AC provable by a test. Link it in the spec:

```markdown
## Acceptance Criteria
- [ ] search caps at 100 results {test: e2e/search.spec.ts -g "caps"}
```

Then:

```bash
npx agentkit spec-verify EKB-1234
```

Runs `testCommand` (with `{test}` substituted) per linked AC; asserts **every** AC is proven. A failing test or an **unlinked** AC → non-zero. Wire it into CI on PRs touching the ticket — that's spec-as-executable-contract, the last mile to complete spec-driven.

## Behavior notes

- Fail-open: a git/read error passes rather than blocks.
- Fires only for PRs created inside the repo (follows `cd` in the command).
- Tiers are independent — enable Tier 1 alone (cheap accounting), add 2 and 3 as the repo's discipline matures.
