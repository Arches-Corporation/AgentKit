'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { toOtlpLogs, drain, exportToOtel, CURSOR_MARKER } = require('../src/core/lib/otel.cjs');
const { createUsageLog } = require('../src/core/lib/usage.cjs');

function tmpState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-otel-'));
}

function writeGuardrail(stateDirPath, entries) {
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(stateDirPath, 'guardrail-log.jsonl'), lines);
}

test('toOtlpLogs: valid OTLP/HTTP logs envelope with attrs + ns timestamps', () => {
  const events = [
    { src: 'usage', e: { ts: '2026-09-10T08:00:00.000Z', event: 'skill', name: 'deep-review', session: 's1', adapter: 'claude' } },
    { src: 'guardrail', e: { ts: '2026-09-10T08:01:00.000Z', guardrail: 'hard-stop', decision: 'block', toolUseId: 'toolu_ABC', adapter: 'claude' } },
  ];
  const otlp = toOtlpLogs(events, { 'user.email': 'a@x.co', 'repo': 'EKB' });
  const rl = otlp.resourceLogs[0];
  // resource attributes
  const rAttrs = Object.fromEntries(rl.resource.attributes.map((a) => [a.key, a.value.stringValue]));
  assert.strictEqual(rAttrs['service.name'], 'agentkit');
  assert.strictEqual(rAttrs['user.email'], 'a@x.co');
  assert.strictEqual(rAttrs['repo'], 'EKB');
  // scope + records
  const scope = rl.scopeLogs[0];
  assert.strictEqual(scope.scope.name, 'agentkit.usage-telemetry');
  assert.strictEqual(scope.logRecords.length, 2);
  const skill = scope.logRecords[0];
  assert.strictEqual(skill.body.stringValue, 'skill');
  assert.strictEqual(skill.timeUnixNano, String(Date.parse('2026-09-10T08:00:00.000Z')) + '000000');
  // guardrail record names the guardrail + carries tool_use_id (the join key)
  const g = scope.logRecords[1];
  assert.strictEqual(g.body.stringValue, 'guardrail.block');
  const gAttrs = Object.fromEntries(g.attributes.map((a) => [a.key, a.value.stringValue]));
  assert.strictEqual(gAttrs['guardrail.name'], 'hard-stop');
  assert.strictEqual(gAttrs['decision'], 'block');
  assert.strictEqual(gAttrs['tool_use_id'], 'toolu_ABC');
});

test('drain: reads new usage + guardrail events, advances cursor, no dupes', () => {
  const state = tmpState();
  const log = createUsageLog(state);
  log({ event: 'session_start', user: 'a@x.co', repo: 'EKB', session: 's1' });
  log({ event: 'skill', name: 'deep-review', user: 'a@x.co', repo: 'EKB' });
  writeGuardrail(state, [{ ts: '2026-09-10T09:00:00.000Z', guardrail: 'hard-stop', decision: 'block', toolUseId: 'toolu_1' }]);

  const first = drain(state);
  assert.strictEqual(first.events.length, 3);
  // cursor is a per-log line count, not a timestamp
  assert.deepStrictEqual(first.nextCursor, { usage: 2, guardrail: 1 });
  // simulate a successful post committing the cursor
  fs.writeFileSync(path.join(state, CURSOR_MARKER), JSON.stringify(first.nextCursor) + '\n');

  // second drain with no new lines → empty
  const second = drain(state);
  assert.strictEqual(second.events.length, 0);

  // add one more, only it drains
  createUsageLog(state)({ event: 'command', name: 'pr', user: 'a@x.co', repo: 'EKB' });
  const third = drain(state);
  assert.strictEqual(third.events.length, 1);
  assert.strictEqual(third.events[0].e.event, 'command');
});

