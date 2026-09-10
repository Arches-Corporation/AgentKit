'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');

function gitRepo(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-scaffold-'));
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  run('git init -q');
  run('git config user.email t@t.t');
  run('git config user.name t');
  if (config) fs.writeFileSync(path.join(dir, 'agentkit.config.json'), JSON.stringify(config));
  return dir;
}

function spec(dir, args) {
  return spawnSync('node', [CLI, 'spec', ...args], { cwd: dir, encoding: 'utf8' });
}

const LANE_CFG = {
  guardrails: {
    'spec-first': {
      ticketUrlTemplate: 'https://jira/browse/{ticket}',
      lanes: {
        full: { triggers: ['db/migrate/'], requires: ['proposal.md', 'design.md', 'tasks.md'] },
        default: { requires: ['spec.md'] },
      },
    },
  },
};

test('spec: --light scaffolds spec.md with ticket + url filled', () => {
  const dir = gitRepo(LANE_CFG);
  const r = spec(dir, ['EKB-100', '--light']);
  assert.strictEqual(r.status, 0);
  const p = path.join(dir, 'docs/specs/features/EKB-100/spec.md');
  assert.ok(fs.existsSync(p));
  const body = fs.readFileSync(p, 'utf8');
  assert.match(body, /EKB-100/);
  assert.match(body, /https:\/\/jira\/browse\/EKB-100/);
  assert.doesNotMatch(body, /\{\{/);
});

test('spec: --full scaffolds proposal + design + tasks', () => {
  const dir = gitRepo(LANE_CFG);
  const r = spec(dir, ['EKB-101', '--full']);
  assert.strictEqual(r.status, 0);
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) {
    assert.ok(fs.existsSync(path.join(dir, 'docs/specs/features/EKB-101', f)), `missing ${f}`);
  }
});

test('spec: auto-detects full lane from a staged migration', () => {
  const dir = gitRepo(LANE_CFG);
  const f = path.join(dir, 'src/db/migrate/2026_add.js');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  execSync('git add .', { cwd: dir });
  const r = spec(dir, ['EKB-102']);
  assert.match(r.stdout, /full lane/);
  assert.ok(fs.existsSync(path.join(dir, 'docs/specs/features/EKB-102/design.md')));
});

test('spec: auto-detects light lane from a plain source change', () => {
  const dir = gitRepo(LANE_CFG);
  const f = path.join(dir, 'src/View.js');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  execSync('git add .', { cwd: dir });
  const r = spec(dir, ['EKB-103']);
  assert.match(r.stdout, /light lane/);
  assert.ok(fs.existsSync(path.join(dir, 'docs/specs/features/EKB-103/spec.md')));
});

test('spec: idempotent — keeps an existing file, does not clobber', () => {
  const dir = gitRepo(LANE_CFG);
  spec(dir, ['EKB-104', '--light']);
  const p = path.join(dir, 'docs/specs/features/EKB-104/spec.md');
  fs.writeFileSync(p, 'MY EDITS');
  const r = spec(dir, ['EKB-104', '--light']);
  assert.match(r.stdout, /kept \(already present\)/);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'MY EDITS');
});

test('spec: invalid ticket rejected', () => {
  const dir = gitRepo(LANE_CFG);
  const r = spec(dir, ['not-a-ticket']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /ticket id/);
});

test('spec: no lanes config → defaults to light lane', () => {
  const dir = gitRepo({ guardrails: { 'spec-first': {} } });
  const r = spec(dir, ['EKB-105']);
  assert.strictEqual(r.status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'docs/specs/features/EKB-105/spec.md')));
});
