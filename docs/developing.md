# Developing AgentKit

For engineers extending the kit — a new guardrail, a project pack for your repo (like `EKB` or `Referral-Management`), a skill/command/agent, or a fix. One walkthrough, end to end.

## Setup

```bash
git clone git@github.com:Arches-Corporation/AgentKit.git && cd AgentKit
nvm use
npm test          # node --test — everything green before you start
```

No build step; plain CommonJS. `main` is protected — all changes land via PR with CI green.

## Decide the tier

| Your rule is… | Put it in | How |
|---|---|---|
| An experiment for one repo | that repo's `.agentkit/guardrails/` | [local-guardrails.md](local-guardrails.md) — no kit change, no release |
| An established rule of one project (AIS, b2b, …) | a project pack `src/projects/<name>/` | this doc |
| Useful to every repo | a built-in (`src/core/guardrails/`) or shared asset | this doc |

Promotion path: local → pack → shared. Prototype in the repo, move it into the kit when it stabilizes, generalize when a second project wants it.

## Walkthrough: add an `arches-internal-system` project pack

**Pack name == GitHub repo name, exactly** (`src/projects/arches-internal-system` for `Arches-Corporation/arches-internal-system`). No shorthand — the name is the activation key in every consumer config.

**1. Scaffold** (inside the kit repo — the command refuses elsewhere):

```bash
npx agentkit new guardrail require-migration-note --pack arches-internal-system
```

Creates `src/projects/arches-internal-system/require-migration-note.cjs` with the contract stub. Pack dirs are auto-discovered — no registration for packs (built-ins DO need a line in `src/core/registry.cjs`).

**2. Write the check.** Contract (identical at every tier, full field reference in [local-guardrails.md](local-guardrails.md)):

```js
module.exports = {
  name: 'require-migration-note',
  events: ['PreToolUse'],        // or UserPromptSubmit / SessionStart / PreCompact
  matcher: 'Bash',               // Claude tool matcher; null = all
  failClosed: false,             // true = an internal error blocks instead of allows
  defaults: { notePath: 'docs/migrations.md' },
  check(event, ctx) {
    // return null (allow) | { block: reason } | { inject: text }
  },
};
```

Rules that keep you out of trouble:

- **Names must not collide with built-ins** — a pack guardrail named like a built-in is ignored (doctor warns). Need *different behavior* for something a built-in covers? Distinct name + the repo disables the built-in (`rm` did this: built-in `spec-first` off, pack `spec-in-commit` on).
- **Populate `defaults` for every option** — consumer config options are validated against the `defaults` keys; an option missing from `defaults` is rejected by doctor as unknown.
- **Block messages teach**: state what was blocked and the compliant next step (marker path, `APPROVED:` prefix, …). The agent reads it and self-corrects.
- **Command scanning**: match the command's *subcommand position*, not substrings — argument text mentioning a guarded word must not block (see `gitSubcommand` in `src/core/guardrails/hard-stop.cjs`). Strip heredocs/quotes where relevant (`src/core/lib/text.cjs`).

**3. Test** — `test/projects-arches-internal-system.test.cjs`, mirroring `test/projects-rm.test.cjs`: spawn the real adapter (`src/adapters/claude/run.cjs`) against a tmp repo with `{"project":"arches-internal-system"}`, assert exit 0/2 and stderr. Cover: block case, allow case, option override, "pack unavailable without project config".

```bash
npm test
```

**4. Pack assets too?** Skills/commands/agents live beside the guardrails: `src/projects/arches-internal-system/skills/<name>/SKILL.md`, `commands/<name>/COMMAND.md`, `agents/<name>/AGENT.md` — scaffold with `npx agentkit new skill <name> --pack arches-internal-system`. Template vars + install targets: [skills.md](skills.md). Update the packs table in [project-packs.md](project-packs.md).

**5. PR — the commit type sets the released version:**

| Commit subject | Release |
|---|---|
| `fix: …` / `docs: …` / `chore: …` | patch |
| `feat: …` | minor |
| `feat!: …` or `BREAKING` in body | major |

Open the PR, CI (`test.yml`) must pass, merge. **The release is automatic**: `release.yml` self-gates on the full suite, bumps the version from your commit subjects, tags, and publishes a GitHub Release. No manual versioning — but a mislabeled commit means a mislabeled release, so label honestly.

**6. Consume it.** In the AIS repo:

```bash
npm i -D "github:Arches-Corporation/AgentKit#semver:^2.3.1"    # caret picks up the new release on npm update
npx agentkit init --tool claude --project arches-internal-system   # sets "project" + wires the pack guardrails
npx agentkit verify
```

Commit the config/settings/lockfile changes as one chore PR ([onboarding.md](onboarding.md) has the full recipe if the repo is new to the kit).

## Adding a shared (built-in) guardrail

Same as above, plus: `npx agentkit new guardrail <name>` (no `--pack`), register in `src/core/registry.cjs`, add an option spec to `BUILT_IN_OPTION_SPECS` in `src/core/lib/validate.cjs` if configurable, write `docs/guardrails/<name>.md`, add the README table row. Built-ins ship to every consumer — the bar is "at least two projects want exactly this".

## Adding a shared skill / command / agent

`skills/<name>/SKILL.md` (+ optional `meta.json` for `{{var}}` defaults or a custom `installPath`), tests in `test/skills.test.cjs`, README mention. Repo-specific content belongs behind `{{vars}}` — an unresolved var fails the consumer's sync loudly, which is the design. Kinds and targets: [skills.md](skills.md).

## House rules

- Pure checks: core never reads stdin or calls `process.exit` — adapters own I/O (`docs/adapters.md`).
- Every behavior change ships a test; bug fixes ship a regression test that fails before the fix.
- A false positive found in the wild is a kit bug — fix the class in the kit, never hand-patch a consumer's synced copy (doctor treats local edits of managed assets as drift and fails).
- Verify locally with the consumer replay trick: pipe a real hook JSON into `node src/adapters/claude/run.cjs <guardrail>` with `cwd` set to a consuming repo.
