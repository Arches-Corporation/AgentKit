# Skill: pr-review

Standard PR checklist before requesting human review.

## Steps

1. **Open PRs via the unified command** — use `/pr` (it auto-detects the changed app(s) and runs their checks). Do NOT hand-roll `gh pr create` for app changes. It produces the required title + body.
   - **App-scoped PR title/body** follow the app's `.github/pull_request_template.md` (title `feature/<TICKET-ID> Short description` or matching `fix/`,`chore/`,`refactor/` prefix; body = `# Description` with the Jira link, `## Type of change`, `# How Has This Been Tested?`, `# Checklist:`). Verify the body matches that template.
   - **Workspace-layer PR** (docs/tooling/agentic changes outside `apps/`) uses `type(TICKET-ID): description` (`feat`/`fix`/`chore`/`docs`/`refactor`/`test`) with an AC checklist.
2. **Target branch** — `{{targetBranch}}`. Never a release branch directly.
3. **Spec** — `{{specDirDisplay}}/` exists with proposal + design + tasks.
4. **AC coverage** — PR body lists each acceptance criterion from spec as a checklist item; each marked done.
5. **Tests** — all tests green. Bug fix includes regression test.
6. **Typecheck + lint** — {{checksLine}} clean.
7. **deep-review** — `deep-review` skill run; all `critical` findings resolved; `major` findings resolved or accepted with reason.
8. **Scope** — diff matches spec; no unrelated changes.
9. **Secrets** — no `.env` values, tokens, passwords, or API keys in diff.

## Output
```
PR checklist for <TICKET-ID>:
  [x] Title format correct
  [x] Target: {{targetBranch}}
  [x] Spec complete
  [x] AC covered in body
  [x] Tests green (N examples, 0 failures)
  [x] Typecheck + lint clean
  [x] deep-review run — 0 critical, 0 major
  [x] No scope creep
  [x] No secrets in diff
```
