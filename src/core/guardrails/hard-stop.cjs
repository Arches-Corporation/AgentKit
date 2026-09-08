'use strict';

const { gitSegments, gitSubcommand } = require('../lib/text.cjs');

const NAME = 'hard-stop';

const DEFAULTS = {
  approvalMarker: 'git-approved',
};

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd) return null;

  const segments = gitSegments(cmd, ['commit', 'push']);
  for (const seg of segments) {
    const flagsOnly = seg.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '');
    const isCommit = gitSubcommand(seg) === 'commit';
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
    // Deliberately does NOT reveal how approval is granted — the approval step
    // belongs to the human (`npx agentkit approve`), never to the agent.
    return {
      block:
        'BLOCKED: HARD STOP — never `git commit`/`git push` without explicit user approval.\n' +
        'Report what changed + the intended commit message, then STOP and wait. ' +
        'The user grants approval themselves (one-shot, consumed by the next commit/push); ' +
        'do not attempt to grant it on their behalf.',
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
