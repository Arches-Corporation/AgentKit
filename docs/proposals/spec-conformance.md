# Proposal: spec↔code conformance — the last mile to "complete spec-driven"

**Status:** design / greenlit
**Problem:** Today the kit enforces that a spec of the right *shape* exists before code lands (spec-first + lanes). Nothing checks the code actually *matches* the spec, that ACs are *met*, or that `spec-check` was even run. That conformance layer is honor-based in every repo (EKB included) — the gap between spec-*driven at the shape level* and spec-*as-executable-contract*.
**Goal:** close it in tiers, honestly labeled by what's mechanically enforceable vs AI-judgment vs test-backed.

---

## The honest split (why this isn't one switch)

"Does the code match the spec" is an **AI-judgment** task, not a deterministic grep. So conformance can't be a single hook. It decomposes into three tiers of increasing strength + cost:

| Tier | Enforces | Mechanism | Deterministic? |
|---|---|---|---|
| **1. AC accounting** | every AC is consciously addressed in the PR | `pr-body-contract` requires the spec's ACs mirrored as a ticked checklist | ✅ yes — pure text |
| **2. Conformance review** | code actually matches the spec | `spec-check` skill promoted to a **required `/pr` step** | ⚠️ AI-judgment, gate-able via the command |
| **3. Executable ACs** | each AC proven by a passing test | AC↔test link convention + `agentkit spec-verify` + CI gate | ✅ yes — but needs per-repo test IDs |

Ship 1+2 in the kit (high value, low per-repo cost). Tier 3 is opt-in and needs a repo's test infra.

## Tier 1 — AC checklist in the PR (mechanical, ships first)

Extend `pr-body-contract` with `requireAcChecklist: true`:
- On `gh pr create`, resolve the ticket's spec dir (reuse spec-first's `specDirTemplate` + lane).
- Parse Acceptance Criteria lines from the spec (`## Acceptance Criteria` / `AC:` bullets).
- Require the PR body to carry each AC as a checklist item, **all boxes ticked** (`- [x]`). Missing/unchecked → block with the exact ACs that aren't accounted for.
- Config: `pr-body-contract.requireAcChecklist` (default off; EKB turns it on).

Effect: the author can't open a PR without explicitly claiming each AC is done. Doesn't prove correctness — proves *accounting*. Cheap, deterministic, immediate.

## Tier 2 — `spec-check` as a required gate (AI-judgment, via `/pr`)

`spec-check` exists as an optional skill. Promote it:
- `/pr` command runs `spec-check` as a **mandatory pre-flight** — reads proposal/design/AC + the diff, reports conform / deviations. Non-conformance → the command stops and surfaces them; author fixes or justifies.
- Not a deterministic hook (needs the model), so it's a **command-flow gate**, not a `PreToolUse` block. Records a `spec-check-passed` marker (like approvals) that `pr-body-contract` can require — so the gate is auditable: "PR opened without spec-check" is blockable.
- Kit change: `/pr` template gains the step; optional `pr-body-contract.requireSpecCheck` looks for the marker.

Effect: conformance review becomes non-skippable, not "run it if you remember."

## Tier 3 — executable ACs (opt-in, strongest)

The only path to true spec-as-contract. Convention + tooling:
- **AC format**: each AC carries a test ref — `- [ ] AC1: search caps at 100 results {test: e2e/search.spec.ts > "caps results"}`.
- **`agentkit spec-verify <TICKET>`**: parse ACs, resolve each `{test: …}`, run them (repo-provided test command), assert every AC has a **passing** test. Unlinked AC or failing test → non-zero.
- **CI gate**: repos wire `agentkit spec-verify` into CI on PRs touching the ticket.
- Kit ships the parser + runner contract; the repo supplies the test command + writes the test refs. Fully deterministic once ACs are linked.

Effect: a spec's ACs are executable; code can't merge unless every AC has a green test. This is "complete spec-driven."

## Rollout

- **v-next**: Tier 1 (`requireAcChecklist`) + Tier 2 (`/pr` runs spec-check + `requireSpecCheck` marker). Kit guardrail/command + tests + docs. EKB opts both on — becomes the reference for enforced conformance.
- **later**: Tier 3 as an opt-in `spec-verify` command + AC-ref convention; pilot in one repo (EKB) with a handful of ACs wired to Playwright ids.

## What "complete spec-driven" means after each tier

- Today: shape-enforced (spec must exist, right lane).
- +Tier 1: every AC accounted for in the PR.
- +Tier 2: conformance reviewed, non-skippable.
- +Tier 3: every AC proven by a test — **executable contract**. Only here is it "complete."