test('drain: same-millisecond events across drains are neither lost nor duplicated', () => {
  const state = tmpState();
  // two guardrail lines with an identical ts, written one at a time across drains
  const ts = '2026-09-10T09:00:00.000Z';
  fs.writeFileSync(path.join(state, 'guardrail-log.jsonl'), JSON.stringify({ ts, guardrail: 'hard-stop', decision: 'block', toolUseId: 't1' }) + '\n');
  const d1 = drain(state);
  assert.strictEqual(d1.events.length, 1);
  fs.writeFileSync(path.join(state, CURSOR_MARKER), JSON.stringify(d1.nextCursor) + '\n');
  // second event, SAME timestamp, appended after the cursor was committed
  fs.appendFileSync(path.join(state, 'guardrail-log.jsonl'), JSON.stringify({ ts, guardrail: 'scout-block', decision: 'block', toolUseId: 't2' }) + '\n');
  const d2 = drain(state);
  assert.strictEqual(d2.events.length, 1, 'the equal-ts second event must not be dropped');
  assert.strictEqual(d2.events[0].e.guardrail, 'scout-block');
});

test('drain: rotation (truncated log) restarts from 0, not stuck', () => {
  const state = tmpState();
  const log = createUsageLog(state);
  log({ event: 'skill', name: 'a', user: 'u', repo: 'r' });
  log({ event: 'skill', name: 'b', user: 'u', repo: 'r' });
  const d1 = drain(state);
  assert.strictEqual(d1.events.length, 2);
  fs.writeFileSync(path.join(state, CURSOR_MARKER), JSON.stringify(d1.nextCursor) + '\n');
  // simulate rotation: file truncated then one fresh line
  fs.writeFileSync(path.join(state, 'usage-log.jsonl'), JSON.stringify({ ts: '2026-09-11T00:00:00.000Z', event: 'skill', name: 'c', user: 'u', repo: 'r' }) + '\n');
  const d2 = drain(state);
  assert.strictEqual(d2.events.length, 1, 'after truncation, cursor(2) > lines(1) → restart from 0');
  assert.strictEqual(d2.events[0].e.name, 'c');
});

test('exportToOtel: posts OTLP, advances cursor only on success', (t, done) => {
  const state = tmpState();
  const log = createUsageLog(state);
  log({ event: 'session_start', user: 'a@x.co', repo: 'EKB', session: 's1' });
  writeGuardrail(state, [{ ts: '2026-09-10T09:00:00.000Z', guardrail: 'scout-block', decision: 'block', toolUseId: 'toolu_9' }]);

  let received = null;
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      received = JSON.parse(buf);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/v1/logs`;
    exportToOtel({ otelEndpoint: url }, state, { user: 'a@x.co', repo: 'EKB' }, (err, status) => {
      assert.ifError(err);
      assert.ok(/otel accepted/.test(status));
      // collector saw a valid envelope naming the guardrail + tool_use_id
      const recs = received.resourceLogs[0].scopeLogs[0].logRecords;
      const g = recs.find((r) => r.body.stringValue === 'guardrail.block');
      const gAttrs = Object.fromEntries(g.attributes.map((a) => [a.key, a.value.stringValue]));
      assert.strictEqual(gAttrs['guardrail.name'], 'scout-block');
      assert.strictEqual(gAttrs['tool_use_id'], 'toolu_9');
      // cursor advanced → a re-run sends nothing
      exportToOtel({ otelEndpoint: url }, state, { user: 'a@x.co', repo: 'EKB' }, (err2, status2) => {
        assert.ifError(err2);
        assert.ok(/no new events/.test(status2));
        server.close();
        done();
      });
    });
  });
});

test('exportToOtel: retries a 503 then succeeds', (t, done) => {
  const state = tmpState();
  createUsageLog(state)({ event: 'skill', name: 'pr-review', user: 'a@x.co', repo: 'EKB' });
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    req.resume();
    if (hits === 1) { res.writeHead(503); res.end('slow'); return; }
    res.writeHead(200); res.end('{}');
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/v1/logs`;
    exportToOtel({ otelEndpoint: url }, state, { user: 'a@x.co', repo: 'EKB' }, (err) => {
      assert.ifError(err);
      assert.strictEqual(hits, 2);
      server.close();
      done();
    });
  });
});

