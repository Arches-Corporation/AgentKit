#!/usr/bin/env bash
# AgentKit one-shot onboarding — the mechanical steps of docs/onboarding.md.
# Runs: install → init (wires guardrails, seeds telemetry, fixes gitignore)
#       → sync (skills/commands/agents + rulebook block) → doctor → verify.
#
# What it CANNOT do (by design): the §3 spec-policy tune (your ticketPattern /
# codePathPatterns / lanes — judgment) and the commit/approval (human-owned).
# It stops and tells you those.
#
# Usage:  bash scripts/onboard.sh [version]     # default version below
#   from a consumer repo:  curl -fsSL <raw-url>/scripts/onboard.sh | bash
set -euo pipefail

# Pinned to a specific release so every onboard is deterministic — the same kit
# for everyone until the team consciously bumps this line. Override per-run with
# an arg: `bash onboard.sh 2.14.0` (exact) or `bash onboard.sh '^2.14.0'` (range).
VERSION="${1:-2.13.0}"
SPEC="github:Arches-Corporation/AgentKit#semver:${VERSION}"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

command -v node >/dev/null || die "node not found — install Node ≥ 20 (nvm use)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node ${NODE_MAJOR} — need ≥ 20."

# 1. Install — detect the repo's package manager from its lockfile.
say "1/5 install ($SPEC)"
if [ -f pnpm-lock.yaml ]; then
  WORKSPACE=""; [ -f pnpm-workspace.yaml ] && WORKSPACE="-w"
  pnpm add -D $WORKSPACE "$SPEC"
elif [ -f yarn.lock ]; then
  yarn add -D "$SPEC"
else
  [ -f package.json ] || { npm init -y >/dev/null; node -e 'const f="package.json",p=require("./"+f);p.private=true;require("fs").writeFileSync(f,JSON.stringify(p,null,2))'; }
  npm i -D "$SPEC"
fi

# 2. Wire — guardrails + telemetry seed + gitignore fix (all automatic).
say "2/5 init"
npx agentkit init --tool claude

# 3. Sync — managed assets + rulebook block (skip-and-warn on unset vars).
say "3/5 sync"
npx agentkit sync

# 4-5. Prove.
say "4/5 doctor"; npx agentkit doctor
say "5/5 verify"; npx agentkit verify

cat <<'NEXT'

──────────────────────────────────────────────────────────────────────────
✓ Mechanical setup done — guardrails wired, telemetry on, rulebook block in.

Two steps are yours (they can't be scripted):

  1. TUNE the spec policy in agentkit.config.json (§3 of docs/onboarding.md):
       spec-first.ticketPattern     your Jira key (e.g. "EKB-\\d+")
       spec-first.codePathPatterns  what counts as product code (per-app in a monorepo)
       spec-first.lanes             which changes need the Full trio (migrations/endpoints)
       spec-conformance             requireAcChecklist + specSource (ticket|changed)
       skills.exclude / vars        drop what doesn't fit your stack
     Then re-run: npx agentkit init --tool claude && npx agentkit sync

  2. COMMIT + open a PR (a human owns the merge; approvals are user-only).

Verify you hit full spec-driven: docs/onboarding.md → "Definition of Done".
──────────────────────────────────────────────────────────────────────────
NEXT
