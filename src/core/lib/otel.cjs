'use strict';

const fs = require('fs');
const path = require('path');
const { postWithRetry } = require('./http.cjs');

// OTLP sink: drains the local event logs (usage-log.jsonl + guardrail-log.jsonl)
// into OTLP/HTTP Logs JSON, one LogRecord per event, and POSTs to a collector.
// Per-event granularity (not the daily rollup) so guardrail records keep their
// tool_use_id — that lets the collector join them against Anthropic's native
// claude_code.tool_decision events (which carry the same tool_use_id but no
// guardrail name). Dependency-free: the OTLP JSON envelope is hand-built.
//
// Privacy: only the same metadata fields the local logs already hold reach the
// collector — event/name/guardrail/decision/tool_use_id/session/adapter. No
// prompt text, tool inputs, or reasons.

const USAGE_LOG = 'usage-log.jsonl';
const GUARDRAIL_LOG = 'guardrail-log.jsonl';
const CURSOR_MARKER = 'last-otel-cursor';
const SCOPE_NAME = 'agentkit.usage-telemetry';

// Cursor is a per-log count of raw lines already emitted — not a timestamp.
// A timestamp cursor loses (or duplicates) events that share a millisecond
// across drains; a line count is exact for an append-only log. The logs
// truncate-to-zero on rotation (512 KB), so if the file now has fewer lines
// than the cursor we detect the rotation and restart from 0.
function readCursor(stateDirPath) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(stateDirPath, CURSOR_MARKER), 'utf8'));
    return { usage: Number.isInteger(c.usage) ? c.usage : 0, guardrail: Number.isInteger(c.guardrail) ? c.guardrail : 0 };
  } catch {
    return { usage: 0, guardrail: 0 };
  }
}

function writeCursor(stateDirPath, cursor) {
  try {
    fs.mkdirSync(stateDirPath, { recursive: true });
    fs.writeFileSync(path.join(stateDirPath, CURSOR_MARKER), JSON.stringify(cursor) + '\n');
  } catch { /* best effort */ }
}

// Returns non-empty raw lines (the trailing '' from a final newline dropped).
function rawLines(stateDirPath, filename) {
  let text;
  try {
    text = fs.readFileSync(path.join(stateDirPath, filename), 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Slice new lines after `from`; if the file shrank (rotation truncated it),
// restart from 0. Returns { events, count } where count is the new cursor.
function sliceFrom(lines, from) {
  const start = lines.length < from ? 0 : from;
  const events = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    events.push(e);
  }
  return { events, count: lines.length };
}

// Collects the new usage + guardrail events since the cursor. Returns the
// events plus the advanced cursor (only committed after a successful POST).
function drain(stateDirPath) {
  const cursor = readCursor(stateDirPath);
  const usage = sliceFrom(rawLines(stateDirPath, USAGE_LOG), cursor.usage);
  const guardrail = sliceFrom(rawLines(stateDirPath, GUARDRAIL_LOG), cursor.guardrail);
  // Tag source (for OTLP shaping) + a stable global index (sort tiebreaker for
  // events sharing a timestamp — usage first, then guardrail, in file order).
  let i = 0;
  const events = usage.events.map((e) => ({ src: 'usage', e, seq: i++ }))
    .concat(guardrail.events.map((e) => ({ src: 'guardrail', e, seq: i++ })));
  return { events, nextCursor: { usage: usage.count, guardrail: guardrail.count } };
}

function attr(key, value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isInteger(value)) return { key, value: { intValue: value } };
  return { key, value: { stringValue: String(value) } };
}

function attrs(pairs) {
  return Object.entries(pairs).map(([k, v]) => attr(k, v)).filter(Boolean);
}

function tsToNano(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '0';
  return String(ms) + '000000';
}

function toLogRecord({ src, e }) {
  const body = src === 'guardrail' ? `guardrail.${e.decision || 'event'}` : (e.event || 'event');
  const a = src === 'guardrail'
    ? attrs({ 'kind': 'guardrail', 'guardrail.name': e.guardrail, 'decision': e.decision, 'tool_use_id': e.toolUseId, 'adapter': e.adapter })
    : attrs({ 'kind': e.event, 'name': e.name, 'session.id': e.session, 'tool_use_id': e.toolUseId, 'adapter': e.adapter });
  return {
    timeUnixNano: tsToNano(e.ts),
    body: { stringValue: body },
    attributes: a,
  };
}

// Build a standards OTLP/HTTP Logs JSON envelope (protobuf-JSON mapping) that
// any OTLP collector ingests: resourceLogs -> scopeLogs -> logRecords.
function toOtlpLogs(events, resourceAttrs) {
  return {
    resourceLogs: [
      {
        resource: { attributes: attrs(Object.assign({ 'service.name': 'agentkit' }, resourceAttrs)) },
        scopeLogs: [
          {
            scope: { name: SCOPE_NAME },
            logRecords: events.map(toLogRecord),
          },
        ],
      },
    ],
  };
}

function parseHeaders(list) {
  const out = {};
  for (const h of Array.isArray(list) ? list : []) {
    const i = String(h).indexOf(':');
    if (i <= 0) continue;
    out[String(h).slice(0, i).trim().toLowerCase()] = String(h).slice(i + 1).trim();
  }
  return out;
}

function exportToOtel(options, stateDirPath, resource, done) {
  const endpoint = options.otelEndpoint || '';
  if (!endpoint) {
    done(new Error('sinkMode "otel" requires otelEndpoint (the collector OTLP/HTTP logs URL)'));
    return;
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (err) {
    done(new Error(`invalid otelEndpoint: ${err.message}`));
    return;
  }
  const extra = parseHeaders(options.otelHeaders);
  // Secret-safe auth: otelAuthTokenEnv names an env var whose value is the
  // full Authorization header (e.g. "Basic <base64>" or "Bearer <token>").
  // Keeps the credential out of agentkit.config.json / git — only the env var
  // name is committed. Overrides any authorization in otelHeaders.
  if (options.otelAuthTokenEnv) {
    const tok = process.env[options.otelAuthTokenEnv];
    if (tok) extra.authorization = tok;
  }
  const hasAuth = Object.keys(extra).some((k) => k === 'authorization');
  if (hasAuth && parsed.protocol !== 'https:') {
    done(new Error('refusing to send an Authorization header over plaintext http — use an https otelEndpoint'));
    return;
  }

  const { events, nextCursor } = drain(stateDirPath);
  if (!events.length) {
    done(null, 'otel: no new events');
    return;
  }
  // OTLP orders records by time within a scope; sort by ts with the drain seq
  // as a deterministic tiebreaker for events sharing a millisecond.
  events.sort((a, b) => (a.e.ts < b.e.ts ? -1 : a.e.ts > b.e.ts ? 1 : a.seq - b.seq));

  const resourceAttrs = {};
  if (resource && resource.user) resourceAttrs['user.email'] = resource.user;
  if (resource && resource.repo) resourceAttrs['repo'] = resource.repo;

  const body = JSON.stringify(toOtlpLogs(events, resourceAttrs));
  const headers = Object.assign(
    { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    extra
  );

  postWithRetry(parsed, headers, body, (err, status) => {
    if (err) {
      done(err);
      return;
    }
    writeCursor(stateDirPath, nextCursor);
    done(null, `otel accepted (${status}, ${events.length} records)`);
  });
}

module.exports = { toOtlpLogs, drain, exportToOtel, CURSOR_MARKER };
