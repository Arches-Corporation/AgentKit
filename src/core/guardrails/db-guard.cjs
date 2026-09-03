'use strict';

const NAME = 'db-guard';

const BUILT_IN = [
  { pattern: '\\brails\\s+db:(drop|reset|migrate:reset|schema:load)\\b', label: 'destructive rails db task' },
  { pattern: '\\brake\\s+db:(drop|reset|migrate:reset|schema:load)\\b', label: 'destructive rake db task' },
  { pattern: '\\bDROP\\s+(DATABASE|SCHEMA|TABLE)\\b', label: 'SQL DROP statement' },
  { pattern: '\\bTRUNCATE\\s+(TABLE\\s+)?\\w', label: 'SQL TRUNCATE statement' },
  { pattern: '\\bprisma\\s+migrate\\s+reset\\b', label: 'prisma migrate reset' },
  { pattern: 'docker\\s+compose\\s+down[^|;&]*\\s-v\\b', label: 'docker compose down -v (wipes volumes)' },
];

const DEFAULTS = {
  extraPatterns: [],
  approvalMarker: 'db-approved',
};

function check(event, ctx) {
  const cmd = event.command;
  if (!cmd) return null;

  const opts = Object.assign({}, DEFAULTS, ctx.options);
  const rules = BUILT_IN.concat(opts.extraPatterns || []).map((r) => ({
    re: new RegExp(r.pattern, r.flags || 'i'),
    label: r.label || 'configured destructive pattern',
  }));

  for (const { re, label } of rules) {
    if (re.test(cmd)) {
      if (ctx.markers.consume(opts.approvalMarker)) return null;
      return {
        block:
          `BLOCKED: command matches a destructive database operation (${label}) — potential data loss. ` +
          'If genuinely intended (local dev reset), get user approval, then have them run:\n' +
          `  touch "${ctx.markers.markerPath(opts.approvalMarker)}"\n` +
          'and retry (marker is one-shot).',
      };
    }
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
