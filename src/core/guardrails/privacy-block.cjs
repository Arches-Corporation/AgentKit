'use strict';

const fs = require('fs');
const path = require('path');
const { hasApproval, stripHeredocs, sensitiveTokensInCommand } = require('../lib/text.cjs');

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

function existsNear(token, event, ctx) {
  const clean = String(token);
  if (path.isAbsolute(clean)) return fs.existsSync(clean);
  for (const base of [event.cwd, ctx.repoRoot]) {
    if (base && fs.existsSync(path.resolve(base, clean))) return true;
  }
  return false;
}

function check(event, ctx) {
  const opts = Object.assign({}, DEFAULTS, ctx.options);
  const sensitive = opts.sensitive.map((r) => new RegExp(r, 'i'));
  const safe = opts.safe.map((r) => new RegExp(r, 'i'));

  // Tool-call paths are definitively paths — strict (a Write to a NEW .env
  // must block). Command-string tokens are only path-shaped guesses: heredoc
  // bodies are stripped (always data), and a token only blocks if the file
  // actually exists — kills prose/expression false positives like `matrix.env`.
  const strict = event.paths.slice();
  const guessed = event.command ? sensitiveTokensInCommand(stripHeredocs(event.command)) : [];

  for (const [candidates, requireExists] of [[strict, false], [guessed, true]]) {
    for (const raw of candidates) {
      if (hasApproval(raw)) continue;
      const p = String(raw);
      const base = p.split('/').pop();
      if (safe.some((r) => r.test(p) || r.test(base))) continue;
      if (!sensitive.some((r) => r.test(p) || r.test(base))) continue;
      if (requireExists && !existsNear(p, event, ctx)) continue;
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
