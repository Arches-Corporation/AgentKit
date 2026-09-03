'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN = path.join(__dirname, '..', 'src', 'adapters', 'claude', 'run.cjs');

function runHook(name, input, cwd) {
  return spawnSync('node', [RUN, name], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
  });
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-adapter-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

test('adapter: hard-stop blocks git commit with exit 2', () => {
  const repo = tmpRepo();
  const r = runHook('hard-stop', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /HARD STOP/);
});

test('adapter: hard-stop allows benign command with exit 0', () => {
  const repo = tmpRepo();
  const r = runHook('hard-stop', { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('adapter: disabled guardrail exits 0', () => {
  const repo = tmpRepo();
  fs.writeFileSync(
    path.join(repo, 'agentkit.config.json'),
    JSON.stringify({ guardrails: { 'hard-stop': { enabled: false } } })
  );
  const r = runHook('hard-stop', { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('adapter: unknown guardrail exits 1', () => {
  const r = runHook('nope', {});
  assert.strictEqual(r.status, 1);
});

test('adapter: privacy-block blocks .env via tool path', () => {
  const repo = tmpRepo();
  const r = runHook('privacy-block', { tool_name: 'Read', tool_input: { file_path: path.join(repo, '.env') }, cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
});

test('adapter: secret-output blocks prompt with credential', () => {
  const repo = tmpRepo();
  const r = runHook('secret-output', { prompt: 'password: supersecret99', cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
});

test('adapter: empty stdin exits 0', () => {
  const repo = tmpRepo();
  const r = spawnSync('node', [RUN, 'hard-stop'], { input: '', encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 0);
});
