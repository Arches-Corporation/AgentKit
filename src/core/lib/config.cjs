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

function stateDir(config, repoRoot) {
  const rel = (config && config.stateDir) || '.agentkit/state';
  return path.resolve(repoRoot, rel);
}

module.exports = { CONFIG_FILENAME, findRepoRoot, loadConfig, isEnabled, optionsFor, stateDir };
