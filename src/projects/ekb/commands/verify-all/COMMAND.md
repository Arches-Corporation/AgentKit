Run the EKB verification gate: both apps' own checks (FE typecheck + tests, BE rubocop + rspec), aggregated into one pass/fail.

Run from the EKB root:

```bash
scripts/verify-all.sh          # both apps (default)
scripts/verify-all.sh fe       # frontend only (apps/web)
scripts/verify-all.sh be       # backend only (apps/api)
```

$ARGUMENTS selects the scope (`fe`, `be`, or empty for both). Exit code is non-zero if either side fails. On failure, read only the failing app's output summary, then fix inside that app directory (or dispatch the matching subagent) — do not touch the other app.
