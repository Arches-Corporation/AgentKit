'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const usageTelemetry = require('../src/core/guardrails/usage-telemetry.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');
const {
  USAGE_LOG_FILENAME,
  createUsageLog,
  aggregateUsage,
  buildReport,
  formatReport,
  toCsv,
  exportReport,
  lastExportAgeMs,
  LAST_EXPORT_MARKER,
} = require('../src/core/lib/usage.cjs');

function makeCtx(overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-test-'));
  const stateDirPath = path.join(tmp, 'state');
  return Object.assign(
    {
      repoRoot: tmp,
      options: {},
      markers: createMarkers(stateDirPath),
      log: () => {},
      stateDirPath,
    },
    overrides
  );
}

function readLog(ctx) {
  try {
    return fs
      .readFileSync(path.join(ctx.stateDirPath, USAGE_LOG_FILENAME), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function skillEvent(skillName, extraInput = {}) {
  const tool_input = Object.assign({ skill: skillName }, extraInput);
  return {
    hookEvent: 'PostToolUse',
    toolName: 'Skill',
    command: '',
    paths: [],
    prompt: '',
    cwd: process.cwd(),
    sessionId: 'sess-1',
    raw: { tool_input },
  };
}

test('usage-telemetry: skill invocation logs name only, never tool_input content', () => {
  const ctx = makeCtx();
  const r = usageTelemetry.check(
    skillEvent('deep-review', { args: 'SECRET_ARGUMENT --token=hunter2', prompt: 'PRIVATE PROMPT TEXT' }),
    ctx
  );
  assert.strictEqual(r, null);
  const lines = readLog(ctx);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].event, 'skill');
  assert.strictEqual(lines[0].name, 'deep-review');
  const rawLine = fs.readFileSync(path.join(ctx.stateDirPath, USAGE_LOG_FILENAME), 'utf8');
  assert.ok(!rawLine.includes('SECRET_ARGUMENT'));
  assert.ok(!rawLine.includes('hunter2'));
  assert.ok(!rawLine.includes('PRIVATE PROMPT TEXT'));
});

test('usage-telemetry: session start logs user, repo, session', () => {
  const ctx = makeCtx();
  usageTelemetry.check(
    { hookEvent: 'SessionStart', toolName: null, command: '', paths: [], prompt: '', cwd: ctx.repoRoot, sessionId: 'sess-42', raw: {} },
    ctx
  );
  const lines = readLog(ctx);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].event, 'session_start');
  assert.strictEqual(lines[0].session, 'sess-42');
  assert.strictEqual(lines[0].repo, path.basename(ctx.repoRoot));
  assert.ok(typeof lines[0].user === 'string' && lines[0].user.length > 0);
});

test('usage-telemetry: agent dispatch logs subagent type', () => {
  const ctx = makeCtx();
  usageTelemetry.check(
    {
      hookEvent: 'PostToolUse',
      toolName: 'Task',
      command: '',
      paths: [],
      prompt: '',
      cwd: process.cwd(),
      sessionId: null,
      raw: { tool_input: { subagent_type: 'be-agent', prompt: 'CONFIDENTIAL TASK BODY' } },
    },
    ctx
  );
  const lines = readLog(ctx);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].event, 'agent');
  assert.strictEqual(lines[0].name, 'be-agent');
  const rawLine = fs.readFileSync(path.join(ctx.stateDirPath, USAGE_LOG_FILENAME), 'utf8');
  assert.ok(!rawLine.includes('CONFIDENTIAL TASK BODY'));
});

test('usage-telemetry: slash command logs name only, plain prompt logs content-free activity tick', () => {
  const ctx = makeCtx();
  usageTelemetry.check(
    { hookEvent: 'UserPromptSubmit', toolName: null, command: '', paths: [], prompt: '/pr open one for EKB-9999 with SENSITIVE detail', cwd: process.cwd(), sessionId: null, raw: {} },
    ctx
  );
  usageTelemetry.check(
    { hookEvent: 'UserPromptSubmit', toolName: null, command: '', paths: [], prompt: 'please refactor the auth module', cwd: process.cwd(), sessionId: null, raw: {} },
    ctx
  );
  const lines = readLog(ctx);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].event, 'command');
  assert.strictEqual(lines[0].name, 'pr');
  assert.strictEqual(lines[1].event, 'prompt');
  assert.ok(!('name' in lines[1]));
  const rawLine = fs.readFileSync(path.join(ctx.stateDirPath, USAGE_LOG_FILENAME), 'utf8');
  assert.ok(!rawLine.includes('SENSITIVE'));
  assert.ok(!rawLine.includes('refactor'));
});

