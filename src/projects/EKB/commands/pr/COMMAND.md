Create a GitHub Pull Request in the EKB monorepo, following Arches conventions. One command for both apps — `apps/web` (FE) and `apps/api` (BE) — since the monorepo has a single PR/CI surface.

**HARD STOP:** make edits → run the checks below → stop → report → wait for explicit user approval before `git commit`/`git push`. Never bypass hooks with `--no-verify` (neither `git commit --no-verify` nor `git push --no-verify`). If a pre-commit/pre-push hook fails, fix the cause; do not skip it.

## Which checks to run (auto-detect by changed paths)

Inspect `git diff --name-only origin/develop...HEAD`:

- Touches `apps/web/**` → FE checks: `cd apps/web && npm run typecheck && CI=true npm run test:push`
- Touches `apps/api/**` → BE checks: `cd apps/api && bundle exec rubocop && bundle exec rspec`
- Touches both → run both.

All green before opening the PR. GitHub serves the shared root `.github/pull_request_template.md`.

There are three PR types depending on the target branch.

---

## Type 1 — Feature PR (→ develop)

### Steps

1. `git status` and `git log origin/$(git rev-parse --abbrev-ref HEAD)..HEAD --oneline` to see what's shipping.
2. `git diff origin/develop...HEAD` for the full change.
3. Branch name:
   - With a Jira ticket: `feature/EKB-XXXX-short-slug` (or `fix/`, `chore/`, `refactor/` prefix by change type).
   - No ticket: same prefixes + short slug only, no number.
4. If still on `develop`: create the branch, cherry-pick or reset as needed, then push.
5. Push with `-u origin <branch>`.
6. Run the auto-detected checks. Then `gh pr create --base develop` with the format below.

### PR Title

```
[Feature] EKB-XXXX Short description
```
Adjust the tag to the change type: `[Feature]`, `[Fix]`, `[Chore]`, `[Refactor]`. Drop `EKB-XXXX` if there is no ticket.

### PR Body template

```markdown
# Description

- https://arches-global.atlassian.net/browse/EKB-XXXX
  - #<linked or promoted PR number>   <!-- nest related/promoted PRs under the ticket; omit if none -->

(remove the bullet if no ticket)

<!-- If this PR closes a Sentry issue, add a line `Fixes EKB-PRODUCTION-XX` here to auto-close it on merge. Omit if not Sentry-sourced. -->

## Type of change

Please check options that are relevant.

- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Bug fix
- [ ] Refactor: A code change that neither fixes a bug nor add a feature
- [ ] Test: Add missing tests or correct existing tests
- [ ] Perf: A code change that improves performance
- [ ] Config: Update CI/CD or additional settings
- [ ] Docs: Document change only

# How Has This Been Tested?

(describe manual testing steps or attach a video/screenshot; for FE, note any video in `apps/web/test-results/`)

# Checklist:

- [ ] Your works
```

Fill in the checkboxes by the actual change type.

---

## Type 2 — Staging release PR (release-staging branch → staging)

> Promotes the WHOLE repo (both apps together); CI/CD deploys only the app(s) whose files changed (path-filtered).

Staging is behind develop. Do NOT merge develop directly into staging — cherry-pick the commits onto a release branch first, then open this PR.

**Release naming:** branch and title are date-only — `release-staging-YYYY-MM-DD` / `[Release] Staging YYYY-MM-DD`, never a descriptive slug. If a staging release already shipped that day, append an uppercase roman-numeral suffix to **both** branch and title (`-II`, `-III`, …; the first, unlabeled one is `I`). Check first: `git branch -r | grep release-staging-YYYY-MM-DD`.

### Steps

1. Checkout from `staging` and cherry-pick the desired commits:
   ```bash
   git checkout staging
   git checkout -b release-staging-YYYY-MM-DD
   git cherry-pick <commit1> <commit2> ...
   git push -u origin release-staging-YYYY-MM-DD
   ```
2. Get the description from the corresponding feature PR(s) on `develop`.
3. `gh pr create --base staging --head release-staging-YYYY-MM-DD`.

### PR Title

```
[Release] Staging YYYY-MM-DD
```

### PR Body

Full template (Description / Type of change / How Has This Been Tested / Checklist). In **Description**, list each Jira ticket with its merged feature PR number(s) nested:

```markdown
# Description

- https://arches-global.atlassian.net/browse/EKB-XXXX
  - #<feature PR merged to develop>
```

Under **How Has This Been Tested?**, carry the feature PR(s)' test notes as bullets.

---

## Type 3 — Production release PR (release-prod branch → master)

> Promotes the WHOLE repo (both apps together); CI/CD deploys only the app(s) whose files changed (path-filtered).

Same flow as staging but targeting `master`. Same **release naming** rule: `release-prod-YYYY-MM-DD` / `[Release] Production YYYY-MM-DD`, date-only, roman-numeral suffix (`-II`, `-III`, …) on both branch and title for same-day multiples.

### Steps

1. Checkout from `master` and cherry-pick the desired commits:
   ```bash
   git checkout master
   git checkout -b release-prod-YYYY-MM-DD
   git cherry-pick <commit1> <commit2> ...
   git push -u origin release-prod-YYYY-MM-DD
   ```
2. Get the description from the corresponding feature PR(s) on `develop`.
3. `gh pr create --base master --head release-prod-YYYY-MM-DD`.

### PR Title

```
[Release] Production YYYY-MM-DD
```

### PR Body

Same structure as the staging release PR. Under **How Has This Been Tested?**, add a bullet referencing the staging promotion PR (e.g. `Same commit set promoted to staging via #<staging PR>`).
