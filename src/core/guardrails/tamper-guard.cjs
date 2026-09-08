'use strict';

const path = require('path');

const NAME = 'tamper-guard';

// The enforcement layer must not be editable by the agent it polices:
// config (enabled flags), hook wiring, and the state dir (approval markers).
const PROTECTED = [
  'agentkit.config.json',
  '.agentkit/',
  '.claude/settings.json',
  '.cursor/hooks.json',
];

const DEFAULTS = {
  protect: [],
};

// Commands whose ARGUMENTS they mutate. `git add`/`commit`/`status` and other
// readers may name protected paths freely — staging the manifest for a commit
// is normal workflow, not tampering.
const MUTATION_VERBS = new Set(['touch', 'rm', 'mv', 'cp', 'chmod', 'chown', 'tee', 'truncate', 'ln', 'dd']);
const WRAPPER_WORDS = new Set(['command', 'env', 'nohup', 'nice', 'time', 'timeout', 'xargs', 'sudo', 'doas', 'setsid', 'stdbuf', 'builtin', 'exec']);

function protectedList(ctx) {
  const extra = Array.isArray(ctx.options.protect) ? ctx.options.protect : DEFAULTS.protect;
  return PROTECTED.concat(extra.filter((p) => typeof p === 'string' && p));
}

function matchProtected(candidate, list, repoRoot) {
  const raw = String(candidate);
  const rel = path.isAbsolute(raw) && repoRoot ? path.relative(repoRoot, raw) : raw;
  if (rel.startsWith('..')) return null;
  const norm = rel.replace(/^\.\//, '');
  for (const p of list) {
    if (p.endsWith('/') ? (norm === p.slice(0, -1) || norm.startsWith(p) || norm.includes('/' + p)) : (norm === p || norm.endsWith('/' + p))) {
      return p;
    }
  }
  return null;
}

// A protected path counts as MUTATED only when (a) it is an argument of a
// mutating verb leading its shell segment, (b) it is a redirect target, or
// (c) it is edited in place by `sed -i`. Mentions elsewhere (git add, cat,
// grep, `2>&1`) are allowed.
function mutatedProtectedPath(cmd, list, repoRoot) {
  for (const segment of String(cmd).split(/&&|\|\||;|\||\n/)) {
    for (const m of segment.matchAll(/(?<![\d&])>>?\s*(\S+)/g)) {
      const hit = matchProtected(m[1], list, repoRoot);
      if (hit) return hit;
    }
    const tokens = segment
      .replace(/"((?:\\.|[^"\\])*)"/g, '$1')
      .replace(/'([^']*)'/g, '$1')
      .split(/\s+/)
      .filter(Boolean);
    let i = 0;
    while (i < tokens.length && (WRAPPER_WORDS.has(tokens[i]) || /^\w+=/.test(tokens[i]))) i += 1;
    const verb = tokens[i];
    if (!verb) continue;
    const isSedInPlace = verb === 'sed' && tokens.slice(i + 1).some((t) => /^-[a-zA-Z]*i/.test(t));
    if (!MUTATION_VERBS.has(verb) && !isSedInPlace) continue;
    for (const arg of tokens.slice(i + 1)) {
      if (arg.startsWith('-')) continue;
      const hit = matchProtected(arg, list, repoRoot);
      if (hit) return hit;
    }
  }
  return null;
}

function check(event, ctx) {
  const list = protectedList(ctx);

  for (const p of event.paths) {
    const hit = matchProtected(p, list, ctx.repoRoot);
    if (hit) {
      return {
        block:
          `BLOCKED: "${p}" is part of the guardrail enforcement layer (${hit}) — agents must not modify it. ` +
          'If a config change is genuinely needed, ask the user to make it themselves.',
      };
    }
  }

  const cmd = event.command;
  if (cmd) {
    // Human-only CLI: approval must come from the user's own terminal, never
    // from an agent tool call.
    if (/\bagentkit\s+approve\b/.test(cmd)) {
      return {
        block:
          'BLOCKED: `agentkit approve` is for the USER to run in their own terminal — an agent granting ' +
          'its own approval defeats the HARD STOP. Report what needs approval and wait.',
      };
    }
    const hit = mutatedProtectedPath(cmd, list, ctx.repoRoot);
    if (hit) {
      return {
        block:
          `BLOCKED: this command modifies the guardrail enforcement layer (${hit}) — agents must not do that. ` +
          'If a change there is genuinely needed, ask the user to make it themselves.',
      };
    }
  }

  return null;
}

module.exports = {
  name: NAME,
  events: ['PreToolUse'],
  matcher: 'Edit|Write|Bash',
  failClosed: true,
  // The adapter honors this over config `enabled: false` — a guardrail whose
  // job is protecting the config cannot be switched off by editing the config.
  alwaysOn: true,
  defaults: DEFAULTS,
  check,
};