test('usage-telemetry: ctx.adapter lands on the record', () => {
  const ctx = makeCtx({ adapter: 'cursor' });
  usageTelemetry.check(
    { hookEvent: 'UserPromptSubmit', toolName: null, command: '', paths: [], prompt: 'hello there', cwd: process.cwd(), sessionId: null, raw: {} },
    ctx
  );
  const lines = readLog(ctx);
  assert.strictEqual(lines[0].adapter, 'cursor');
  assert.strictEqual(lines[0].event, 'prompt');
});

test('usage-telemetry: unrelated PostToolUse tools produce no record', () => {
  const ctx = makeCtx();
  usageTelemetry.check(
    { hookEvent: 'PostToolUse', toolName: 'Bash', command: 'rm -rf /', paths: [], prompt: '', cwd: process.cwd(), sessionId: null, raw: { tool_input: { command: 'rm -rf /' } } },
    ctx
  );
  assert.strictEqual(readLog(ctx).length, 0);
});

test('usage-telemetry: never throws and always allows, even without state dir', () => {
  const r = usageTelemetry.check(skillEvent('x'), { repoRoot: process.cwd(), options: {} });
  assert.strictEqual(r, null);
});

test('usage-telemetry: per-event matchers narrow PostToolUse wiring', () => {
  assert.strictEqual(usageTelemetry.matchers.PostToolUse, 'Skill|Task|Agent');
  assert.strictEqual(usageTelemetry.matchers.SessionStart, null);
  const { hooksFragment } = require('../src/adapters/claude/settings-fragment.cjs');
  const fragment = hooksFragment();
  const postEntries = fragment.PostToolUse || [];
  const narrowed = postEntries.find((e) => e.matcher === 'Skill|Task|Agent');
  assert.ok(narrowed, 'PostToolUse entry with Skill|Task|Agent matcher expected');
  assert.ok(narrowed.hooks.some((h) => h.command.endsWith(' usage-telemetry')));
  const sessionEntries = fragment.SessionStart || [];
  assert.ok(sessionEntries.some((e) => !e.matcher && e.hooks.some((h) => h.command.endsWith(' usage-telemetry'))));
});

test('aggregateUsage: rolls up per user/day with event counts and top names', () => {
  const lines = [
    JSON.stringify({ ts: '2026-09-10T08:00:00Z', event: 'session_start', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-10T08:05:00Z', event: 'skill', name: 'deep-review', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-10T09:00:00Z', event: 'skill', name: 'deep-review', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-10T09:10:00Z', event: 'agent', name: 'be-agent', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-10T10:00:00Z', event: 'command', name: 'pr', user: 'b@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-11T10:00:00Z', event: 'session_start', user: 'a@x.co', repo: 'EKB' }),
    'not json',
    '',
  ];
  const agg = aggregateUsage(lines);
  assert.strictEqual(agg.total, 6);
  assert.strictEqual(agg.rows.length, 3);
  const first = agg.rows[0];
  assert.deepStrictEqual(
    { date: first.date, user: first.user, sessions: first.sessions, skills: first.skills, agents: first.agents },
    { date: '2026-09-10', user: 'a@x.co', sessions: 1, skills: 2, agents: 1 }
  );
  assert.strictEqual(first.names['skill:deep-review'], 2);
});

test('aggregateUsage: duplicate session ids count as one session; malformed ts skipped', () => {
  const lines = [
    JSON.stringify({ ts: '2026-09-10T08:00:00Z', event: 'session_start', session: 's1', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-10T09:00:00Z', event: 'session_start', session: 's1', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-10T10:00:00Z', event: 'session_start', session: 's2', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: 'bad', event: 'session_start', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ event: 'session_start', user: 'a@x.co', repo: 'EKB' }),
  ];
  const agg = aggregateUsage(lines);
  assert.strictEqual(agg.rows.length, 1);
  assert.strictEqual(agg.rows[0].sessions, 2);
  assert.ok(!('sessionIds' in agg.rows[0]), 'internal dedupe set must not leak into report output');
});