test('exportToOtel: missing endpoint errors; no cursor written', () => {
  const state = tmpState();
  createUsageLog(state)({ event: 'skill', name: 'x', user: 'a@x.co', repo: 'EKB' });
  exportToOtel({ otelEndpoint: '' }, state, { user: 'a@x.co', repo: 'EKB' }, (err) => {
    assert.ok(err && /requires otelEndpoint/.test(err.message));
    assert.ok(!fs.existsSync(path.join(state, CURSOR_MARKER)));
  });
});

test('exportToOtel: refuses Authorization header over plaintext http', () => {
  const state = tmpState();
  createUsageLog(state)({ event: 'skill', name: 'x', user: 'a@x.co', repo: 'EKB' });
  exportToOtel(
    { otelEndpoint: 'http://collector.example.com/v1/logs', otelHeaders: ['Authorization: Bearer tok'] },
    state,
    { user: 'a@x.co', repo: 'EKB' },
    (err) => {
      assert.ok(err && /plaintext http/.test(err.message));
    }
  );
});

test('exportToOtel: otelAuthTokenEnv value is read as auth (env, not config)', (t, done) => {
  const state = tmpState();
  createUsageLog(state)({ event: 'skill', name: 'pr-review', user: 'a@x.co', repo: 'EKB' });
  const ENV = 'AGENTKIT_TEST_OTEL_AUTH';
  process.env[ENV] = 'Basic dGVzdDp0b2tlbg==';
  // Over plaintext http, an Authorization header must trigger the https guard.
  // If env injection failed there'd be no auth header and no such error — so
  // hitting the guard proves the env value was applied as Authorization.
  exportToOtel(
    { otelEndpoint: 'http://collector.example.com/v1/logs', otelAuthTokenEnv: ENV },
    state,
    { user: 'a@x.co', repo: 'EKB' },
    (err) => {
      delete process.env[ENV];
      assert.ok(err && /plaintext http/.test(err.message), 'env-injected auth must hit the https guard');
      done();
    }
  );
});

test('exportToOtel: unset otelAuthTokenEnv adds no auth header (no throw)', (t, done) => {
  const state = tmpState();
  createUsageLog(state)({ event: 'skill', name: 'pr-review', user: 'a@x.co', repo: 'EKB' });
  let seenAuth = 'unset';
  const server = http.createServer((req, res) => {
    seenAuth = req.headers.authorization || null;
    req.resume();
    res.writeHead(200); res.end('{}');
  });
  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/v1/logs`;
    // env var not defined → no Authorization → plaintext http is allowed
    exportToOtel({ otelEndpoint: url, otelAuthTokenEnv: 'AGENTKIT_UNSET_XYZ' }, state, { user: 'a@x.co', repo: 'EKB' }, (err) => {
      server.close();
      assert.ifError(err);
      assert.strictEqual(seenAuth, null, 'no auth header when env var is unset');
      done();
    });
  });
});

test('otel privacy: guardrail reason / prompt content never reaches OTLP', () => {
  const state = tmpState();
  createUsageLog(state)({ event: 'skill', name: 'deep-review', user: 'a@x.co', repo: 'EKB' });
  writeGuardrail(state, [{ ts: '2026-09-10T09:00:00.000Z', guardrail: 'privacy-block', decision: 'block', reason: 'SECRET path /Users/x/.env', toolUseId: 'toolu_2' }]);
  const { events } = drain(state);
  const otlp = toOtlpLogs(events, { 'user.email': 'a@x.co', 'repo': 'EKB' });
  const json = JSON.stringify(otlp);
  assert.ok(!json.includes('SECRET'));
  assert.ok(!json.includes('.env'));
  assert.ok(json.includes('privacy-block'));
  assert.ok(json.includes('toolu_2'));
});
