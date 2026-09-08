'use strict';

const { gitSegments } = require('../lib/text.cjs');

const NAME = 'force-push-guard';

const DEFAULTS = {
  allowForceWithLease: false,
  approvalMarker: 'force-push-approved',
};

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd) return null;

  const segments = gitSegments(cmd, ['push']);
  if (!segments.length) return null;

  const opts = Object.assign({}, DEFAULTS, ctx.options);
  for (const seg of segments) {
    const hasLease = /--force-with-lease\b/.test(seg);
    const hasForce = /--force\b(?!-with-lease)/.test(seg) || /(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*\b(?=[^-]|$)/.test(seg.replace(/--\S+/g, ''));

    if (hasLease && opts.allowForceWithLease && !hasForce) continue;
    if (!hasLease && !hasForce) continue;

    if (ctx.markers.consume(opts.approvalMarker)) continue;

    // Approval is granted by the human via `npx agentkit approve force-push-approved`
    // — the mechanism is deliberately not spelled out to the agent.
    return {
      block:
        'BLOCKED: force push rewrites remote history — data loss for everyone tracking the branch. ' +
        'If genuinely intended (own feature branch after rebase), report it and STOP; the user grants ' +
        'approval themselves (one-shot). Prefer --force-with-lease over --force.',
    };
  }

  return null;
}

module.exports = {
  name: NAME,
  events: ['PreToolUse'],
  matcher: 'Bash',
  failClosed: true,
  defaults: DEFAULTS,
  check,
};
