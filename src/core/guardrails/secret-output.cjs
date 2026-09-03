'use strict';

const NAME = 'secret-output';

const BUILT_IN = [
  { re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, label: 'private key block' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { re: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/i, label: 'inline credential' },
];

const DEFAULTS = {
  extraPatterns: [],
};

function check(event, ctx) {
  const text = event.prompt;
  if (!text) return null;

  const extra = (ctx.options.extraPatterns || []).map((p) => ({
    re: new RegExp(p.pattern, p.flags || ''),
    label: p.label || 'configured secret pattern',
  }));

  for (const { re, label } of BUILT_IN.concat(extra)) {
    if (re.test(text)) {
      return {
        block:
          `BLOCKED: submitted text contains what looks like a ${label}. Remove the secret and use ` +
          'a placeholder or an env-var reference — no secrets in code or markdown.',
      };
    }
  }

  return null;
}

module.exports = {
  name: NAME,
  events: ['UserPromptSubmit'],
  matcher: null,
  failClosed: true,
  defaults: DEFAULTS,
  check,
};
