# Skill: design-check

Design-system conformance gate for **FE visual diffs** — a change that adds or restyles a page/component in `apps/web/`. Authority: `EKB/docs/architecture/design-system.md`.

Runs standalone before a FE PR, and is the concrete checklist behind `deep-review` dimension 14. Reviewer ≠ author still applies (run in a context that did not write the diff).

## When to run
- FE ticket that renders or restyles UI (new page/component, layout/style change).
- **Skip** for pure logic/data/API changes with no visual surface — say so in one line, don't pad.

## Input
- The FE diff / changed files under `apps/web/`.
- The spec's **Design system** section (Full lane `design.md`, or `spec.md` for Light) — see `EKB/docs/specs/features/_SNIPPET-design-system.md`.
- `EKB/docs/architecture/design-system.md` (§3–§8 tables).

## Two tiers
The token layer is documented but not yet migrated into code, so enforce by tier:
- **Now (pre-migration):** the *don't-worsen* checks (A–D below) are hard failures. Semantic-token usage is checked at the **spec** level — did `design.md` name the semantic intent — not yet in the component CSS.
- **Post-migration** (once `--color-*` / `--space-*` exist in code): also enforce E — components consume semantic tokens only; a raw hex/px or primitive ref for a covered value is a failure.

## Checks

**A. No new raw color/spacing in components.** Scan added lines in `*.scss`/`*.tsx` under `apps/web/src/components|modules|pages`:
```bash
# added hardcoded colors in a component (flag for review)
git diff --unified=0 -- 'apps/web/src/**/*.scss' 'apps/web/src/**/*.tsx' \
  | grep -E '^\+' | grep -iE '#[0-9a-f]{3,8}\b|rgba?\('
```
Each hit: is there already a var/token for this value? If yes → failure (use it). If it's a genuinely new color → escalate (needs a design-system entry, not an inline hex).

**B. No new var for an existing shade.** If the diff adds a line to `src/styles/variables.scss` or `src/constants/colors.ts`:
```bash
git diff -- 'apps/web/src/styles/variables.scss' 'apps/web/src/constants/colors.ts' | grep -E '^\+'
```
Cross-check the added hex against the palette in design-system.md §3.1. Duplicate/near-duplicate of an existing primitive → failure (reuse it). This is how 160+ vars accrued — hold the line.

**C. Canonical component reused.** New component file under `src/components/`? Check design-system.md §8 catalog — does a canonical component for this role already exist (table, modal, select, badge, articleItem, pagination, spinner…)? If yes and the diff forks a near-duplicate → failure (reuse / extend props instead).

**D. No new naming scheme / no direct bootstrap-var ref.** Added component styles referencing `$primary` (or other bootstrap vars) directly, or introducing a new color-naming convention → failure.

**E. (Post-migration only) Semantic tokens only.** Component CSS uses `--color-*` / `--space-*` / `--radius-*` / `--font-*` / `--elevation-*` / `--z-*` — never a primitive (`--orange-500`), raw hex, or bare px for a covered value.

**F. Spec match.** Components/tokens in the diff match what the spec's Design-system section declared. Undeclared new component/token, or a declared one missing → failure.

## Output
Same format as `deep-review`. One line per finding:
```
path:line severity: problem. fix.
```
Severity: `major` for a new raw value / forked component / undeclared addition; `minor` for a style that should use an existing scale but is harmless. Clean → say so in one line; do not enumerate passing checks.

## Anti-self-approval
If you wrote the diff, hand off to a fresh context. Reviewer ≠ author.
