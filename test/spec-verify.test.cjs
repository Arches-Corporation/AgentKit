'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');
const { parseAcceptanceCriteria } = require('../src/core/lib/pr.cjs');

function repo(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-verify-'));
  execSync('git init -q', { cwd: dir });
  if (config) fs.writeFileSync(path.join(dir, 'agentkit.config.json'), JSON.stringify(config));
  return dir;
}

function spec(dir, ticket, body) {
  const d = path.join(dir, 'docs/specs/features', ticket);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'spec.md'), body);
}

function run(dir, ticket) {
  return spawnSync('node', [CLI, 'spec-verify', ticket], { cwd: dir, encoding: 'utf8' });
}

// testCommand: `sh -c 'exit N'` where the AC's {test} is the exit code — lets a
// test model pass/fail deterministically without real test infra.
const CFG = { guardrails: { 'spec-conformance': { testCommand: 'sh -c "exit {test}"' } } };

test('parseAcceptanceCriteria: captures {test:…} ref and strips it from text', () => {
  const acs = parseAcceptanceCriteria('## Acceptance Criteria\n- [ ] caps at 100 {test: 0}\n');
  assert.strictEqual(acs[0].text, 'caps at 100');
  assert.strictEqual(acs[0].test, '0');
});

test('spec-verify: all linked ACs pass → exit 0', () => {
  const dir = repo(CFG);
  spec(dir, 'EKB-1', '## Acceptance Criteria\n- [ ] a {test: 0}\n- [ ] b {test: 0}\n');
  const r = run(dir, 'EKB-1');
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /2\/2 ACs proven/);
});

test('spec-verify: a failing linked test → exit 1', () => {
  const dir = repo(CFG);
  spec(dir, 'EKB-2', '## Acceptance Criteria\n- [ ] a {test: 0}\n- [ ] b {test: 1}\n');
  const r = run(dir, 'EKB-2');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /1 failing/);
});

test('spec-verify: an unlinked AC → exit 1 (not proven)', () => {
  const dir = repo(CFG);
  spec(dir, 'EKB-3', '## Acceptance Criteria\n- [ ] a {test: 0}\n- [ ] b has no test ref\n');
  const r = run(dir, 'EKB-3');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /unlinked AC/);
});

test('spec-verify: no testCommand configured → error', () => {
  const dir = repo({ guardrails: { 'spec-conformance': {} } });
  spec(dir, 'EKB-4', '## Acceptance Criteria\n- [ ] a {test: 0}\n');
  const r = run(dir, 'EKB-4');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /testCommand/);
});

test('spec-verify: no ACs in spec → error', () => {
  const dir = repo(CFG);
  spec(dir, 'EKB-5', '# EKB-5\n\nnothing\n');
  const r = run(dir, 'EKB-5');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /no Acceptance Criteria/);
});
