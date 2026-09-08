'use strict';

// Regression suite for the v2.5.0 security hardening — each case maps to a
// pentest finding against v2.4.1.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN = path.join(__dirname, '..', 'src', 'adapters', 'claude', 'run.cjs');
const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');

const hardStop = require('../src/core/guardrails/hard-stop.cjs');
const forcePush = require('../src/core/guardrails/force-push-guard.cjs');
const tamperGuard = require('../src/core/guardrails/tamper-guard.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');
const { insideRepo, stateDir } = require('../src/core/lib/config.cjs');
const { removeAssets } = require('../src/core/lib/uninstall.cjs');
const { gitSubcommand } = require('../src/core/lib/text.cjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-sec-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function ctxFor(repo, options = {}) {
  return {
    repoRoot: repo,
    options,
    markers: createMarkers(path.join(repo, '.agentkit', 'state')),
    log: () => {},
  };
}

function bashEvent(command, cwd) {
  return { hookEvent: 'PreToolUse', toolName: 'Bash', command, paths: [], prompt: '', cwd, sessionId: null };
}

// --- finding 4: shell-wrapper bypasses -------------------------------------

const WRAPPER_FORMS = [
  'command git commit -m x',
  '\\git commit -m x',
  'env git commit -m x',
  'sh -c "git push origin main"',
  'xargs git push',
  '$(git push)',
  'bash -c \'git commit -m x\'',
  'nohup git push &',
  'timeout 30 git push',
];

for (const form of WRAPPER_FORMS) {
  test(`hard-stop blocks wrapper form: ${form}`, () => {
    const repo = tmpRepo();
    const r = hardStop.check(bashEvent(form, repo), ctxFor(repo));
    assert.ok(r && r.block, `expected block for: ${form}`);
    assert.match(r.block, /HARD STOP/);
  });
}

test('hard-stop block message does not reveal the marker path or mechanism', () => {
  const repo = tmpRepo();
  const r = hardStop.check(bashEvent('git commit -m x', repo), ctxFor(repo));
  assert.ok(r && r.block);
  assert.doesNotMatch(r.block, /touch/);
  assert.doesNotMatch(r.block, /\.agentkit/);
  assert.doesNotMatch(r.block, /approve/);
});

test('hard-stop still ignores prose mentions of git commit', () => {
  const repo = tmpRepo();
  for (const benign of ['echo "git commit is fun"', 'git log --grep commit', 'node -e "console.log(\'git push\')"']) {
    const r = hardStop.check(bashEvent(benign, repo), ctxFor(repo));
    assert.strictEqual(r, null, `false positive on: ${benign}`);
  }
});

test('force-push-guard blocks wrapped force push', () => {
  const repo = tmpRepo();
  for (const form of ['\\git push --force', 'env git push -f origin x', 'sh -c "git push --force"']) {
    const r = forcePush.check(bashEvent(form, repo), ctxFor(repo));
    assert.ok(r && r.block, `expected block for: ${form}`);
  }
});

test('gitSubcommand still resolves plain forms', () => {
  assert.strictEqual(gitSubcommand('git commit -m x'), 'commit');
  assert.strictEqual(gitSubcommand('git -C sub push'), 'push');
  assert.strictEqual(gitSubcommand('FOO=bar git push'), 'push');
  assert.strictEqual(gitSubcommand('echo git commit'), null);
});

// --- finding 3: marker must not survive a failed unlink ---------------------

test('marker consume fails closed when unlink fails', { skip: process.getuid && process.getuid() === 0 }, () => {
  const repo = tmpRepo();
  const state = path.join(repo, '.agentkit', 'state');
  const markers = createMarkers(state);
  markers.place('git-approved');
  fs.chmodSync(state, 0o500);
  try {
    assert.strictEqual(markers.consume('git-approved'), false);
  } finally {
    fs.chmodSync(state, 0o700);
  }
});

// --- findings 1+2: tamper-guard --------------------------------------------

test('tamper-guard blocks Edit/Write to the enforcement layer', () => {
  const repo = tmpRepo();
  for (const p of [
    path.join(repo, 'agentkit.config.json'),
    path.join(repo, '.agentkit', 'state', 'git-approved'),
    path.join(repo, '.claude', 'settings.json'),
  ]) {
    const event = { hookEvent: 'PreToolUse', toolName: 'Write', command: '', paths: [p], prompt: '', cwd: repo, sessionId: null };
    const r = tamperGuard.check(event, ctxFor(repo));
    assert.ok(r && r.block, `expected block for path: ${p}`);
  }
});

test('tamper-guard blocks shell mutation of the enforcement layer', () => {
  const repo = tmpRepo();
  for (const cmd of [
    'touch .agentkit/state/git-approved',
    'echo "{}" > agentkit.config.json',
    'rm -rf .agentkit',
    'chmod 500 .agentkit/state',
    'sed -i "" -e s/x/y/ .claude/settings.json',
  ]) {
    const r = tamperGuard.check(bashEvent(cmd, repo), ctxFor(repo));
    assert.ok(r && r.block, `expected block for: ${cmd}`);
  }
});

