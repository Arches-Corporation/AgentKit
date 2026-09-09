'use strict';

const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { createUsageLog, lastExportAgeMs, markExported, EXPORT_INTERVAL_MS } = require('../lib/usage.cjs');

const DEFAULTS = {
  sinkMode: 'none',
  sinkPath: '',
  sinkUrl: '',
  sinkAuthTokenEnv: '',
  otelEndpoint: '',
  otelHeaders: [],
  otelAuthTokenEnv: '',
};

const COMMAND_RE = /^\/([a-z0-9][a-z0-9:_-]*)/i;

function resolveStateDir(ctx) {
  if (typeof ctx.stateDirPath === 'string' && ctx.stateDirPath) return ctx.stateDirPath;
  if (ctx.markers && typeof ctx.markers.markerPath === 'function') {
    return path.dirname(ctx.markers.markerPath('usage'));
  }
  return null;
}

function resolveUser(repoRoot) {
  try {
    const email = execFileSync('git', ['config', 'user.email'], {
      cwd: repoRoot,
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (email) return email;
  } catch { /* no git or no email configured */ }
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

// Extracts ONLY the asset name from the tool input — everything else in
// tool_input (prompts, args, descriptions) is deliberately never read into
// the record. See docs/telemetry.md for the privacy boundary.
function recordFor(event) {
  if (event.hookEvent === 'SessionStart') return { event: 'session_start' };
  if (event.hookEvent === 'PostToolUse') {
    const ti = (event.raw && event.raw.tool_input) || {};
    if (event.toolName === 'Skill') {
      return { event: 'skill', name: typeof ti.skill === 'string' ? ti.skill : '' };
    }
    if (event.toolName === 'Task' || event.toolName === 'Agent') {
      return { event: 'agent', name: typeof ti.subagent_type === 'string' ? ti.subagent_type : '' };
    }
    return null;
  }
  if (event.hookEvent === 'UserPromptSubmit') {
    const m = COMMAND_RE.exec(event.prompt || '');
    // Plain prompts become a content-free activity tick — the only signal the
    // Cursor adapter can emit, and the prompts/day metric on Claude Code.
    return m ? { event: 'command', name: m[1] } : { event: 'prompt' };
  }
  return null;
}

// session_start never fires under the Cursor adapter, so prompt events also
// arm the (24h-debounced) export — otherwise Cursor-only machines never ship.
const EXPORT_TRIGGER_EVENTS = new Set(['session_start', 'prompt', 'command']);

function maybeExport(record, options, ctx, stateDirPath) {
  if (!EXPORT_TRIGGER_EVENTS.has(record.event)) return;
  if ((options.sinkMode || DEFAULTS.sinkMode) === 'none') return;
  if (lastExportAgeMs(stateDirPath) < EXPORT_INTERVAL_MS) return;
  // Stamp on ATTEMPT, not success — a dead sink must not turn every prompt
  // into another spawn+timeout for the rest of the day; a failed day simply
  // ships with tomorrow's cumulative rollup.
  markExported(stateDirPath);
  // Detached fire-and-forget: the export must never delay the session. The
  // spawned process re-reads config itself, so options stay authoritative.
  const bin = path.join(__dirname, '..', '..', '..', 'bin', 'agentkit.cjs');
  spawn(process.execPath, [bin, 'report', '--export'], {
    cwd: ctx.repoRoot,
    detached: true,
    stdio: 'ignore',
  }).unref();
}

module.exports = {
  name: 'usage-telemetry',
  events: ['SessionStart', 'PostToolUse', 'UserPromptSubmit'],
  matcher: null,
  matchers: { PostToolUse: 'Skill|Task|Agent', SessionStart: null, UserPromptSubmit: null },
  failClosed: false,
  defaults: DEFAULTS,
  check(event, ctx) {
    try {
      const record = recordFor(event);
      if (!record) return null;
      const stateDirPath = resolveStateDir(ctx);
      if (!stateDirPath) return null;
      record.user = resolveUser(ctx.repoRoot);
      record.repo = path.basename(ctx.repoRoot);
      if (event.sessionId) record.session = event.sessionId;
      if (ctx.adapter) record.adapter = ctx.adapter;
      if (event.toolUseId) record.toolUseId = event.toolUseId;
      createUsageLog(stateDirPath)(record);
      maybeExport(record, ctx.options || {}, ctx, stateDirPath);
    } catch { /* observer — never blocks, never throws */ }
    return null;
  },
};
