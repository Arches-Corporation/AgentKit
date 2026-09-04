Bring the whole EKB local stack up/down using the apps' own docker-compose files.

Run from the EKB root:

```bash
scripts/run.sh up      # start BE (db/redis/es/web :3001/sidekiq) + FE portals (admin :3000, client :3002)
scripts/run.sh stop    # idle containers, keep data
scripts/run.sh down    # remove containers, keep volumes
```

$ARGUMENTS selects the action (`up`, `stop`, `down`; default `up`).

After `up`:
- Admin  → http://localhost:3000/admin/login
- Client → http://localhost:3002/login
- BE API → http://localhost:3001 (health: `/healthcheck`)

First-time backend DB setup (once, before the app works): `cd apps/api && bundle exec rails db:create db:schema:load db:seed`. Seeded admins have no roles — grant one via `rails runner` (see gotchas in `apps/web/CLAUDE.md`).