test('tamper-guard blocks agent-run agentkit approve', () => {
  const repo = tmpRepo();
  const r = tamperGuard.check(bashEvent('npx agentkit approve', repo), ctxFor(repo));
  assert.ok(r && r.block);
  assert.match(r.block, /USER/);
});

test('tamper-guard allows normal work', () => {
  const repo = tmpRepo();
  for (const cmd of [
    'npx agentkit sync',
    'npx agentkit doctor',
    'cat agentkit.config.json',
    'git status',
    'touch src/new-file.ts',
    'npm test > out.log',
  ]) {
    const r = tamperGuard.check(bashEvent(cmd, repo), ctxFor(repo));
    assert.strictEqual(r, null, `false positive on: ${cmd}`);
  }
  const readEvent = { hookEvent: 'PreToolUse', toolName: 'Read', command: '', paths: [path.join(tmpRepo(), 'src', 'a.ts')], prompt: '', cwd: '/', sessionId: null };
  assert.strictEqual(tamperGuard.check(readEvent, ctxFor(tmpRepo())), null);
});

test('tamper-guard cannot be disabled via config (adapter honors alwaysOn)', () => {
  const repo = tmpRepo();
  fs.writeFileSync(
    path.join(repo, 'agentkit.config.json'),
    JSON.stringify({ guardrails: { 'tamper-guard': { enabled: false } } })
  );
  const input = { tool_name: 'Bash', tool_input: { command: 'touch .agentkit/state/git-approved' }, cwd: repo };
  const r = spawnSync('node', [RUN, 'tamper-guard'], { input: JSON.stringify(input), encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /enforcement layer/);
});

// --- finding 5: malformed stdin must fail closed ----------------------------

test('adapter: malformed stdin blocks for fail-closed guardrail', () => {
  const repo = tmpRepo();
  const r = spawnSync('node', [RUN, 'hard-stop'], { input: 'not{json', encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
});

test('adapter: malformed stdin still allows for fail-open guardrail', () => {
  const repo = tmpRepo();
  const r = spawnSync('node', [RUN, 'rules-reminder'], { input: 'not{json', encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 0);
});

test('adapter: empty stdin still exits 0 (manual invocation)', () => {
  const repo = tmpRepo();
  const r = spawnSync('node', [RUN, 'hard-stop'], { input: '', encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 0);
});

// --- finding 6: inject output carries hookEventName --------------------------

test('adapter: inject output includes hookEventName', () => {
  const repo = tmpRepo();
  const input = { hook_event_name: 'UserPromptSubmit', prompt: 'hello', cwd: repo };
  const r = spawnSync('node', [RUN, 'rules-reminder'], { input: JSON.stringify(input), encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 0);
  if (r.stdout.trim()) {
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.ok(out.hookSpecificOutput.additionalContext);
  }
});

// --- finding 8: path containment --------------------------------------------

test('insideRepo rejects traversal and absolute paths', () => {
  const repo = tmpRepo();
  assert.strictEqual(insideRepo(repo, 'docs/a.md'), true);
  assert.strictEqual(insideRepo(repo, '../outside.txt'), false);
  assert.strictEqual(insideRepo(repo, 'a/../../outside.txt'), false);
  assert.strictEqual(insideRepo(repo, '/etc/passwd'), false);
});

test('stateDir clamps an escaping config value to the default', () => {
  const repo = tmpRepo();
  const p = stateDir({ stateDir: '../../outside' }, repo);
  assert.strictEqual(p, path.resolve(repo, '.agentkit/state'));
});

test('uninstall removeAssets refuses targets outside the repo', () => {
  const repo = tmpRepo();
  const victim = path.join(os.tmpdir(), `agentkit-victim-${process.pid}.txt`);
  fs.writeFileSync(victim, 'do not delete');
  try {
    const rel = path.relative(repo, victim);
    const removed = removeAssets(repo, { entries: [{ name: 'x', kind: 'skill', target: rel, hash: '' }] });
    assert.deepStrictEqual(removed, []);
    assert.ok(fs.existsSync(victim));
  } finally {
    try { fs.rmSync(victim); } catch { /* gone */ }
  }
});

test('sync refuses manifest delete targets outside the repo', () => {
  const repo = tmpRepo();
  const victim = path.join(os.tmpdir(), `agentkit-victim-sync-${process.pid}.txt`);
  fs.writeFileSync(victim, 'do not delete');
  fs.mkdirSync(path.join(repo, '.agentkit'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'agentkit.config.json'),
    JSON.stringify({
      skills: { exclude: ['deep-review', 'jira-ticket', 'performance-optimization', 'pr-review', 'security-audit', 'sentry-investigator', 'spec-check'] },
      agents: false,
    })
  );
  fs.writeFileSync(
    path.join(repo, '.agentkit', 'skills.manifest.json'),
    JSON.stringify({ version: 2, kitVersion: '0.0.0', entries: [{ name: 'zzz', kind: 'skill', target: path.relative(repo, victim), hash: 'x' }] })
  );
  try {
    const r = spawnSync('node', [CLI, 'sync'], { encoding: 'utf8', cwd: repo });
    assert.match(r.stderr, /escapes the repo — skipped/);
    assert.ok(fs.existsSync(victim));
  } finally {
    try { fs.rmSync(victim); } catch { /* gone */ }
  }
});
