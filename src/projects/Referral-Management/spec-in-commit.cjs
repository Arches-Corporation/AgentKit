'use strict';

// RM spec discipline: "no product code without a spec in the same commit".
//
// On `git commit`, if product code (default: src/** excluding *.test/*.spec files)
// is staged but no spec file (default: docs/features|tasks|enhancements/**) is
// staged in the SAME commit, block — unless a one-shot approval marker is present
// (genuinely spec-exempt refactors/dep-bumps/config).
//
// RM tracks specs as date-prefixed single files under docs/features/, so there are
// no ticket folders — this deliberately differs from the built-in `spec-first`
// (ticket-in-branch + docs/specs/features/{ticket}/). A repo using this pack sets
// `spec-first: { "enabled": false }` and enables this instead.

const { execSync } = require('child_process');

const DEFAULTS = {
  approvalMarker: 'spec-approved',
  codePathPattern: '^src/(?!.*\\.(test|spec)\\.[tj]sx?$)',
  specPathPattern: '^docs/(features|tasks|enhancements)/',
};

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// Fire only when `git commit` is the actual command of a shell segment
// (ignores env-var prefixes; avoids matching "commit" inside a message/other arg).
function isGitCommit(cmd) {
  return cmd
    .split(/&&|\|\||\||;|\n/)
    .some((seg) => /^git(\s|$)/.test(seg.trim().replace(/^(?:\w+=\S+\s+)+/, '')) && /\bcommit\b/.test(seg));
}

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd || !isGitCommit(cmd)) return null;

  const opts = Object.assign({}, DEFAULTS, ctx.options);
  if (ctx.markers.consume(opts.approvalMarker)) return null;

  let repoRoot;
  try {
    repoRoot = git('rev-parse --show-toplevel', event.cwd || process.cwd());
  } catch {
    return null;
  }
  if (!repoRoot) return null;

  let staged;
  try {
    staged = git('diff --cached --name-only', repoRoot).split('\n').filter(Boolean);
  } catch {
    return null;
  }
  if (!staged.length) return null;

  const codeRe = new RegExp(opts.codePathPattern);
  const specRe = new RegExp(opts.specPathPattern);
  const code = staged.filter((f) => codeRe.test(f));
  if (!code.length) return null;
  if (staged.some((f) => specRe.test(f))) return null;

  const sample = code.slice(0, 3).join(', ') + (code.length > 3 ? ', …' : '');
  const markerHint = `  touch "${ctx.markers.markerPath(opts.approvalMarker)}"\nthen re-commit (marker is one-shot).`;
  return {
    block:
      `BLOCKED: spec-first — product code is staged (${sample}) with no spec in this commit. ` +
      'Rule: no code without a spec. Add/stage a spec under docs/features/ (or docs/tasks, ' +
      'docs/enhancements), or — if genuinely spec-exempt (refactor, dep bump, config) — run:\n' +
      markerHint,
  };
}

module.exports = {
  name: 'spec-in-commit',
  events: ['PreToolUse'],
  matcher: 'Bash',
  failClosed: false,
  defaults: DEFAULTS,
  check,
};
