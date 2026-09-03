'use strict';

const NAME = 'hard-stop';

const DEFAULTS = {
  approvalMarker: 'git-approved',
};

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd) return null;

  const isCommit = /\bgit\s+commit\b/.test(cmd);
  const shortNoVerify = isCommit && /(?:^|\s)-[a-z]*n[a-z]*\b/.test(cmd);
  if (/--no-verify\b/.test(cmd) || shortNoVerify) {
    return {
      block:
        'BLOCKED: skipping git hooks (`--no-verify` / `commit -n`) bypasses the quality gates. ' +
        'The HARD STOP rule forbids it — fix the failing hook instead of skipping it.',
    };
  }

  if (/\bgit\s+(commit|push)\b/.test(cmd)) {
    const marker = ctx.options.approvalMarker || DEFAULTS.approvalMarker;
    if (ctx.markers.consume(marker)) return null;
    return {
      block:
        'BLOCKED: HARD STOP — never `git commit`/`git push` without explicit user approval.\n' +
        'Report what changed + the intended message, wait for the user to approve, then have them run:\n' +
        `  touch "${ctx.markers.markerPath(marker)}"\n` +
        'The marker is consumed on the next git commit/push (one-shot).',
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
