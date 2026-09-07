'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN = path.join(__dirname, '..', 'src', 'adapters', 'claude', 'run.cjs');

function ekbRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-ekb-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'agentkit.config.json'), JSON.stringify({ project: 'EKB' }));
  return dir;
}

function runHook(name, input, cwd) {
  return spawnSync('node', [RUN, name], { input: JSON.stringify(input), encoding: 'utf8', cwd });
}

test('ekb pack: dev-rules-reminder injects once per session', () => {
  const repo = ekbRepo();
  const input = { hook_event_name: 'UserPromptSubmit', prompt: 'start', session_id: 's1', cwd: repo };
  const first = runHook('dev-rules-reminder', input, repo);
  assert.strictEqual(first.status, 0);
  assert.match(first.stdout, /additionalContext/);
  assert.match(first.stdout, /HARD STOP/);
  const second = runHook('dev-rules-reminder', input, repo);
  assert.strictEqual(second.stdout, '');
});

test('ekb pack: pr-body-contract blocks missing sections', () => {
  const repo = ekbRepo();
  const bad = path.join(repo, 'body.md');
  fs.writeFileSync(bad, '# Description\nhi EKB-1\n');
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: `gh pr create --title x --body-file ${bad}` }, cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /Type of change/);
});

test('ekb pack: pr-body-contract allows full body', () => {
  const repo = ekbRepo();
  const good = path.join(repo, 'body.md');
  fs.writeFileSync(good, '# Description\nhi\n## Type of change\n- [x] Docs\nEKB-2256\n');
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: `gh pr create --title x --body-file ${good}` }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('ekb pack: pr-body-contract skips PRs created in a different repo (cd elsewhere)', () => {
  const repo = ekbRepo();
  const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-other-'));
  const bad = path.join(otherRepo, 'body.md');
  fs.writeFileSync(bad, 'no template at all');
  const cmd = `cd ${otherRepo} && gh pr create --title x --body-file ${bad}`;
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: cmd }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('ekb pack: pr-body-contract still enforces after cd within the repo', () => {
  const repo = ekbRepo();
  fs.mkdirSync(path.join(repo, 'apps', 'web'), { recursive: true });
  const bad = path.join(repo, 'body.md');
  fs.writeFileSync(bad, 'nope');
  const cmd = `cd apps/web && gh pr create --title x --body-file ${bad}`;
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: cmd }, cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
});

test('ekb pack: precompact-capture writes snapshot with transcript', () => {
  const repo = ekbRepo();
  const r = runHook('precompact-capture', { hook_event_name: 'PreCompact', trigger: 'manual', transcript_path: '/tmp/t.jsonl', cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
  const snap = JSON.parse(fs.readFileSync(path.join(repo, '.agentkit', 'state', 'session-latest.json'), 'utf8'));
  assert.strictEqual(snap.transcript, '/tmp/t.jsonl');
  assert.strictEqual(snap.trigger, 'manual');
});

test('ekb pack: session-restore injects snapshot then silent when absent', () => {
  const repo = ekbRepo();
  const stateDir = path.join(repo, '.agentkit', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'session-latest.json'), JSON.stringify({ ts: 'T', branch: 'feat/EKB-1-x', ticket: 'EKB-1' }));
  const r = runHook('session-restore', { hook_event_name: 'SessionStart', cwd: repo }, repo);
  assert.match(r.stdout, /Resuming EKB session/);
  fs.rmSync(path.join(stateDir, 'session-latest.json'));
  const silent = runHook('session-restore', { hook_event_name: 'SessionStart', cwd: repo }, repo);
  assert.strictEqual(silent.stdout, '');
});

test('pack guardrail unavailable without project config', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-nopack-'));
  fs.mkdirSync(path.join(repo, '.git'));
  const r = runHook('dev-rules-reminder', { hook_event_name: 'UserPromptSubmit', prompt: 'x', cwd: repo }, repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /unknown guardrail/);
});

test('resolution precedence: built-in beats pack name, pack beats local', () => {
  const repo = ekbRepo();
  fs.mkdirSync(path.join(repo, '.agentkit', 'guardrails'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.agentkit', 'guardrails', 'pr-body-contract.cjs'),
    "module.exports = { name: 'pr-body-contract', events: ['PreToolUse'], matcher: 'Bash', check: () => ({ block: 'local-shadow' }) };"
  );
  const bad = path.join(repo, 'body.md');
  fs.writeFileSync(bad, 'nope');
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: `gh pr create --title x --body-file ${bad}` }, cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
  assert.doesNotMatch(r.stderr, /local-shadow/);
  assert.match(r.stderr, /Type of change/);
});

test('legacy alias: project "ekb" still resolves to the EKB pack, doctor warns', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-alias-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, 'agentkit.config.json'), JSON.stringify({ project: 'ekb' }));
  const r = runHook('dev-rules-reminder', { hook_event_name: 'UserPromptSubmit', prompt: 'x', session_id: 'sa1', cwd: repo }, repo);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /additionalContext/);
  const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');
  const doctor = require('node:child_process').spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo });
  assert.match(doctor.stdout, /legacy alias — rename to "EKB"/);
});

test('empty pack: reserved name resolves, no guardrails, no error', () => {
  const { packExists, loadPack } = require('../src/core/lib/projects.cjs');
  for (const p of ['b2b-survey', 'arches-fe', 'arches-internal-system']) {
    assert.strictEqual(packExists(p), true, `${p} pack dir exists`);
    const loaded = loadPack(p);
    assert.deepStrictEqual(loaded.errors, [], `${p} loads clean`);
    assert.strictEqual(loaded.guardrails.length, 0, `${p} has no guardrails yet`);
  }
});
