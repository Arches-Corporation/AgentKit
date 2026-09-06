'use strict';

// RM PR body contract: on `gh pr create` with an explicit body, require the
// repo's mandatory template sections. When no --body/-b/--body-file/-F is given,
// GitHub applies .github/pull_request_template.md itself, so there is nothing to
// check. Required sections are configurable (defaults match RM's template).

const fs = require('fs');
const path = require('path');

function resolveBody(cmd, cwd) {
  const fileMatch = cmd.match(/(?:--body-file|-F)[=\s]+(['"]?)([^'"\s]+)\1/);
  if (fileMatch) {
    const p = fileMatch[2];
    const abs = path.isAbsolute(p) ? p : path.join(cwd || process.cwd(), p);
    try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  }
  const inline = cmd.match(/(?:--body|-b)[=\s]+(['"])([\s\S]*?)\1/);
  if (inline) return inline[2];
  return null;
}

function effectiveDir(cmd, cwd) {
  let dir = cwd || process.cwd();
  const re = /(?:^|&&|;|\|\|)\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const target = (m[1] || m[2] || m[3]).replace(/^~(?=\/|$)/, process.env.HOME || '~');
    dir = path.isAbsolute(target) ? target : path.resolve(dir, target);
  }
  return dir;
}

const DEFAULTS = {
  required: ['## Summary', '## Changes', '## Checklist'],
};

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd || !/\bgh\s+pr\s+create\b/.test(cmd)) return null;

  const dir = effectiveDir(cmd, event.cwd);
  const rel = path.relative(ctx.repoRoot, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

  const body = resolveBody(cmd, dir);
  if (body === null) return null;

  const opts = Object.assign({}, DEFAULTS, ctx.options);
  const required = Array.isArray(opts.required) ? opts.required : DEFAULTS.required;
  const missing = required.filter((section) => !body.includes(section));
  if (missing.length) {
    return {
      block:
        `BLOCKED: PR body is missing required section(s): ${missing.join(', ')}. ` +
        'Use the repo template .github/pull_request_template.md — either omit --body so GitHub ' +
        'applies the template, or include every required section.',
    };
  }
  return null;
}

module.exports = {
  name: 'pr-body-contract',
  events: ['PreToolUse'],
  matcher: 'Bash',
  failClosed: false,
  defaults: DEFAULTS,
  check,
};
