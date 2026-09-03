'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const forcePush = require('../src/core/guardrails/force-push-guard.cjs');
const dbGuard = require('../src/core/guardrails/db-guard.cjs');
const rulesReminder = require('../src/core/guardrails/rules-reminder.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');

function makeCtx(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-new-'));
  return { repoRoot: dir, options, markers: createMarkers(path.join(dir, 'state')), log: () => {} };
}

function bashEvent(command, sessionId = null) {
  return { hookEvent: 'PreToolUse', toolName: 'Bash', command, paths: [], prompt: '', cwd: process.cwd(), sessionId, raw: {} };
}

test('force-push: --force blocked', () => {
  const r = forcePush.check(bashEvent('git push --force origin main'), makeCtx());
  assert.ok(r && /force push/.test(r.block));
});

test('force-push: -f blocked', () => {
  const r = forcePush.check(bashEvent('git push -f origin main'), makeCtx());
  assert.ok(r && r.block);
});

test('force-push: plain push allowed', () => {
  assert.strictEqual(forcePush.check(bashEvent('git push origin main'), makeCtx()), null);
});

test('force-push: --force-with-lease blocked by default', () => {
  const r = forcePush.check(bashEvent('git push --force-with-lease origin x'), makeCtx());
  assert.ok(r && r.block);
});

test('force-push: --force-with-lease allowed when configured', () => {
  const ctx = makeCtx({ allowForceWithLease: true });
  assert.strictEqual(forcePush.check(bashEvent('git push --force-with-lease origin x'), ctx), null);
});

test('force-push: marker allows once', () => {
  const ctx = makeCtx();
  ctx.markers.place('force-push-approved');
  assert.strictEqual(forcePush.check(bashEvent('git push --force origin x'), ctx), null);
  const r = forcePush.check(bashEvent('git push --force origin x'), ctx);
  assert.ok(r && r.block);
});

test('db-guard: rails db:drop blocked', () => {
  const r = dbGuard.check(bashEvent('bundle exec rails db:drop'), makeCtx());
  assert.ok(r && /destructive/.test(r.block));
});

test('db-guard: DROP TABLE blocked', () => {
  const r = dbGuard.check(bashEvent('mysql -e "DROP TABLE users"'), makeCtx());
  assert.ok(r && r.block);
});

test('db-guard: docker compose down -v blocked', () => {
  const r = dbGuard.check(bashEvent('docker compose down -v'), makeCtx());
  assert.ok(r && r.block);
});

test('db-guard: docker compose down without -v allowed', () => {
  assert.strictEqual(dbGuard.check(bashEvent('docker compose down'), makeCtx()), null);
});

test('db-guard: rails db:migrate allowed', () => {
  assert.strictEqual(dbGuard.check(bashEvent('bundle exec rails db:migrate'), makeCtx()), null);
});

test('db-guard: extraPatterns from config blocked', () => {
  const ctx = makeCtx({ extraPatterns: [{ pattern: '\\bflushall\\b', label: 'redis flushall' }] });
  const r = dbGuard.check(bashEvent('redis-cli flushall'), ctx);
  assert.ok(r && /redis flushall/.test(r.block));
});

test('db-guard: marker allows once', () => {
  const ctx = makeCtx();
  ctx.markers.place('db-approved');
  assert.strictEqual(dbGuard.check(bashEvent('rails db:reset'), ctx), null);
});

function promptEvent(sessionId) {
  return { hookEvent: 'UserPromptSubmit', toolName: null, command: '', paths: [], prompt: 'hello', cwd: process.cwd(), sessionId, raw: {} };
}

test('rules-reminder: no text configured -> silent', () => {
  assert.strictEqual(rulesReminder.check(promptEvent('s1'), makeCtx()), null);
});

test('rules-reminder: injects configured text once per session', () => {
  const ctx = makeCtx({ text: 'Repo rules: spec first.' });
  const first = rulesReminder.check(promptEvent('s2'), ctx);
  assert.ok(first && /spec first/.test(first.inject));
  assert.strictEqual(rulesReminder.check(promptEvent('s2'), ctx), null);
});

test('rules-reminder: text array joined', () => {
  const ctx = makeCtx({ text: ['Rule A.', 'Rule B.'], oncePerSession: false });
  const r = rulesReminder.check(promptEvent('s3'), ctx);
  assert.strictEqual(r.inject, 'Rule A. Rule B.');
});
