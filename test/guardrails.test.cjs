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

test('hard-stop: -n outside the git segment does not trip --no-verify', () => {
  const ctx = makeCtx();
  ctx.markers.place('git-approved');
  const cmd = 'git commit -m "fix stuff" && bash -n script.sh';
  assert.strictEqual(hardStop.check(bashEvent(cmd), ctx), null);
});

test('hard-stop: -n inside quoted commit message does not trip', () => {
  const ctx = makeCtx();
  ctx.markers.place('git-approved');
  const cmd = 'git commit -m "verified via bash -n and --no-verify docs"';
  assert.strictEqual(hardStop.check(bashEvent(cmd), ctx), null);
});

test('hard-stop: real -n flag on commit still blocked even with marker', () => {
  const ctx = makeCtx();
  ctx.markers.place('git-approved');
  const r = hardStop.check(bashEvent('git commit -n -m "x"'), ctx);
  assert.ok(r && /no-verify/.test(r.block));
});

test('hard-stop: --no-verify in non-git segment allowed', () => {
  const ctx = makeCtx();
  ctx.markers.place('git-approved');
  const cmd = 'echo --no-verify > note.txt && git commit -m ok';
  assert.strictEqual(hardStop.check(bashEvent(cmd), ctx), null);
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

test('privacy-block: cat .env in command blocked when the file exists', () => {
  const ctx = makeCtx();
  fs.writeFileSync(path.join(ctx.repoRoot, '.env'), 'SECRET=1');
  const ev = bashEvent('cat .env');
  ev.cwd = ctx.repoRoot;
  const r = privacyBlock.check(ev, ctx);
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

test('secret-output: vendor token types blocked (GitHub, OpenAI, Slack, JWT, Sentry)', () => {
  const cases = [
    ['ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6', /GitHub/],
    ['sk-' + 'abcdefghij1234567890KLMNOP', /OpenAI/],
    ['xoxb-1234567890-abcdefghijk', /Slack/],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c', /JWT/],
    ['sntryu_' + 'a'.repeat(40), /Sentry/],
  ];
  for (const [token, label] of cases) {
    const r = secretOutput.check(promptEvent(`use ${token} here`), makeCtx());
    assert.ok(r && label.test(r.block), `${label} should block, got ${r && r.block}`);
  }
});

test('hard-stop: newline-separated git commit segment still caught', () => {
  const r = hardStop.check(bashEvent('echo prep\ngit commit -m sneaky'), makeCtx());
  assert.ok(r && /HARD STOP/.test(r.block));
});

test('hard-stop: commands merely MENTIONING git push/commit do not block (real FP regressions)', () => {
  const cases = [
    'gh pr create --title x --body "HARD STOP: never git commit or git push without approval"',
    `node -e "console.log('git push blocks?', true)"`,
    'echo "run git commit only after approval" > note.txt',
    'grep -rn "git push" docs/',
  ];
  for (const cmd of cases) {
    assert.strictEqual(hardStop.check(bashEvent(cmd), makeCtx()), null, `should allow: ${cmd}`);
  }
});

test('hard-stop: commit/push only counts in subcommand position', () => {
  assert.strictEqual(hardStop.check(bashEvent('git log --grep commit'), makeCtx()), null);
  assert.strictEqual(hardStop.check(bashEvent('git checkout push-notifications'), makeCtx()), null);
  const envPrefixed = hardStop.check(bashEvent('GIT_AUTHOR_NAME=x git push origin main'), makeCtx());
  assert.ok(envPrefixed && envPrefixed.block, 'env-prefixed git push must block');
  const dashC = hardStop.check(bashEvent('git -C /some/repo commit -m x'), makeCtx());
  assert.ok(dashC && dashC.block, 'git -C <path> commit must block');
  const quoted = hardStop.check(bashEvent('git "commit" -m x'), makeCtx());
  assert.ok(quoted && quoted.block, 'quoted subcommand must not evade');
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

test('privacy-block: heredoc token like matrix.env does not block (real FP regression)', () => {
  const ctx = makeCtx();
  const cmd = `cd ${ctx.repoRoot} && python3 - <<'PYEOF'\nkey = "EKB_PLAN_ROLE_ARN_" + env  # uses matrix.env expression\nprint('\${{ matrix.env }}')\nPYEOF`;
  assert.strictEqual(privacyBlock.check(bashEvent(cmd), ctx), null);
});

test('privacy-block: command token blocks only when file exists', () => {
  const ctx = makeCtx();
  const ev = bashEvent('cat .env');
  ev.cwd = ctx.repoRoot;
  assert.strictEqual(privacyBlock.check(ev, ctx), null);
  fs.writeFileSync(path.join(ctx.repoRoot, '.env'), 'SECRET=1');
  const r = privacyBlock.check(ev, ctx);
  assert.ok(r && /secrets/.test(r.block));
});

test('privacy-block: tool path stays strict even when file does not exist (Write new .env)', () => {
  const ctx = makeCtx();
  const r = privacyBlock.check(pathEvent(path.join(ctx.repoRoot, 'nonexistent', '.env')), ctx);
  assert.ok(r && r.block);
});

test('scout-block: bare prose words in heredocs/commands do not block (real FP regression)', () => {
  const ctx = makeCtx();
  const heredoc = `python3 - <<'EOF'\nfor dist in ['a']:\n    print('vendor', 'storage')\nEOF`;
  assert.strictEqual(scoutBlock.check(bashEvent(heredoc), ctx), null);
  assert.strictEqual(scoutBlock.check(bashEvent('echo vendor storage dist'), ctx), null);
});

test('scout-block: bare word still blocks when the ignored dir exists', () => {
  const ctx = makeCtx();
  fs.mkdirSync(path.join(ctx.repoRoot, 'vendor'));
  const r = scoutBlock.check(bashEvent('grep -r foo vendor'), ctx);
  assert.ok(r && /vendor/.test(r.block));
});

test('scout-block: slashed command target still blocks without existence', () => {
  const ctx = makeCtx();
  const r = scoutBlock.check(bashEvent('grep -r foo node_modules/react'), ctx);
  assert.ok(r && /node_modules/.test(r.block));
});

test('scout-block: custom ignore file respected', () => {
  const ctx = makeCtx();
  fs.writeFileSync(path.join(ctx.repoRoot, '.ckignore'), 'generated\n');
  const blocked = scoutBlock.check(pathEvent(path.join(ctx.repoRoot, 'generated/big.json')), ctx);
  assert.ok(blocked && /generated/.test(blocked.block));
  assert.strictEqual(scoutBlock.check(pathEvent(path.join(ctx.repoRoot, 'node_modules/x.js')), ctx), null);
});
