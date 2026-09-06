'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function gitBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function check(event, ctx) {
  const cwd = event.cwd || ctx.repoRoot;
  const branch = gitBranch(cwd);
  const m = branch && branch.match(/\bEKB-\d+\b/i);
  const raw = event.raw || {};
  const snap = {
    ts: new Date().toISOString(),
    branch: branch || null,
    ticket: m ? m[0].toUpperCase() : null,
    cwd,
    transcript: typeof raw.transcript_path === 'string' ? raw.transcript_path : null,
    trigger: typeof raw.trigger === 'string' ? raw.trigger : null,
  };
  const target = ctx.markers.markerPath('session-latest.json');
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(snap));
  } catch { /* capture is best-effort */ }
  return null;
}

module.exports = {
  name: 'precompact-capture',
  events: ['PreCompact'],
  matcher: null,
  failClosed: false,
  defaults: {},
  check,
};
