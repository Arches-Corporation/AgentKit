'use strict';

const NAME = 'hard-stop';

const DEFAULTS = {
  approvalMarker: 'git-approved',
};

function gitSegments(cmd) {
  return cmd
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter((s) => /\bgit\s+(commit|push)\b/.test(s));
}

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd) return null;

  const segments = gitSegments(cmd);
  for (const seg of segments) {
    const flagsOnly = seg.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '');
    const isCommit = /\bgit\s+commit\b/.test(flagsOnly);
    const shortNoVerify = isCommit && /(?:^|\s)-[a-z]*n[a-z]*\b/.test(flagsOnly);
    if (/--no-verify\b/.test(flagsOnly) || shortNoVerify) {
      return {
        block:
          'BLOCKED: skipping git hooks (`--no-verify` / `commit -n`) bypasses the quality gates. ' +
          'The HARD STOP rule forbids it — fix the failing hook instead of skipping it.',
      };
    }
  }

  if (segments.length) {
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
