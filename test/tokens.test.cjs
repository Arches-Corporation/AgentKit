'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mineTokens } = require('../src/core/lib/tokens.cjs');
const { buildReport, formatReport } = require('../src/core/lib/usage.cjs');

// Build a fake ~/.claude/projects tree with transcript lines.
function fakeHome(lines) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-home-'));
  const proj = path.join(home, '.claude', 'projects', '-fake-EKB');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'session1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return home;
}

test('mineTokens: sums usage per day/model, content never read', () => {
  const home = fakeHome([
    { timestamp: '2026-09-10T08:00:00Z', cwd: '/work/EKB', message: { model: 'claude-fable-5', content: 'SECRET PROMPT REPLY', usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 5000 } } },
    { timestamp: '2026-09-10T09:00:00Z', cwd: '/work/EKB', message: { model: 'claude-fable-5', usage: { input_tokens: 50, output_tokens: 60 } } },
    { timestamp: '2026-09-10T10:00:00Z', cwd: '/work/EKB', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 20 } } },
    { timestamp: '2026-09-11T10:00:00Z', cwd: '/work/EKB', message: { model: 'claude-fable-5', usage: { input_tokens: 1, output_tokens: 2 } } },
  ]);
  const { rows } = mineTokens({ homeDir: home });
  assert.strictEqual(rows.length, 3);
  const fable10 = rows.find((r) => r.date === '2026-09-10' && r.model === 'claude-fable-5');
  assert.deepStrictEqual(
    { input: fable10.input, output: fable10.output, cacheRead: fable10.cacheRead, messages: fable10.messages },
    { input: 150, output: 260, cacheRead: 5000, messages: 2 }
  );
});

test('mineTokens: repoRoot filters by cwd; --since drops older', () => {
  const home = fakeHome([
    { timestamp: '2026-09-10T08:00:00Z', cwd: '/work/EKB/apps/api', message: { model: 'm', usage: { input_tokens: 5, output_tokens: 5 } } },
    { timestamp: '2026-09-10T08:00:00Z', cwd: '/work/OTHER', message: { model: 'm', usage: { input_tokens: 999, output_tokens: 999 } } },
    { timestamp: '2026-09-01T08:00:00Z', cwd: '/work/EKB', message: { model: 'm', usage: { input_tokens: 7, output_tokens: 7 } } },
  ]);
  const inRepo = mineTokens({ homeDir: home, repoRoot: '/work/EKB' });
  assert.strictEqual(inRepo.rows.length, 2);
  assert.ok(!inRepo.rows.some((r) => r.input === 999), 'other repo excluded');

  const recent = mineTokens({ homeDir: home, repoRoot: '/work/EKB', sinceTs: '2026-09-05T00:00:00Z' });
  assert.strictEqual(recent.rows.length, 1);
  assert.strictEqual(recent.rows[0].date, '2026-09-10');
});

test('mineTokens: missing/empty projects dir returns empty, never throws', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-home-empty-'));
  const { rows, scanned } = mineTokens({ homeDir: home });
  assert.deepStrictEqual(rows, []);
  assert.strictEqual(scanned, 0);
});

test('mineTokens: lines without usage or timestamp are skipped', () => {
  const home = fakeHome([
    { timestamp: '2026-09-10T08:00:00Z', cwd: '/work/EKB', message: { model: 'm', content: 'no usage here' } },
    { type: 'summary', message: { usage: { input_tokens: 3 } } },
    { timestamp: '2026-09-10T08:00:00Z', cwd: '/work/EKB', message: { model: 'm', usage: { input_tokens: 4, output_tokens: 4 } } },
  ]);
  const { rows } = mineTokens({ homeDir: home, repoRoot: '/work/EKB' });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].input, 4);
});

test('buildReport: tokens included only when tokenOpts.mine set', () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-state-'));
  const home = fakeHome([
    { timestamp: '2026-09-10T08:00:00Z', cwd: '/work/EKB', message: { model: 'claude-fable-5', usage: { input_tokens: 100, output_tokens: 200 } } },
  ]);
  const off = buildReport(state, null);
  assert.ok(!('tokens' in off));
  const on = buildReport(state, null, { mine: true, repoRoot: '/work/EKB', homeDir: home });
  assert.ok(on.tokens && on.tokens.rows.length === 1);
  const text = formatReport(on);
  assert.ok(text.includes('tokens by day/model'));
  assert.ok(text.includes('claude-fable-5'));
});
