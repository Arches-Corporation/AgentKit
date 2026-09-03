'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN = path.join(__dirname, '..', 'src', 'adapters', 'cursor', 'run.cjs');
const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-cursor-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function runEvent(eventName, input, cwd) {
  const r = spawnSync('node', [RUN, eventName], { input: JSON.stringify(input), encoding: 'utf8', cwd });
  return { status: r.status, out: JSON.parse(r.stdout || '{}') };
}

test('cursor: git commit denied on beforeShellExecution', () => {
  const repo = tmpRepo();
  const r = runEvent('beforeShellExecution', { command: 'git commit -m x', cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.out.permission, 'deny');
  assert.match(r.out.agentMessage, /HARD STOP/);
});

test('cursor: benign command allowed', () => {
  const repo = tmpRepo();
  const r = runEvent('beforeShellExecution', { command: 'ls -la', cwd: repo }, repo);
  assert.strictEqual(r.out.permission, 'allow');
});

test('cursor: .env read denied on beforeReadFile', () => {
  const repo = tmpRepo();
  const r = runEvent('beforeReadFile', { file_path: path.join(repo, '.env'), cwd: repo }, repo);
  assert.strictEqual(r.out.permission, 'deny');
  assert.match(r.out.agentMessage, /secrets/);
});

test('cursor: secret prompt stops beforeSubmitPrompt', () => {
  const repo = tmpRepo();
  const r = runEvent('beforeSubmitPrompt', { prompt: 'password: hunter2secret', cwd: repo }, repo);
  assert.strictEqual(r.out.continue, false);
});

test('cursor: clean prompt continues', () => {
  const repo = tmpRepo();
  const r = runEvent('beforeSubmitPrompt', { prompt: 'refactor the auth module', cwd: repo }, repo);
  assert.strictEqual(r.out.continue, true);
});

test('cursor: workspace_roots used as cwd fallback', () => {
  const repo = tmpRepo();
  const r = runEvent('beforeShellExecution', { command: 'git push --force origin x', workspace_roots: [repo] }, repo);
  assert.strictEqual(r.out.permission, 'deny');
  assert.match(r.out.agentMessage, /HARD STOP|force push/);
});

test('cursor: unknown event allows', () => {
  const repo = tmpRepo();
  const r = runEvent('afterFileEdit', { cwd: repo }, repo);
  assert.strictEqual(r.out.permission, 'allow');
});

test('cursor: init --tool cursor writes hooks.json idempotently', () => {
  const repo = tmpRepo();
  spawnSync('node', [CLI, 'init', '--tool', 'cursor'], { encoding: 'utf8', cwd: repo });
  spawnSync('node', [CLI, 'init', '--tool', 'cursor'], { encoding: 'utf8', cwd: repo });
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.cursor', 'hooks.json'), 'utf8'));
  assert.strictEqual(cfg.version, 1);
  assert.strictEqual(cfg.hooks.beforeShellExecution.length, 1);
  assert.ok(cfg.hooks.beforeSubmitPrompt);
});
