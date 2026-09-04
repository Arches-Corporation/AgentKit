# Skill: performance-optimization

Focused **backend performance review** for `{{beDir}}` ({{beStack}}). Run when a change adds queries, serializers, list endpoints, background jobs, or data-migration tasks — anywhere that scales with row count. Reviewer ≠ author.

## When to run
- New/changed list/index endpoints, serializers with relationships, `.map`/`.each` over associations, `lib/tasks/*.rake` data jobs, Sidekiq workers, or searchkick reindex paths.
- {{scaleNote}}

## Input
- The diff + spec + AC. Bullet is available in `:development` (`bundle exec` with Bullet enabled surfaces N+1s in specs/logs).

## Steps
1. Scan the diff for the smells below.
2. For each: `path:line severity: problem. fix.` with the concrete rewrite.
3. Verifier pass → `[confirmed]`/`[rejected]`. Group by severity.

## Smells + fixes

| # | Smell | Fix |
|---|---|---|
| 1 | **N+1 query** — association accessed in a loop / serializer without preload | Preload it; verify with Bullet. Choose the right loader ↓ |
| 2 | **Wrong eager-load** | `includes` (lets AR pick) · `preload` (separate queries, no WHERE on assoc) · `eager_load` (LEFT JOIN, needed when filtering/ordering by the assoc) · `joins` (filter only, no hydration). Don't `includes` + reference without `references`. |
| 3 | **Serializer N+1** — `jsonapi-serializer` relationships not preloaded | Preload all `has_many`/`belongs_to` the serializer renders before serialization. |
| 4 | **Unbounded query** — `where(id: huge_array)` / `.all.each` loading everything | Cap the set; batch with `find_each`/`in_batches` (500–2000); paginate (Pagy). |
| 5 | **Count/exists misuse** — `.count` in a loop, `.present?`/`.any?` loading records to test existence | `exists?`; hoist counts; `size` on a loaded relation. |
| 6 | **Over-selection** — `SELECT *` when few columns needed for a large scan | `select(:a, :b)` / `pluck` for scalar lists. |
| 7 | **Missing index** — FK or frequently-filtered column unindexed | Add index in a migration (reversible; `algorithm: :inplace`/instant DDL where possible). |
| 8 | **Sync heavy work in request** — reindex, export, external API in the request cycle | Move to a Sidekiq worker; return early. |
| 9 | **searchkick reindex cost** — full `Model.reindex` on a hot path or per-record on save | Scope the reindex; make single-record reindex async + non-fatal on ES timeout {{reindexRefs}}. |
| 10 | **acts_as_paranoid scans** — `default_scope` `WHERE deleted_at IS NULL` on an unindexed column at scale | Ensure `deleted_at` (composite) index for hot queries. |
| 11 | **Memory bloat in tasks** — building giant arrays / `map` over full tables | Stream with `find_each`; avoid materializing whole tables; idempotent, re-runnable tasks. |

## Output
Severity-tagged findings (`path:line severity: problem. fix.`) + verdict. **critical** = will fall over at scale (unbounded/N+1 on a hot path); **major** = notable regression; **minor** = micro-opt. Clean → say so.
