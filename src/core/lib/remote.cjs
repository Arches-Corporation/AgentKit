'use strict';

const { execFileSync } = require('child_process');

const TAG_RE = /refs\/tags\/v(\d+)\.(\d+)\.(\d+)$/;

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

function parseLatestTag(lsRemoteOutput) {
  let best = null;
  for (const line of String(lsRemoteOutput).split('\n')) {
    const m = line.trim().match(TAG_RE);
    if (!m) continue;
    const v = `${m[1]}.${m[2]}.${m[3]}`;
    if (!best || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

function normalizeRepoUrl(url) {
  return String(url || '').replace(/^git\+/, '');
}

function checkRemote(repoUrl, installedVersion, exec) {
  const run = exec || ((url) => execFileSync('git', ['ls-remote', '--tags', url], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
  let output;
  try {
    output = run(normalizeRepoUrl(repoUrl));
  } catch (err) {
    return { status: 'error', message: String((err && err.message) || err) };
  }
  const latest = parseLatestTag(output);
  if (!latest) return { status: 'error', message: 'no vX.Y.Z tags found on remote' };
  const cmp = compareVersions(installedVersion, latest);
  return {
    status: cmp < 0 ? 'behind' : 'current',
    latest,
    installed: installedVersion,
  };
}

module.exports = { parseLatestTag, compareVersions, normalizeRepoUrl, checkRemote };