test('usage-telemetry: missing tool_input logs empty name without throwing', () => {
  const ctx = makeCtx();
  const r = usageTelemetry.check(
    { hookEvent: 'PostToolUse', toolName: 'Skill', command: '', paths: [], prompt: '', cwd: process.cwd(), sessionId: null, raw: {} },
    ctx
  );
  assert.strictEqual(r, null);
  const lines = readLog(ctx);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].event, 'skill');
  assert.ok(!('name' in lines[0]));
});

test('exportReport: refuses bearer token over plaintext http', (t, done) => {
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-http-'));
  process.env.AGENTKIT_TEST_TOKEN = 'tok';
  exportReport(
    { sinkMode: 'endpoint', sinkUrl: 'http://example.com/x', sinkAuthTokenEnv: 'AGENTKIT_TEST_TOKEN' },
    stateDirPath,
    'EKB',
    'a@x.co',
    (err) => {
      delete process.env.AGENTKIT_TEST_TOKEN;
      assert.ok(err && /plaintext http/.test(err.message));
      done();
    }
  );
});

test('aggregateUsage: --since filter drops older entries', () => {
  const lines = [
    JSON.stringify({ ts: '2026-09-01T08:00:00Z', event: 'session_start', user: 'a@x.co', repo: 'EKB' }),
    JSON.stringify({ ts: '2026-09-10T08:00:00Z', event: 'session_start', user: 'a@x.co', repo: 'EKB' }),
  ];
  const agg = aggregateUsage(lines, '2026-09-05T00:00:00Z');
  assert.strictEqual(agg.total, 1);
  assert.strictEqual(agg.rows[0].date, '2026-09-10');
});

test('createUsageLog: strips unknown fields from records', () => {
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-log-'));
  createUsageLog(stateDirPath)({ event: 'skill', name: 'pr', user: 'a@x.co', repo: 'EKB', prompt: 'LEAKED', tool_input: { x: 'LEAKED' } });
  const raw = fs.readFileSync(path.join(stateDirPath, USAGE_LOG_FILENAME), 'utf8');
  assert.ok(!raw.includes('LEAKED'));
  const entry = JSON.parse(raw.trim());
  assert.deepStrictEqual(Object.keys(entry).sort(), ['event', 'name', 'repo', 'ts', 'user']);
});

