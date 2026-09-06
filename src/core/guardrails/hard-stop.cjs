'use strict';

const NAME = 'hard-stop';

const DEFAULTS = {
  approvalMarker: 'git-approved',
};

// A segment counts only when `git` is its LEADING command word (after env-var
// prefixes) AND commit/push is the SUBCOMMAND — matching "git commit/push"
// anywhere would false-block commands whose ARGUMENTS merely mention them
// (a PR body quoting the rule, node -e with the words in a string literal,
// echo of docs, `git log --grep commit`).
function gitSubcommand(segment) {
  const lead = segment.replace(/^(?:\w+=(?:"(?:\\.|[^"\\])*"|'[^']*'|\S+)\s+)+/, '');
  const tokens = lead
    .replace(/"((?:\\.|[^"\\])*)"/g, '$1')
    .replace(/'([^']*)'/g, '$1')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens[0] !== 'git') return null;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-C' || t === '-c') { i += 1; continue; }
    if (t.startsWith('-')) continue;
    return t;
  }
  return null;
}

function gitSegments(cmd) {
  return cmd
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter((s) => {
      const sub = gitSubcommand(s);
      return sub === 'commit' || sub === 'push';
    });
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
