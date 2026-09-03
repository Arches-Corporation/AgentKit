'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED = [
  { re: /#\s*Description/i, label: '# Description' },
  { re: /##\s*Type of change/i, label: '## Type of change' },
  { re: /(?:browse\/)?EKB-\d+/i, label: 'a Jira ticket reference (EKB-XXXX)' },
];

function resolveBody(cmd, cwd) {
  const fileMatch = cmd.match(/(?:--body-file|-F)[=\s]+(['"]?)([^'"\s]+)\1/);
  if (fileMatch) {
    const p = fileMatch[2];
    const abs = path.isAbsolute(p) ? p : path.join(cwd || process.cwd(), p);
    try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  }
  const inline = cmd.match(/--body[=\s]+(['"])([\s\S]*?)\1/);
  if (inline) return inline[2];
  return null;
}

function check(event) {
  const cmd = event.command;
  if (!cmd || !/\bgh\s+pr\s+create\b/.test(cmd)) return null;

  const body = resolveBody(cmd, event.cwd);
  if (body === null) return null;

  const missing = REQUIRED.filter((r) => !r.re.test(body)).map((r) => r.label);
  if (missing.length) {
    return {
      block:
        `BLOCKED: PR body is missing required section(s): ${missing.join(', ')}. ` +
        'Use the /pr template (.github/pull_request_template.md) — Description, Type of change, ' +
        'and the EKB-XXXX ticket link are mandatory.',
    };
  }
  return null;
}

module.exports = {
  name: 'pr-body-contract',
  events: ['PreToolUse'],
  matcher: 'Bash',
  failClosed: false,
  defaults: {},
  check,
};
