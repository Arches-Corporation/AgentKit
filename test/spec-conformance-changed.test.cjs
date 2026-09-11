'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const guard = require('../src/core/guardrails/spec-conformance.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');

function ctx(dir, options) {
  return { repoRoot: dir, options: options || {}, markers: createMarkers(path.join(dir, '.agentkit/state')), log: () => {} };
}

// specSource: "changed" — flat specs (spec-in-commit model) found via PR diff.
function repoWithBase(specRel, specBody, extraFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-conf2-'));
  const run = (c) => execSync(c, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  run('git init -q'); run('git config user.email t@t.t'); run('git config user.name t');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'x'); run('git add .'); run('git ' + 'commit -qm base');
  run('git branch -M main');
  run('git checkout -qb feature/x');
  const p = path.join(dir, specRel); fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, specBody);
  if (extraFile) {
    const ep = path.join(dir, extraFile); fs.mkdirSync(path.dirname(ep), { recursive: true });
    fs.writeFileSync(ep, 'code');
  }
  run('git add .'); run('git ' + 'commit -qm work');
  return dir;
}

const OPTS = { requireAcChecklist: true, specSource: 'changed', baseBranch: 'main' };

function prEvent(dir, bodyArg) {
  return { hookEvent: 'PreToolUse', toolName: 'Bash', command: `gh pr create --base main --title x ${bodyArg}`, paths: [], prompt: '', cwd: dir, sessionId: null };
}

test('changed source: unticked ACs from the PR-added spec → block', () => {
  const dir = repoWithBase('docs/features/2026-01-01-x.md', '## Acceptance Criteria\n- [ ] partner search works\n- [ ] thread assignment works\n', 'src/x.ts');
  const r = guard.check(prEvent(dir, '--body "nothing"'), ctx(dir, OPTS));
  assert.ok(r && /2 of 2 Acceptance Criteria/.test(r.block), r && r.block);
  assert.match(r.block, /2026-01-01-x\.md/);
});

test('changed source: all ACs ticked in body → pass', () => {
  const dir = repoWithBase('docs/features/2026-01-01-x.md', '## Acceptance Criteria\n- [ ] partner search works\n', 'src/x.ts');
  const bf = path.join(dir, '_b.md');
  fs.writeFileSync(bf, '- [x] partner search works\n');
  assert.strictEqual(guard.check(prEvent(dir, `--body-file ${bf}`), ctx(dir, OPTS)), null);
});

test('changed source: PR changes no spec file → nothing to enforce (pass)', () => {
  const dir = repoWithBase('docs/features/2026-01-01-x.md', 'no criteria here', 'src/x.ts');
  assert.strictEqual(guard.check(prEvent(dir, '--body "x"'), ctx(dir, OPTS)), null);
});

test('changed source: base inferred from --base when baseBranch unset', () => {
  const dir = repoWithBase('docs/features/2026-01-01-x.md', '## Acceptance Criteria\n- [ ] a\n', 'src/x.ts');
  const opts = { requireAcChecklist: true, specSource: 'changed' }; // no baseBranch → use --base main
  const r = guard.check(prEvent(dir, '--body "no"'), ctx(dir, opts));
  assert.ok(r && /1 of 1 Acceptance Criteria/.test(r.block));
});
