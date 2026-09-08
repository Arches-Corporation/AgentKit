'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIR = '.agentkit/guardrails';
const FILE_RE = /^[a-z0-9][a-z0-9-]*\.cjs$/;

function localDir(config, repoRoot) {
  const rel = (config && config.localGuardrailsDir) || DEFAULT_DIR;
  const rootAbs = path.resolve(repoRoot);
  const resolved = path.resolve(rootAbs, rel);
  // A config-supplied dir outside the repo would let a crafted config load
  // (and execute) arbitrary files — contain it.
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) {
    return path.resolve(rootAbs, DEFAULT_DIR);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Trust store — repo-local guardrails are require()d, i.e. EXECUTED. Cloning
// an untrusted repo and running `agentkit doctor` must not run its code.
// Hashes live OUTSIDE the repo (attacker-writable) keyed by repo path; a file
// is only require()d when its current content hash was explicitly trusted via
// `agentkit trust`.
// ---------------------------------------------------------------------------

function trustDir() {
  return process.env.AGENTKIT_TRUST_DIR || path.join(os.homedir(), '.agentkit', 'trust');
}

function canonicalRoot(repoRoot) {
  // realpath so /var vs /private/var (macOS) or other symlinked checkouts key
  // the same store entry regardless of how the path was spelled.
  try {
    return fs.realpathSync(path.resolve(repoRoot));
  } catch {
    return path.resolve(repoRoot);
  }
}

function trustStorePath(repoRoot) {
  const key = crypto.createHash('sha256').update(canonicalRoot(repoRoot)).digest('hex');
  return path.join(trustDir(), `${key}.json`);
}

function readTrust(repoRoot) {
  try {
    const t = JSON.parse(fs.readFileSync(trustStorePath(repoRoot), 'utf8'));
    return t && typeof t.files === 'object' && t.files ? t : { files: {} };
  } catch {
    return { files: {} };
  }
}

function writeTrust(repoRoot, files) {
  const p = trustStorePath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ repoRoot: canonicalRoot(repoRoot), files }, null, 2) + '\n');
  return p;
}

function contentHash(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function isTrusted(repoRoot, fileName, filePath, trust) {
  const t = trust || readTrust(repoRoot);
  const hash = contentHash(filePath);
  return hash !== null && t.files[fileName] === hash;
}

// Record every current local guardrail as trusted. Returns the file names.
function trustAll(config, repoRoot) {
  const dir = localDir(config, repoRoot);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f));
  } catch { /* no local dir */ }
  const hashes = {};
  for (const f of files) {
    const h = contentHash(path.join(dir, f));
    if (h) hashes[f] = h;
  }
  const storePath = writeTrust(repoRoot, hashes);
  return { files: Object.keys(hashes), storePath };
}

function isValid(mod) {
  return mod && typeof mod.name === 'string' && typeof mod.check === 'function' && Array.isArray(mod.events);
}

function loadAll(config, repoRoot) {
  const dir = localDir(config, repoRoot);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f));
  } catch {
    return { guardrails: [], errors: [], untrusted: [] };
  }
  const guardrails = [];
  const errors = [];
  const untrusted = [];
  const trust = readTrust(repoRoot);
  for (const f of files) {
    const p = path.join(dir, f);
    if (!isTrusted(repoRoot, f, p, trust)) {
      untrusted.push(f);
      continue;
    }
    try {
      const mod = require(p);
      if (isValid(mod)) guardrails.push(mod);
      else errors.push(`${f}: missing name/events/check export`);
    } catch (err) {
      errors.push(`${f}: ${(err && err.message) || err}`);
    }
  }
  return { guardrails, errors, untrusted };
}

function loadByName(config, repoRoot, name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  const f = `${name}.cjs`;
  const p = path.join(localDir(config, repoRoot), f);
  if (!isTrusted(repoRoot, f, p)) return null;
  try {
    const mod = require(p);
    return isValid(mod) && mod.name === name ? mod : null;
  } catch {
    return null;
  }
}

module.exports = { DEFAULT_DIR, localDir, loadAll, loadByName, trustAll, readTrust, trustStorePath };
