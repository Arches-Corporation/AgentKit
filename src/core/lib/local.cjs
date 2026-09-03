'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = '.agentkit/guardrails';
const FILE_RE = /^[a-z0-9][a-z0-9-]*\.cjs$/;

function localDir(config, repoRoot) {
  const rel = (config && config.localGuardrailsDir) || DEFAULT_DIR;
  return path.resolve(repoRoot, rel);
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
    return { guardrails: [], errors: [] };
  }
  const guardrails = [];
  const errors = [];
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      const mod = require(p);
      if (isValid(mod)) guardrails.push(mod);
      else errors.push(`${f}: missing name/events/check export`);
    } catch (err) {
      errors.push(`${f}: ${(err && err.message) || err}`);
    }
  }
  return { guardrails, errors };
}

function loadByName(config, repoRoot, name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  const p = path.join(localDir(config, repoRoot), `${name}.cjs`);
  try {
    const mod = require(p);
    return isValid(mod) && mod.name === name ? mod : null;
  } catch {
    return null;
  }
}

module.exports = { DEFAULT_DIR, localDir, loadAll, loadByName };