test('report: format + csv include usage rows and guardrail day counts', () => {
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-report-'));
  const log = createUsageLog(stateDirPath);
  log({ event: 'session_start', user: 'a@x.co', repo: 'EKB' });
  log({ event: 'skill', name: 'deep-review', user: 'a@x.co', repo: 'EKB' });
  fs.writeFileSync(
    path.join(stateDirPath, 'guardrail-log.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), guardrail: 'hard-stop', decision: 'block', reason: 'x' }) + '\n'
  );
  const report = buildReport(stateDirPath);
  assert.strictEqual(report.usage.total, 2);
  const text = formatReport(report);
  assert.ok(text.includes('a@x.co'));
  assert.ok(text.includes('guardrail events by day:'));
  const csv = toCsv(report);
  assert.ok(csv.startsWith('date,user,repo,sessions,skills,agents,commands,prompts,top_names'));
  assert.ok(csv.includes('a@x.co,EKB,1,1,0,0,0'));
});

test('guardrail rollup: per-guardrail breakdown alongside flat decision totals', () => {
  const { aggregateGuardrailsByDay, guardrailNames } = require('../src/core/lib/usage.cjs');
  const day = '2026-09-10';
  const lines = [
    JSON.stringify({ ts: `${day}T08:00:00Z`, guardrail: 'hard-stop', decision: 'block', reason: 'x' }),
    JSON.stringify({ ts: `${day}T09:00:00Z`, guardrail: 'hard-stop', decision: 'block', reason: 'y' }),
    JSON.stringify({ ts: `${day}T10:00:00Z`, guardrail: 'scout-block', decision: 'block', reason: 'z' }),
    JSON.stringify({ ts: `${day}T11:00:00Z`, guardrail: 'rules-reminder', decision: 'inject' }),
  ];
  const byDay = aggregateGuardrailsByDay(lines);
  // flat decision totals still present (Apps Script reads .block)
  assert.strictEqual(byDay[day].block, 3);
  assert.strictEqual(byDay[day].inject, 1);
  // per-guardrail breakdown present
  assert.strictEqual(byDay[day].guardrails['hard-stop'].block, 2);
  assert.strictEqual(byDay[day].guardrails['scout-block'].block, 1);
  assert.strictEqual(byDay[day].guardrails['rules-reminder'].inject, 1);
  const names = guardrailNames(byDay[day]);
  assert.deepStrictEqual(names, ['hard-stop block:2', 'rules-reminder inject:1', 'scout-block block:1']);
  // formatReport shows the names line and does not print the non-numeric key
  const text = formatReport({ usage: { total: 0, rows: [] }, guardrailsByDay: byDay });
  assert.ok(text.includes('hard-stop block:2'));
  assert.ok(!/guardrails \[object/.test(text));
});

test('exportReport: file mode writes payload into sink dir and stamps marker', (t, done) => {
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-export-'));
  const sink = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-sink-'));
  createUsageLog(stateDirPath)({ event: 'session_start', user: 'a@x.co', repo: 'EKB' });
  assert.strictEqual(lastExportAgeMs(stateDirPath), Infinity);
  exportReport({ sinkMode: 'file', sinkPath: sink }, stateDirPath, 'EKB', 'a@x.co', (err, msg) => {
    assert.ifError(err);
    assert.ok(/wrote /.test(msg));
    const files = fs.readdirSync(sink);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].startsWith('agentkit-usage-EKB-a@x.co-'));
    const payload = JSON.parse(fs.readFileSync(path.join(sink, files[0]), 'utf8'));
    assert.strictEqual(payload.usage.total, 1);
    assert.ok(fs.existsSync(path.join(stateDirPath, LAST_EXPORT_MARKER)));
    assert.ok(lastExportAgeMs(stateDirPath) < 60_000);
    done();
  });
});

test('exportReport: sinkMode none is a no-op, unreachable endpoint fails open', (t, done) => {
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-export2-'));
  exportReport({ sinkMode: 'none' }, stateDirPath, 'EKB', 'a@x.co', (err, msg) => {
    assert.ifError(err);
    assert.ok(/nothing exported/.test(msg));
    exportReport(
      { sinkMode: 'endpoint', sinkUrl: 'http://127.0.0.1:1/agentkit' },
      stateDirPath,
      'EKB',
      'a@x.co',
      (err2) => {
        assert.ok(err2, 'unreachable endpoint must surface an error to the caller');
        assert.ok(!fs.existsSync(path.join(stateDirPath, LAST_EXPORT_MARKER)));
        done();
      }
    );
  });
});

test('exportReport: retries a 503 then succeeds (rate-limit resilience)', (t, done) => {
  const http = require('http');
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-retry-'));
  createUsageLog(stateDirPath)({ event: 'session_start', user: 'a@x.co', repo: 'EKB' });
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (hits === 1) { res.writeHead(503); res.end('slow down'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, appended: 1 }));
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/agentkit`;
    exportReport({ sinkMode: 'endpoint', sinkUrl: url }, stateDirPath, 'EKB', 'a@x.co', (err, msg) => {
      server.close();
      assert.ifError(err);
      assert.strictEqual(hits, 2, 'should have retried once after the 503');
      assert.ok(/endpoint accepted/.test(msg));
      done();
    });
  });
});

test('exportReport: retries when Apps Script lock replies ok:false busy', (t, done) => {
  const http = require('http');
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-usage-busy-'));
  createUsageLog(stateDirPath)({ event: 'session_start', user: 'a@x.co', repo: 'EKB' });
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    // First reply is a 200 that is actually a lock-contention failure.
    res.end(JSON.stringify(hits === 1 ? { ok: false, error: 'busy' } : { ok: true, appended: 1 }));
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/agentkit`;
    exportReport({ sinkMode: 'endpoint', sinkUrl: url }, stateDirPath, 'EKB', 'a@x.co', (err) => {
      server.close();
      assert.ifError(err);
      assert.strictEqual(hits, 2, 'a 200 ok:false busy body must trigger a retry');
      done();
    });
  });
});
