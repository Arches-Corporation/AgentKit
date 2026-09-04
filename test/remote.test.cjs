'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseLatestTag, compareVersions, normalizeRepoUrl, checkRemote } = require('../src/core/lib/remote.cjs');

test('parseLatestTag: picks semver max, ignores non-semver refs', () => {
  const out = [
    'aaa\trefs/tags/v1.2.0',
    'bbb\trefs/tags/v1.10.0',
    'ccc\trefs/tags/v1.9.9',
    'ddd\trefs/tags/v1.10.0^{}',
    'eee\trefs/tags/some-tag',
    'fff\trefs/heads/main',
  ].join('\n');
  assert.strictEqual(parseLatestTag(out), '1.10.0');
});

test('parseLatestTag: no tags -> null', () => {
  assert.strictEqual(parseLatestTag('abc\trefs/heads/main'), null);
});

test('compareVersions ordering', () => {
  assert.ok(compareVersions('1.4.1', '1.5.0') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.strictEqual(compareVersions('2.0.0', '2.0.0'), 0);
});

test('normalizeRepoUrl strips git+ prefix', () => {
  assert.strictEqual(
    normalizeRepoUrl('git+https://github.com/Arches-Corporation/AgentKit.git'),
    'https://github.com/Arches-Corporation/AgentKit.git'
  );
});

test('checkRemote: behind / current / error via injected exec', () => {
  const tags = 'x\trefs/tags/v9.9.9';
  assert.deepStrictEqual(
    checkRemote('u', '1.0.0', () => tags),
    { status: 'behind', latest: '9.9.9', installed: '1.0.0' }
  );
  assert.deepStrictEqual(
    checkRemote('u', '9.9.9', () => tags),
    { status: 'current', latest: '9.9.9', installed: '9.9.9' }
  );
  assert.strictEqual(checkRemote('u', '1.0.0', () => { throw new Error('auth'); }).status, 'error');
  assert.strictEqual(checkRemote('u', '1.0.0', () => 'no tags here').status, 'error');
});

test('checkRemote: real git against local bare fixture (no network)', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-remote-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-remote-w-'));
  execFileSync('git', ['init', '--bare', '-q', bare]);
  execFileSync('git', ['init', '-q'], { cwd: work });
  execFileSync('git', ['-C', work, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(work, 'f'), 'x');
  execFileSync('git', ['-C', work, 'add', '.']);
  execFileSync('git', ['-C', work, 'commit', '-qm', 'c']);
  execFileSync('git', ['-C', work, 'tag', 'v2.3.4']);
  execFileSync('git', ['-C', work, 'push', '-q', bare, 'HEAD', '--tags']);
  const r = checkRemote(`file://${bare}`, '2.0.0');
  assert.deepStrictEqual(r, { status: 'behind', latest: '2.3.4', installed: '2.0.0' });
});
