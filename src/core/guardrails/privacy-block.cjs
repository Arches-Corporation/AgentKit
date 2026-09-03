'use strict';

const { hasApproval, sensitiveTokensInCommand } = require('../lib/text.cjs');

const NAME = 'privacy-block';

const DEFAULTS = {
  sensitive: [
    '\\.env$',
    '\\.env\\.',
    '\\.pem$',
    '\\.key$',
    '\\.p12$',
    '\\.pfx$',
    'id_rsa',
    'credentials?\\.(ya?ml|json|enc|txt)',
    'secrets?\\.(ya?ml|json|enc|txt)',
  ],
  safe: ['\\.env\\.example$', '\\.env\\.sample$', '\\.env\\.template$'],
};

function check(event, ctx) {
  const opts = Object.assign({}, DEFAULTS, ctx.options);
  const sensitive = opts.sensitive.map((r) => new RegExp(r, 'i'));
  const safe = opts.safe.map((r) => new RegExp(r, 'i'));

  const candidates = event.paths.slice();
  if (event.command) candidates.push(...sensitiveTokensInCommand(event.command));

  for (const raw of candidates) {
    if (hasApproval(raw)) continue;
    const p = String(raw);
    const base = p.split('/').pop();
    if (safe.some((r) => r.test(p) || r.test(base))) continue;
    if (sensitive.some((r) => r.test(p) || r.test(base))) {
      return {
        block:
          `BLOCKED: "${p}" may hold secrets. Get user approval, then retry with an APPROVED: prefix ` +
          `(e.g. "APPROVED:${p}"). Never commit secrets — use .env (gitignored) / .env.example.`,
      };
    }
  }

  return null;
}

module.exports = {
  name: NAME,
  events: ['PreToolUse'],
  matcher: 'Read|Edit|Write|Bash',
  failClosed: true,
  defaults: DEFAULTS,
  check,
};
