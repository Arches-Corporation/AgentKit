'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderBlock, upsertBlock, wireRulebooks, rulebookStatus, START, END } = require('../src/core/lib/rulebook.cjs');

const ASSETS = [
  { kind: 'skill', name: 'deep-review', description: 'Independent review before a PR.' },
  { kind: 'skill', name: 'pr-review', description: 'Run the PR checklist.' },
  { kind: 'agent', name: 'advisor', description: 'Escalate hard trade-offs.' },
];

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-rb-'));
}

test('renderBlock: fenced, lists skills table + agents', () => {
  const b = renderBlock(ASSETS);
  assert.ok(b.startsWith(START) && b.trimEnd().endsWith(END));
  assert.match(b, /\| Skill \| Use when \|/);
  assert.match(b, /`deep-review`/);
  assert.match(b, /Independent review before a PR\./);
  assert.match(b, /Subagents/);
  assert.match(b, /`advisor`/);
});

test('renderBlock: guardrails-only (no skills) still carries the note, no table', () => {
  const b = renderBlock([]);
  assert.match(b, /@arches\/agentkit/);
  assert.doesNotMatch(b, /\| Skill \|/);
});

test('upsertBlock: appends when absent, preserves existing content', () => {
  const out = upsertBlock('# My Repo\n\nExisting rules.\n', renderBlock(ASSETS));
  assert.match(out, /# My Repo/);
  assert.match(out, /Existing rules\./);
  assert.match(out, /agentkit:start/);
});

test('upsertBlock: idempotent — second apply produces no drift', () => {
  const block = renderBlock(ASSETS);
  const once = upsertBlock('# R\n', block);
  const twice = upsertBlock(once, block);
  assert.strictEqual(once, twice);
  assert.strictEqual((twice.match(/agentkit:start/g) || []).length, 1);
});

test('upsertBlock: replaces a stale block, keeps surrounding text', () => {
  const stale = '# R\n\n' + START + '\nOLD\n' + END + '\n\n## Tail kept\n';
  const out = upsertBlock(stale, renderBlock(ASSETS));
  assert.doesNotMatch(out, /OLD/);
  assert.match(out, /## Tail kept/);
  assert.match(out, /`deep-review`/);
  assert.strictEqual((out.match(/agentkit:start/g) || []).length, 1);
});

test('wireRulebooks: injects into existing CLAUDE.md only', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Repo\n\nrules\n');
  const r = wireRulebooks(dir, {}, ASSETS);
  assert.deepStrictEqual(r.written, ['CLAUDE.md']);
  assert.strictEqual(r.seeded, null);
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /agentkit:start/);
});

test('wireRulebooks: seeds CLAUDE.md when no rulebook exists', () => {
  const dir = tmp();
  const r = wireRulebooks(dir, {}, ASSETS);
  assert.strictEqual(r.seeded, 'CLAUDE.md');
  const seeded = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(seeded, /agentkit:start/);
  assert.match(seeded, /`deep-review`/);
});

test('wireRulebooks: multiple existing rulebooks all get the block', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# C\n');
  fs.writeFileSync(path.join(dir, 'GEMINI.md'), '# G\n');
  const r = wireRulebooks(dir, {}, ASSETS);
  assert.ok(r.written.includes('CLAUDE.md') && r.written.includes('GEMINI.md'));
});

test('wireRulebooks: rulebooks:false opts out entirely', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# C\n');
  const r = wireRulebooks(dir, { rulebooks: false }, ASSETS);
  assert.deepStrictEqual(r.written, []);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /agentkit/);
});

test('wireRulebooks: explicit rulebooks list honored', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'RULES.md'), '# custom\n');
  const r = wireRulebooks(dir, { rulebooks: ['RULES.md'] }, ASSETS);
  assert.deepStrictEqual(r.written, ['RULES.md']);
});

test('rulebookStatus: ok after wire, missing before, stale after asset change', () => {
  const dir = tmp();
  assert.strictEqual(rulebookStatus(dir, {}, ASSETS).missing, true);
  wireRulebooks(dir, {}, ASSETS);
  assert.strictEqual(rulebookStatus(dir, {}, ASSETS).ok, true);
  const changed = ASSETS.concat([{ kind: 'skill', name: 'new-one', description: 'x' }]);
  assert.strictEqual(rulebookStatus(dir, {}, changed).ok, false);
});
