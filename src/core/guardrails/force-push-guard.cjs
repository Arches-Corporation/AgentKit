'use strict';

const NAME = 'force-push-guard';

const DEFAULTS = {
  allowForceWithLease: false,
  approvalMarker: 'force-push-approved',
};

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd || !/\bgit\s+push\b/.test(cmd)) return null;

  const opts = Object.assign({}, DEFAULTS, ctx.options);
  const hasLease = /--force-with-lease\b/.test(cmd);
  const hasForce = /--force\b(?!-with-lease)/.test(cmd) || /(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*\b(?=[^-]|$)/.test(cmd.replace(/--\S+/g, ''));

  if (hasLease && opts.allowForceWithLease && !hasForce) return null;
  if (!hasLease && !hasForce) return null;

  if (ctx.markers.consume(opts.approvalMarker)) return null;

  return {
    block:
      'BLOCKED: force push rewrites remote history — data loss for everyone tracking the branch. ' +
      'If genuinely intended (own feature branch after rebase), get user approval, then have them run:\n' +
      `  touch "${ctx.markers.markerPath(opts.approvalMarker)}"\n` +
      'and retry (marker is one-shot). Prefer --force-with-lease over --force.',
  };
}

module.exports = {
  name: NAME,
  events: ['PreToolUse'],
  matcher: 'Bash',
  failClosed: true,
  defaults: DEFAULTS,
  check,
};
