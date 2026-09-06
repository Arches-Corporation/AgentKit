'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const REMINDER = [
  'EKB rules (AGENTS.md): spec before code (docs/specs/features/<TICKET>/).',
  'Boundary lock: FE work stays in apps/web, BE in apps/api — never both in one session.',
  'HARD STOP: no git commit/push or --no-verify without explicit user approval.',
  'Before PR: typecheck + lint + tests green; run deep-review; open via /pr.',
].join(' ');

function appFromPath(p) {
  if (!p || typeof p !== 'string') return null;
  if (/(?:^|\/)apps\/web(?:\/|$)/.test(p)) return 'web';
  if (/(?:^|\/)apps\/api(?:\/|$)/.test(p)) return 'api';
  return null;
}

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
  const sid = event.sessionId ? event.sessionId.replace(/[^\w-]/g, '') : '';
  if (sid) {
    const marker = `reminder-${sid}`;
    if (ctx.markers.exists(marker)) return null;
    ctx.markers.place(marker);
  }
  const cwd = event.cwd || ctx.repoRoot;
  const branch = gitBranch(cwd);
  const m = branch && branch.match(/\bEKB-\d+\b/i);
  const app = appFromPath(cwd);
  let head = '';
  if (app) head += `Context: apps/${app} (${app === 'api' ? 'BE' : 'FE'} rules apply). `;
  if (m) head += `Ticket ${m[0].toUpperCase()}. `;
  return { inject: head + REMINDER };
}

module.exports = {
  name: 'dev-rules-reminder',
  events: ['UserPromptSubmit'],
  matcher: null,
  failClosed: false,
  defaults: {},
  check,
};
