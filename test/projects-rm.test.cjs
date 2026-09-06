'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN = path.join(__dirname, '..', 'src', 'adapters', 'claude', 'run.cjs');

function rmRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-rm-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'agentkit.config.json'), JSON.stringify({ project: 'Referral-Management' }));
  return dir;
}

// A real git repo for the spec-in-commit guardrail (it runs git rev-parse / diff --cached).
function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-rmgit-'));
  const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t.t']);
  g(['config', 'user.name', 't']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'agentkit.config.json'), JSON.stringify({ project: 'Referral-Management' }));
  return dir;
}

function stage(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content || 'x');
  spawnSync('git', ['add', rel], { cwd: dir });
}

function runHook(name, input, cwd) {
  return spawnSync('node', [RUN, name], { input: JSON.stringify(input), encoding: 'utf8', cwd });
}

const commit = (dir) => ({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: dir });

test('rm pack: pr-body-contract blocks missing sections', () => {
  const repo = rmRepo();
  const bad = path.join(repo, 'body.md');
  fs.writeFileSync(bad, '## Summary\nhi\n');
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: `gh pr create --title x --body-file ${bad}` }, cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /## Changes/);
  assert.match(r.stderr, /## Checklist/);
});

test('rm pack: pr-body-contract allows full RM body', () => {
  const repo = rmRepo();
  const good = path.join(repo, 'body.md');
  fs.writeFileSync(good, '## Summary\nx\n## Changes\ny\n## Checklist\n- [x] done\n');
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: `gh pr create --title x --body-file ${good}` }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('rm pack: pr-body-contract skips when no explicit body (template applies)', () => {
  const repo = rmRepo();
  const r = runHook('pr-body-contract', { tool_name: 'Bash', tool_input: { command: 'gh pr create --title x --fill' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('rm pack: spec-in-commit blocks code without a spec staged', () => {
  const repo = gitRepo();
  stage(repo, 'src/foo.ts', 'export const x = 1;');
  const r = runHook('spec-in-commit', commit(repo), repo);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no spec in this commit/);
});

test('rm pack: spec-in-commit allows when a spec is staged in the same commit', () => {
  const repo = gitRepo();
  stage(repo, 'src/foo.ts', 'export const x = 1;');
  stage(repo, 'docs/features/2026-09-05-foo.md', '# spec');
  const r = runHook('spec-in-commit', commit(repo), repo);
  assert.strictEqual(r.status, 0);
});

test('rm pack: spec-in-commit ignores test-only code', () => {
  const repo = gitRepo();
  stage(repo, 'src/foo.test.ts', 'test');
  const r = runHook('spec-in-commit', commit(repo), repo);
  assert.strictEqual(r.status, 0);
});

test('rm pack: spec-in-commit one-shot marker allows once', () => {
  const repo = gitRepo();
  stage(repo, 'src/foo.ts', 'export const x = 1;');
  const markerDir = path.join(repo, '.agentkit', 'state');
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, 'spec-approved'), '');
  const first = runHook('spec-in-commit', commit(repo), repo);
  assert.strictEqual(first.status, 0);
  const second = runHook('spec-in-commit', commit(repo), repo);
  assert.strictEqual(second.status, 2, 'marker must be one-shot');
});

test('rm pack: spec-in-commit ignores non-commit commands', () => {
  const repo = gitRepo();
  stage(repo, 'src/foo.ts', 'export const x = 1;');
  const r = runHook('spec-in-commit', { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('rm pack: dev-rules-reminder full on SessionStart, terse on prompt', () => {
  const repo = rmRepo();
  const full = runHook('dev-rules-reminder', { hook_event_name: 'SessionStart', cwd: repo }, repo);
  assert.strictEqual(full.status, 0);
  assert.match(full.stdout, /core gates/);
  assert.match(full.stdout, /4-layer boundaries/);
  const terse = runHook('dev-rules-reminder', { hook_event_name: 'UserPromptSubmit', prompt: 'x', cwd: repo }, repo);
  assert.strictEqual(terse.status, 0);
  assert.match(terse.stdout, /\[gates\]/);
  assert.doesNotMatch(terse.stdout, /4-layer boundaries/);
});

test('rm pack unavailable without project config', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-nopack-'));
  fs.mkdirSync(path.join(repo, '.git'));
  const r = runHook('spec-in-commit', commit(repo), repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /unknown guardrail/);
});
