'use strict';

const path = require('path');
const {
  isPrCreate, effectiveDir, resolveBody, currentBranch, ticketFromBranch, specAcs,
  acsFromFiles, baseFromPrCreate, changedSpecFiles, normalizeAc,
} = require('../lib/pr.cjs');

const NAME = 'spec-conformance';

// Part 3 of spec-driven: at `gh pr create`, hold the PR to the ticket's spec.
//   requireAcChecklist — every Acceptance Criterion in the spec must appear,
//                        ticked, in the PR body (Tier 1 — deterministic).
//   requireSpecCheck   — the spec-check review marker must exist (Tier 2 —
//                        proves the AI conformance review actually ran).
const DEFAULTS = {
  requireAcChecklist: false,
  requireSpecCheck: false,
  specCheckMarker: 'spec-check-passed',
  ticketPattern: '[A-Z][A-Z0-9]+-\\d+',
  specDirTemplate: 'docs/specs/features/{ticket}',
  // How the ticket's spec is located:
  //   'ticket'  — a ticket dir (spec-first model). Needs a ticket in the branch.
  //   'changed' — the spec files this PR adds/changes (spec-in-commit model),
  //               found via git diff vs the PR base, filtered by specPathPattern.
  specSource: 'ticket',
  specPathPattern: '^docs/(features|tasks|enhancements)/',
  baseBranch: '',
};

function check(event, ctx) {
  const cmd = event.command;
  if (!isPrCreate(cmd)) return null;

  const opts = Object.assign({}, DEFAULTS, ctx.options);
  if (!opts.requireAcChecklist && !opts.requireSpecCheck) return null;

  // Only act on PRs created inside this repo.
  const dir = effectiveDir(cmd, event.cwd);
  const rel = path.relative(ctx.repoRoot, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  const changed = opts.specSource === 'changed';
  const ticket = changed ? null : ticketFromBranch(currentBranch(ctx.repoRoot), opts.ticketPattern);
  if (!changed && !ticket) return null; // ticket mode, no ticket → spec-first governs
  const label = ticket || 'this PR';

  // Tier 2 — the conformance review must have run.
  if (opts.requireSpecCheck && !ctx.markers.exists(opts.specCheckMarker)) {
    return {
      block:
        `BLOCKED: spec-conformance — open this PR only after the spec-check review. ` +
        `Run the spec-check skill for ${label}; it records the review, then retry. ` +
        `(No code↔spec review on record for ${label}.)`,
    };
  }

  // Tier 1 — every AC accounted for, ticked, in the PR body.
  if (opts.requireAcChecklist) {
    let acs;
    let where;
    if (changed) {
      const base = opts.baseBranch || baseFromPrCreate(cmd) || 'origin/HEAD';
      const files = changedSpecFiles(ctx.repoRoot, base, opts.specPathPattern);
      acs = acsFromFiles(ctx.repoRoot, files);
      where = files.length ? files.join(', ') : 'the spec added in this PR';
    } else {
      const specDirRel = opts.specDirTemplate.replace('{ticket}', ticket);
      acs = specAcs(ctx.repoRoot, specDirRel);
      where = `${specDirRel}/`;
    }
    if (!acs.length) return null; // no ACs to enforce

    const body = resolveBody(cmd, dir);
    if (body === null) {
      return {
        block:
          `BLOCKED: spec-conformance — the PR body must mirror ${label}'s Acceptance Criteria as a ticked ` +
          `checklist. Use --body-file/--body so the ACs can be verified.`,
      };
    }
    const bodyTicked = new Set(
      body.split('\n')
        .map((l) => l.match(/^\s*[-*]\s*\[[xX]\]\s*(.+?)\s*$/))
        .filter(Boolean)
        .map((m) => normalizeAc(m[1]))
    );
    const unmet = acs.filter((ac) => !bodyTicked.has(ac.text));
    if (unmet.length) {
      const sample = unmet.slice(0, 4).map((a) => `“${a.text}”`).join('; ') + (unmet.length > 4 ? ' …' : '');
      return {
        block:
          `BLOCKED: spec-conformance — ${unmet.length} of ${acs.length} Acceptance Criteria for ${label} ` +
          `are not accounted for in the PR body as ticked (\`- [x]\`) items: ${sample}. ` +
          `Mirror each AC from ${where} and check it off, or fix the code first.`,
      };
    }
  }

  return null;
}

module.exports = {
  name: NAME,
  events: ['PreToolUse'],
  matcher: 'Bash',
  failClosed: false,
  defaults: DEFAULTS,
  check,
};
