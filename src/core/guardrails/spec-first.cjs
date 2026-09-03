'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NAME = 'spec-first';

const DEFAULTS = {
  approvalMarker: 'spec-approved',
  ticketPattern: '[A-Z][A-Z0-9]+-\\d+',
  codePathPatterns: ['^(src|app|lib)/'],
  specDirTemplate: 'docs/specs/features/{ticket}',
};

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd || !/\bgit\s+commit\b/.test(cmd)) return null;

  const opts = Object.assign({}, DEFAULTS, ctx.options);
  if (ctx.markers.consume(opts.approvalMarker)) return null;

  let repoRoot;
  try {
    repoRoot = git('rev-parse --show-toplevel', event.cwd || process.cwd());
  } catch {
    return null;
  }
  if (!repoRoot) return null;

  const staged = git('diff --cached --name-only', repoRoot).split('\n').filter(Boolean);
  if (!staged.length) return null;

  const codeRes = opts.codePathPatterns.map((p) => new RegExp(p));
  const code = staged.filter((f) => codeRes.some((re) => re.test(f)));
  if (!code.length) return null;

  const branch = git('rev-parse --abbrev-ref HEAD', repoRoot);
  const ticketRe = new RegExp(`\\b${opts.ticketPattern}\\b`, 'i');
  const m = branch.match(ticketRe);
  const ticket = m ? m[0].toUpperCase() : null;
  const sample = code.slice(0, 3).join(', ') + (code.length > 3 ? ', …' : '');
  const markerHint = `  touch "${ctx.markers.markerPath(opts.approvalMarker)}"\nthen re-commit (marker is one-shot).`;

  if (!ticket) {
    return {
      block:
        `BLOCKED: spec-first — product code staged (${sample}) on a branch with no ticket ` +
        `("${branch}"). Rule: no code without a spec. Create the ticket + spec first, ` +
        `or (if genuinely exempt) run:\n${markerHint}`,
    };
  }

  const specDir = path.join(repoRoot, opts.specDirTemplate.replace('{ticket}', ticket));
  let hasSpec = false;
  try { hasSpec = fs.readdirSync(specDir).some((f) => f.endsWith('.md')); } catch { hasSpec = false; }

  if (!hasSpec) {
    return {
      block:
        `BLOCKED: spec-first — product code for ${ticket} staged (${sample}) but ` +
        `${opts.specDirTemplate.replace('{ticket}', ticket)}/ has no spec. Rule: no code without ` +
        `a spec (write it first). Stage the spec in this commit, or (if genuinely exempt) run:\n${markerHint}`,
    };
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
