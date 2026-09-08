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

const MUTATION_RE = /(?:^|[\s;&|])(?:touch|rm|mv|cp|chmod|chown|tee|truncate|ln|install|dd|sed\s+(?:-[a-zA-Z]*\s+)*-i)\b|>>?/;

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
    if (MUTATION_RE.test(cmd)) {
      for (const token of cmd.split(/[\s;&|<>]+/)) {
        const hit = token && matchProtected(token, list, ctx.repoRoot);
        if (hit) {
          return {
            block:
              `BLOCKED: this command touches the guardrail enforcement layer (${hit}) — agents must not modify it. ` +
              'If a change there is genuinely needed, ask the user to make it themselves.',
          };
        }
      }
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
