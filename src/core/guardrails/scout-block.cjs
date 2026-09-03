'use strict';

const fs = require('fs');
const path = require('path');
const { hasApproval, stripApproval, commandTargets } = require('../lib/text.cjs');

const NAME = 'scout-block';

const DEFAULTS = {
  ignoreFile: '.ckignore',
  fallbackDirs: ['node_modules', 'dist', 'build', '.next', 'coverage', 'vendor'],
};

function ignoredDirs(repoRoot, opts) {
  try {
    return fs.readFileSync(path.join(repoRoot, opts.ignoreFile), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/\/+$/, ''));
  } catch {
    return opts.fallbackDirs;
  }
}

function ignoredSegment(target, dirs, repoRoot) {
  const clean = stripApproval(target);
  const abs = path.isAbsolute(clean) ? clean : path.resolve(repoRoot, clean);
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const segs = rel.split(path.sep).filter(Boolean);
  return segs.find((s) => dirs.includes(s)) || null;
}

function check(event, ctx) {
  const opts = Object.assign({}, DEFAULTS, ctx.options);
  const repoRoot = ctx.repoRoot;
  const dirs = ignoredDirs(repoRoot, opts);

  const targets = event.paths.slice();
  if (event.command) targets.push(...commandTargets(event.command));

  for (const raw of targets) {
    if (hasApproval(raw)) continue;
    const hit = ignoredSegment(raw, dirs, repoRoot);
    if (hit) {
      return {
        block:
          `BLOCKED: "${hit}/" is an ignored dir (${opts.ignoreFile}) — reading it floods context with ` +
          'generated/vendored files. Search the source instead, or retry a single file with an ' +
          'APPROVED: prefix if you truly need it.',
      };
    }
  }

  return null;
}

module.exports = {
  name: NAME,
  events: ['PreToolUse'],
  matcher: 'Read|Bash',
  failClosed: false,
  defaults: DEFAULTS,
  check,
};
