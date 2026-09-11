'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('../src/core/guardrails/spec-conformance.cjs');
const { parseAcceptanceCriteria } = require('../src/core/lib/pr.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');

function repoOnBranch(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-conf-'));
  const run = (c) => execSync(c, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  run('git init -q'); run('git config user.email t@t.t'); run('git config user.name t');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x'); run('git add . && git commit -qm init');
  run(`git checkout -qb "${branch}"`);
  return dir;
}

function writeSpec(dir, ticket, body) {
  const d = path.join(dir, 'docs/specs/features', ticket);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'spec.md'), body);
}

function ctx(dir, options) {
  return { repoRoot: dir, options: options || {}, markers: createMarkers(path.join(dir, '.agentkit/state')), log: () => {} };
}

function prCreate(body, dir) {
  const bf = path.join(dir, '_body.md');
  fs.writeFileSync(bf, body);
  return { hookEvent: 'PreToolUse', toolName: 'Bash', command: `gh pr create --title x --body-file ${bf}`, paths: [], prompt: '', cwd: dir, sessionId: null };
}

const SPEC = `# EKB-1 — x

## Acceptance Criteria
- [ ] search caps at 100 results
- [ ] empty query returns nothing
`;

test('parseAcceptanceCriteria: extracts checklist items with state', () => {
  const acs = parseAcceptanceCriteria(SPEC);
  assert.strictEqual(acs.length, 2);
  assert.deepStrictEqual(acs.map((a) => a.text), ['search caps at 100 results', 'empty query returns nothing']);
});

test('disabled by default: no block even on gh pr create', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  writeSpec(dir, 'EKB-1', SPEC);
  assert.strictEqual(guard.check(prCreate('whatever', dir), ctx(dir)), null);
});

test('non-pr-create command ignored', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  const e = { hookEvent: 'PreToolUse', toolName: 'Bash', command: 'git status', paths: [], prompt: '', cwd: dir, sessionId: null };
  assert.strictEqual(guard.check(e, ctx(dir, { requireAcChecklist: true })), null);
});

// --- Tier 1: AC checklist ---

test('requireAcChecklist: all ACs ticked in body → pass', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  writeSpec(dir, 'EKB-1', SPEC);
  const body = '## Acceptance Criteria\n- [x] search caps at 100 results\n- [x] empty query returns nothing\n';
  assert.strictEqual(guard.check(prCreate(body, dir), ctx(dir, { requireAcChecklist: true })), null);
});

test('requireAcChecklist: an AC missing from body → block', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  writeSpec(dir, 'EKB-1', SPEC);
  const body = '- [x] search caps at 100 results\n'; // second AC absent
  const r = guard.check(prCreate(body, dir), ctx(dir, { requireAcChecklist: true }));
  assert.ok(r && /1 of 2 Acceptance Criteria/.test(r.block), r && r.block);
  assert.match(r.block, /empty query returns nothing/);
});

test('requireAcChecklist: AC present but unticked → block', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  writeSpec(dir, 'EKB-1', SPEC);
  const body = '- [x] search caps at 100 results\n- [ ] empty query returns nothing\n';
  const r = guard.check(prCreate(body, dir), ctx(dir, { requireAcChecklist: true }));
  assert.ok(r && /not accounted for/.test(r.block));
});

test('requireAcChecklist: spec with no ACs → pass (nothing to enforce)', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  writeSpec(dir, 'EKB-1', '# EKB-1\n\nno criteria here\n');
  assert.strictEqual(guard.check(prCreate('x', dir), ctx(dir, { requireAcChecklist: true })), null);
});

test('requireAcChecklist: no ticket in branch → pass', () => {
  const dir = repoOnBranch('feature/no-ticket');
  const r = guard.check(prCreate('x', dir), ctx(dir, { requireAcChecklist: true }));
  assert.strictEqual(r, null);
});

// --- Tier 2: spec-check marker ---

test('requireSpecCheck: marker absent → block', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  writeSpec(dir, 'EKB-1', SPEC);
  const r = guard.check(prCreate('x', dir), ctx(dir, { requireSpecCheck: true }));
  assert.ok(r && /spec-check review/.test(r.block));
});

test('requireSpecCheck: marker present → pass', () => {
  const dir = repoOnBranch('feat/EKB-1-x');
  writeSpec(dir, 'EKB-1', SPEC);
  const c = ctx(dir, { requireSpecCheck: true });
  c.markers.place('spec-check-passed');
  assert.strictEqual(guard.check(prCreate('x', dir), c), null);
});
