# Skill: security-audit

Focused **backend security review** for `{{beDir}}` (Rails). Deeper than the security dimension of `deep-review` — run it when a change touches auth, data access, raw SQL, file handling, external input, or a new endpoint. Run in a **separate agent session** (reviewer ≠ author).

## When to run
- Any new/changed `/v1/**` endpoint, controller, policy, query, or interactor that handles external input.
- Before promoting auth/data-surface changes.
- Complements the CI static-analysis gate{{ciGateNote}} — this is the human-reasoned pass CI can't do (authorization logic, tenant isolation, business-rule bypass).

## Input
- The diff / changed files + the spec + ticket AC.
- {{beConventions}}

## Steps
1. {{staticScanStep}}
2. Review the diff against the checklist below. For each finding: `path:line severity: problem. fix.`
3. Verifier pass: re-check each finding, mark `[confirmed]` / `[rejected]`.
4. Return confirmed findings grouped by severity (**critical** blocks merge · **major** should fix · **minor** accept-with-reason).

## Checklist (OWASP-mapped)

| # | Area | Check |
|---|---|---|
| 1 | **Authorization** | Every controller action is Pundit-authorized (`authorize`/`policy_scope`). New action → matching policy method + policy spec. No action relies on the default policy. |
| 2 | **Tenant / scope isolation** | Client-scoped data filtered by the current client; admin vs client scope not crossable. No `Model.find(params[:id])` without a policy scope — could expose another tenant's record. |
| 3 | **Broken object-level access (IDOR)** | Records fetched by `params[:id]` are scoped to the authorized subject, not global. |
| 4 | **Injection** | No string-interpolated SQL (`where("... #{params}")`) — use bind params/hash conditions. No `send`/`constantize`/`eval` on user input. Brakeman SQL warnings triaged, not blindly baselined. |
| 5 | **Mass assignment** | Strong params / dry-validation contract; no `permit!`; no writing protected attributes (role, scope, price) from request params. |
| 6 | **Authentication** | Devise+JWT scope correct (`authenticate_admin!` vs `authenticate_client!`); no endpoint silently `skip_before_action :authenticate`. Internal endpoints use the `X-Internal-Token` + `secure_compare` scheme, fail-closed when token blank. |
| 7 | **Secret exposure** | No secrets in code/logs/serializers; `.env` only. No token/password/PII in a serializer's attributes or in `Rails.logger`. |
| 8 | **Sensitive data in responses** | Serializer exposes only intended fields (jsonapi-serializer `attributes`); no leaking `password_digest`, internal flags, other users' data. |
| 9 | **File handling** | Uploads validated (type/size); no path traversal in file params (Brakeman FileAccess); presigned/scoped S3 access. |
| 10 | **Soft-delete integrity** | `acts_as_paranoid` respected — no hard `delete_all`; deleted records not resurfaced by a scope that bypasses `default_scope`. |
| 11 | **Dependency** | New gem is maintained + not flagged by bundler-audit; pin sanely. |

## Output
Severity-tagged list, each `path:line severity: problem. fix.` + a one-line verdict (**SHIP** / **FIX-FIRST**). If clean, say so — don't pad. Findings feed the DoD alongside `deep-review`; a critical here blocks the PR.

## Note — two-reviewer option
For high-risk auth/data changes, pair this with `deep-review` run by a *different* agent (one best-practice lens, one rule/security lens) and reconcile conflicts before merge.
