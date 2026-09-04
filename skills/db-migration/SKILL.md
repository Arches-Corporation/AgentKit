# Skill: db-migration

Safety check before running or merging a Rails database migration.

## Steps

1. **Reversibility** — migration uses `def change` with reversible operations (add_column, add_index, create_table) OR has explicit `def up` / `def down`. Irreversible ops (`remove_column`, `change_column`, `drop_table`) require `def down` with recovery path or explicit `raise ActiveRecord::IrreversibleMigration`.

2. **Indexes** — every new foreign key column has an index. Every column added to a `WHERE`, `ORDER BY`, or `JOIN` in existing queries has an index. Check `schema.rb` after migration.

3. **Lock risk** — `ADD COLUMN` with default on large tables (>1M rows) locks in MySQL 5.x but not MySQL 8 (instant DDL). Confirm MySQL 8. `ADD INDEX` on large tables: use `algorithm: :inplace, lock: :none` or run via `pt-online-schema-change`.

4. **Data migration** — if migration backfills data, confirm it runs in batches (`in_batches`) not a single `UPDATE` across all rows.

5. **Null safety** — new `NOT NULL` columns must have a `default` or a preceding backfill migration.

6. **Test** — run `bundle exec rails db:migrate` + `bundle exec rails db:rollback` in dev to confirm round-trip. Spec the migration if it contains custom logic.

## Output
```
Migration: 20260805120000_add_internal_api_token.rb
  Reversibility: PASS (add_column — reversible)
  Indexes: PASS (no FK column added)
  Lock risk: PASS (MySQL 8, instant DDL)
  Data migration: N/A
  Null safety: PASS (column has default)
  Round-trip: PASS
```
