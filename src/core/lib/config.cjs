'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'agentkit.config.json';

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, CONFIG_FILENAME))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir || process.cwd());
    dir = parent;
  }
}

function loadConfig(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, CONFIG_FILENAME), 'utf8'));
  } catch {
    return {};
  }
}

function isEnabled(config, name) {
  const entry = config && config.guardrails && config.guardrails[name];
  if (!entry || typeof entry !== 'object') return true;
  return entry.enabled !== false;
}

function optionsFor(config, name) {
  const entry = config && config.guardrails && config.guardrails[name];
  return entry && typeof entry === 'object' ? entry : {};
}

// Containment: a config- or manifest-supplied relative path must resolve to a
// location INSIDE the repo. Absolute paths and ../ escapes are rejected —
// otherwise a crafted manifest/config could write or delete files outside the
// repo (path traversal).
function insideRepo(repoRoot, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return false;
  const rootAbs = path.resolve(repoRoot);
  const resolved = path.resolve(rootAbs, rel);
  return resolved === rootAbs || resolved.startsWith(rootAbs + path.sep);
}

function containedPath(repoRoot, rel) {
  return insideRepo(repoRoot, rel) ? path.resolve(repoRoot, rel) : null;
}

function stateDir(config, repoRoot) {
  const rel = (config && config.stateDir) || '.agentkit/state';
  const p = containedPath(repoRoot, rel);
  if (p) return p;
  process.stderr.write(`agentkit: stateDir "${rel}" escapes the repo — using default .agentkit/state\n`);
  return path.resolve(repoRoot, '.agentkit/state');
}

module.exports = { CONFIG_FILENAME, findRepoRoot, loadConfig, isEnabled, optionsFor, stateDir, insideRepo, containedPath };
