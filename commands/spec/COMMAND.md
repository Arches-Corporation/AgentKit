Scaffold the spec directory for a ticket, in the correct lane, before writing code — the spec-first discipline (no code without a spec).

## Usage

`/spec <TICKET>` — e.g. `/spec EKB-1234`. Add `--full` or `--light` to force a lane; omit to auto-detect from what's staged.

## What it does

Runs `npx agentkit spec <TICKET>`:
- **Auto-detects the lane** from staged/changed files using the same rules the `spec-first` guardrail enforces. A change touching migrations, routes, controllers, or services → **Full lane** (`proposal.md` + `design.md` + `tasks.md`); anything smaller → **Light lane** (`spec.md`).
- Creates the ticket dir (`docs/specs/features/<TICKET>/` by default) and writes the lane's templated files, pre-filled with the ticket id, link, and What/Why/AC headings.
- **Idempotent** — never overwrites a file that already exists; reports created vs kept.

## Steps

1. Run `npx agentkit spec <TICKET>` (pass `--full`/`--light` only to override the detected lane).
2. Fill in each generated file — real What / Why / Acceptance Criteria, and (Full lane) the design + tasks. Implement only what the spec says.
3. Stage the spec alongside your code. `spec-first` blocks the commit until the lane's required files exist — the scaffold guarantees the right shape.

If the change genuinely needs no spec (trivial/exempt), the block message tells you the user-only approval path — do not scaffold a hollow spec to satisfy the gate.
