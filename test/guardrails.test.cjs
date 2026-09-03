'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hardStop = require('../src/core/guardrails/hard-stop.cjs');
const privacyBlock = require('../src/core/guardrails/privacy-block.cjs');
const secretOutput = require('../src/core/guardrails/secret-output.cjs');
const scoutBlock = require('../src/core/guardrails/scout-block.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');

function makeCtx(overrides = {}) {
  const stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-test-'));
  return Object.assign(
    {
      repoRoot: stateDirPath,
      options: {},
      markers: createMarkers(path.join(stateDirPath, 'state')),
      log: () => {},
      stateDirPath,
    },
    overrides
  );
}

function bashEvent(command) {
  return { hookEvent: 'PreToolUse', toolName: 'Bash', command, paths: [], prompt: '', cwd: process.cwd(), sessionId: null };
}

function pathEvent(p) {
  return { hookEvent: 'PreToolUse', toolName: 'Read', command: '', paths: [p], prompt: '', cwd: process.cwd(), sessionId: null };
}

function promptEvent(text) {
  return { hookEvent: 'UserPromptSubmit', toolName: null, command: '', paths: [], prompt: text, cwd: process.cwd(), sessionId: null };
}

test('hard-stop: git commit blocked without marker', () => {
  const r = hardStop.check(bashEvent('git commit -m wip'), makeCtx());
  assert.ok(r && /HARD STOP/.test(r.block));
});

test('hard-stop: git push blocked without marker', () => {
  const r = hardStop.check(bashEvent('git push origin x'), makeCtx());
  assert.ok(r && /HARD STOP/.test(r.block));
});

test('hard-stop: --no-verify blocked even with marker', () => {
  const ctx = makeCtx();
  ctx.markers.place('git-approved');
  const r = hardStop.check(bashEvent('git commit --no-verify -m x'), ctx);
  assert.ok(r && /no-verify/.test(r.block));
});

test('hard-stop: commit -n blocked', () => {
  const r = hardStop.check(bashEvent('git commit -n -m x'), makeCtx());
  assert.ok(r && r.block);
});

test('hard-stop: benign command allowed', () => {
  assert.strictEqual(hardStop.check(bashEvent('ls -la'), makeCtx()), null);
});

test('hard-stop: marker allows once, then consumed', () => {
  const ctx = makeCtx();
  ctx.markers.place('git-approved');
  assert.strictEqual(hardStop.check(bashEvent('git commit -m ok'), ctx), null);
  const r = hardStop.check(bashEvent('git commit -m again'), ctx);
  assert.ok(r && r.block);
});

test('privacy-block: .env read blocked', () => {
  const r = privacyBlock.check(pathEvent('/repo/.env'), makeCtx());
  assert.ok(r && /secrets/.test(r.block));
});

test('privacy-block: .env.example allowed', () => {
  assert.strictEqual(privacyBlock.check(pathEvent('/repo/.env.example'), makeCtx()), null);
});

test('privacy-block: APPROVED prefix allows', () => {
  assert.strictEqual(privacyBlock.check(pathEvent('APPROVED:/repo/.env'), makeCtx()), null);
});

test('privacy-block: cat .env in command blocked', () => {
  const r = privacyBlock.check(bashEvent('cat .env'), makeCtx());
  assert.ok(r && r.block);
});

test('privacy-block: credentials.json blocked', () => {
  const r = privacyBlock.check(pathEvent('config/credentials.json'), makeCtx());
  assert.ok(r && r.block);
});

test('secret-output: private key blocked', () => {
  const r = secretOutput.check(promptEvent('-----BEGIN RSA PRIVATE KEY-----\nabc'), makeCtx());
  assert.ok(r && /private key/.test(r.block));
});

test('secret-output: AWS key blocked', () => {
  const r = secretOutput.check(promptEvent('use AKIAIOSFODNN7EXAMPLE now'), makeCtx());
  assert.ok(r && /AWS/.test(r.block));
});

test('secret-output: inline credential blocked', () => {
  const r = secretOutput.check(promptEvent('password: hunter2secret'), makeCtx());
  assert.ok(r && /credential/.test(r.block));
});

test('secret-output: plain text allowed', () => {
  assert.strictEqual(secretOutput.check(promptEvent('please refactor the auth module'), makeCtx()), null);
});

test('secret-output: extraPatterns from config blocked', () => {
  const ctx = makeCtx({ options: { extraPatterns: [{ pattern: 'INTERNAL-[0-9]{4}', label: 'internal token' }] } });
  const r = secretOutput.check(promptEvent('token INTERNAL-1234'), ctx);
  assert.ok(r && /internal token/.test(r.block));
});

test('scout-block: node_modules read blocked', () => {
  const ctx = makeCtx();
  const r = scoutBlock.check(pathEvent(path.join(ctx.repoRoot, 'node_modules/react/index.js')), ctx);
  assert.ok(r && /node_modules/.test(r.block));
});

test('scout-block: source file allowed', () => {
  const ctx = makeCtx();
  assert.strictEqual(scoutBlock.check(pathEvent(path.join(ctx.repoRoot, 'src/index.js')), ctx), null);
});

test('scout-block: APPROVED prefix allows', () => {
  const ctx = makeCtx();
  assert.strictEqual(
    scoutBlock.check(pathEvent('APPROVED:' + path.join(ctx.repoRoot, 'node_modules/react/index.js')), ctx),
    null
  );
});

test('scout-block: custom ignore file respected', () => {
  const ctx = makeCtx();
  fs.writeFileSync(path.join(ctx.repoRoot, '.ckignore'), 'generated\n');
  const blocked = scoutBlock.check(pathEvent(path.join(ctx.repoRoot, 'generated/big.json')), ctx);
  assert.ok(blocked && /generated/.test(blocked.block));
  assert.strictEqual(scoutBlock.check(pathEvent(path.join(ctx.repoRoot, 'node_modules/x.js')), ctx), null);
});
