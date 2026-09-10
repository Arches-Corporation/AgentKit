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
  requireSpecDir: true,
  hintText: '',
  // Lanes gate the *shape* of the spec (which files must exist) by what the
  // change touches. Omit to keep the legacy behavior: any single `.md` passes.
  // First lane whose `triggers` match a staged file wins; unmatched → `default`.
  lanes: null,
};

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// Which lane does this staged set fall in, and why. Returns null when lanes
// aren't configured (caller keeps the any-.md behavior). Shared with the
// `agentkit spec` scaffold so classification has one source of truth.
function classifyLane(lanes, stagedFiles) {
  if (!lanes || typeof lanes !== 'object') return null;
  const entries = Object.entries(lanes).filter(([name]) => name !== 'default');
  for (const [name, lane] of entries) {
    const triggers = (lane && Array.isArray(lane.triggers)) ? lane.triggers.map((t) => new RegExp(t)) : [];
    const hit = stagedFiles.find((f) => triggers.some((re) => re.test(f)));
    if (hit) {
      return { name, requires: requiresOf(lane), trigger: hit };
    }
  }
  const def = lanes.default || {};
  return { name: 'default', requires: requiresOf(def), trigger: null };
}

function requiresOf(lane) {
  return (lane && Array.isArray(lane.requires)) ? lane.requires.filter((f) => typeof f === 'string' && f) : [];
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
  const markerHint = `have the user run \`npx agentkit approve ${opts.approvalMarker}\` in their own terminal, then re-commit (one-shot).`;
  const hint = opts.hintText ? ` ${opts.hintText}` : '';

  if (!ticket) {
    return {
      block:
        `BLOCKED: spec-first — product code staged (${sample}) on a branch with no ticket ` +
        `("${branch}"). Rule: no code without a spec.${hint} Create the ticket + spec first, ` +
        `or (if genuinely exempt) ${markerHint}`,
    };
  }

  if (!opts.requireSpecDir) return null;

  const specDirRel = opts.specDirTemplate.replace('{ticket}', ticket);
  const specDir = path.join(repoRoot, specDirRel);
  let present = [];
  try { present = fs.readdirSync(specDir); } catch { present = []; }

  const lane = classifyLane(opts.lanes, staged);

  // Lane-aware: the change's lane dictates exactly which files must exist.
  if (lane && lane.requires.length) {
    const missing = lane.requires.filter((f) => !present.includes(f));
    if (missing.length) {
      const why = lane.trigger
        ? `${lane.name} lane (triggered by \`${lane.trigger}\`)`
        : `${lane.name} lane`;
      return {
        block:
          `BLOCKED: spec-first — product code for ${ticket} staged (${sample}) is a ${why}, ` +
          `which requires ${lane.requires.join(', ')} in ${specDirRel}/ — missing: ${missing.join(', ')}. ` +
          `Scaffold with \`npx agentkit spec ${ticket}\`, fill it in, and stage it.${hint} ` +
          `Or (if genuinely exempt) ${markerHint}`,
      };
    }
    return null;
  }

  // Legacy (no lanes configured): any single `.md` satisfies the gate.
  if (!present.some((f) => f.endsWith('.md'))) {
    return {
      block:
        `BLOCKED: spec-first — product code for ${ticket} staged (${sample}) but ` +
        `${specDirRel}/ has no spec. Rule: no code without a spec (write it first).${hint} ` +
        `Scaffold with \`npx agentkit spec ${ticket}\` and stage it, or (if genuinely exempt) ${markerHint}`,
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
  classifyLane,
};
