'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const specFirst = require('../src/core/guardrails/spec-first.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');

function gitRepo(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-spec-'));
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  run('git init -q');
  run('git config user.email t@t.t');
  run('git config user.name t');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  run('git add . && git commit -qm init');
  run(`git checkout -qb "${branch}"`);
  return { dir, run };
}

function stageCode(repo, rel) {
  const abs = path.join(repo.dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'code');
  repo.run(`git add "${rel}"`);
}

function ctxFor(repo, options = {}) {
  return {
    repoRoot: repo.dir,
    options: Object.assign({ codePathPatterns: ['^src/'], ticketPattern: 'EKB-\\d+' }, options),
    markers: createMarkers(path.join(repo.dir, '.agentkit', 'state')),
    log: () => {},
  };
}

function commitEvent(repo) {
  return { hookEvent: 'PreToolUse', toolName: 'Bash', command: 'git commit -m x', paths: [], prompt: '', cwd: repo.dir, sessionId: null };
}

test('spec-first: code on ticketless branch blocked', () => {
  const repo = gitRepo('feature/no-ticket');
  stageCode(repo, 'src/a.js');
  const r = specFirst.check(commitEvent(repo), ctxFor(repo));
  assert.ok(r && /no ticket/.test(r.block));
});

test('spec-first: ticket branch without spec blocked', () => {
  const repo = gitRepo('feat/EKB-1234-thing');
  stageCode(repo, 'src/a.js');
  const r = specFirst.check(commitEvent(repo), ctxFor(repo));
  assert.ok(r && /EKB-1234/.test(r.block) && /no spec/.test(r.block));
});

test('spec-first: ticket branch with spec allowed', () => {
  const repo = gitRepo('feat/EKB-1234-thing');
  stageCode(repo, 'src/a.js');
  const specDir = path.join(repo.dir, 'docs', 'specs', 'features', 'EKB-1234');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), '# spec');
  assert.strictEqual(specFirst.check(commitEvent(repo), ctxFor(repo)), null);
});

test('spec-first: non-code staged files allowed', () => {
  const repo = gitRepo('feature/no-ticket');
  stageCode(repo, 'docs/note.md');
  assert.strictEqual(specFirst.check(commitEvent(repo), ctxFor(repo)), null);
});

test('spec-first: marker exempts once', () => {
  const repo = gitRepo('feature/no-ticket');
  stageCode(repo, 'src/a.js');
  const ctx = ctxFor(repo);
  ctx.markers.place('spec-approved');
  assert.strictEqual(specFirst.check(commitEvent(repo), ctx), null);
  const r = specFirst.check(commitEvent(repo), ctx);
  assert.ok(r && r.block);
});

test('spec-first: custom specDirTemplate respected', () => {
  const repo = gitRepo('EKB-77');
  stageCode(repo, 'src/a.js');
  const specDir = path.join(repo.dir, 'specs', 'EKB-77');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'design.md'), '# d');
  const ctx = ctxFor(repo, { specDirTemplate: 'specs/{ticket}' });
  assert.strictEqual(specFirst.check(commitEvent(repo), ctx), null);
});

test('spec-first: requireSpecDir false enforces ticket only', () => {
  const withTicket = gitRepo('feat/AIS2-23-tracking');
  stageCode(withTicket, 'src/a.js');
  const ctx = ctxFor(withTicket, { ticketPattern: 'AIS2?-\\d+', requireSpecDir: false });
  assert.strictEqual(specFirst.check(commitEvent(withTicket), ctx), null);

  const noTicket = gitRepo('feature/no-ticket');
  stageCode(noTicket, 'src/a.js');
  const ctx2 = ctxFor(noTicket, { ticketPattern: 'AIS2?-\\d+', requireSpecDir: false });
  const r = specFirst.check(commitEvent(noTicket), ctx2);
  assert.ok(r && /no ticket/.test(r.block));
});

test('spec-first: non-commit command ignored', () => {
  const repo = gitRepo('feature/no-ticket');
  stageCode(repo, 'src/a.js');
  const event = Object.assign(commitEvent(repo), { command: 'git status' });
  assert.strictEqual(specFirst.check(event, ctxFor(repo)), null);
});
