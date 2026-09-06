'use strict';

const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', '..', 'projects');
const FILE_RE = /^[a-z0-9][a-z0-9-]*\.cjs$/;

// Convention: a pack is named EXACTLY like its GitHub repo (src/projects/EKB
// for Arches-Corporation/EKB). Pre-2.3 short names stay as aliases so existing
// configs keep working; doctor nudges to rename.
const LEGACY_PACK_ALIASES = {
  ekb: 'EKB',
  rm: 'Referral-Management',
};

function isValid(mod) {
  return mod && typeof mod.name === 'string' && typeof mod.check === 'function' && Array.isArray(mod.events);
}

function packName(config) {
  const name = config && config.project;
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) return null;
  return LEGACY_PACK_ALIASES[name] || name;
}

function packAliasUsed(config) {
  const name = config && config.project;
  return typeof name === 'string' && LEGACY_PACK_ALIASES[name] ? { alias: name, canonical: LEGACY_PACK_ALIASES[name] } : null;
}

function packExists(name) {
  try { return fs.statSync(path.join(PACKS_DIR, name)).isDirectory(); } catch { return false; }
}

function loadPack(name) {
  if (!name) return { guardrails: [], errors: [] };
  const dir = path.join(PACKS_DIR, name);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f));
  } catch {
    return { guardrails: [], errors: [`project pack "${name}" not found in AgentKit`] };
  }
  const guardrails = [];
  const errors = [];
  for (const f of files) {
    try {
      const mod = require(path.join(dir, f));
      if (isValid(mod)) guardrails.push(mod);
      else errors.push(`${name}/${f}: missing name/events/check export`);
    } catch (err) {
      errors.push(`${name}/${f}: ${(err && err.message) || err}`);
    }
  }
  return { guardrails, errors };
}

function getFromPack(name, guardrailName) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(guardrailName)) return null;
  try {
    const mod = require(path.join(PACKS_DIR, name, `${guardrailName}.cjs`));
    return isValid(mod) && mod.name === guardrailName ? mod : null;
  } catch {
    return null;
  }
}

function listPacks() {
  try {
    return fs.readdirSync(PACKS_DIR).filter((d) => {
      try { return fs.statSync(path.join(PACKS_DIR, d)).isDirectory(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

module.exports = { packName, packAliasUsed, packExists, loadPack, getFromPack, listPacks, LEGACY_PACK_ALIASES };
