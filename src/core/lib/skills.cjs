'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHARED_DIR = path.join(__dirname, '..', '..', '..', 'skills');
const PACKS_DIR = path.join(__dirname, '..', '..', 'projects');
const MANIFEST_REL = '.agentkit/skills.manifest.json';
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readSkillDir(dir, name, tier) {
  const skillPath = path.join(dir, name, 'SKILL.md');
  let template;
  try {
    template = fs.readFileSync(skillPath, 'utf8');
  } catch {
    return null;
  }
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, name, 'meta.json'), 'utf8'));
  } catch { /* meta is optional */ }
  return {
    name,
    tier,
    template,
    installPath: typeof meta.installPath === 'string' ? meta.installPath : `.agents/skills/${name}/SKILL.md`,
    varDefaults: (meta.vars && typeof meta.vars === 'object') ? meta.vars : {},
  };
}

function listSkillDirs(dir) {
  try {
    return fs.readdirSync(dir).filter((d) => {
      if (!NAME_RE.test(d)) return false;
      try { return fs.statSync(path.join(dir, d, 'SKILL.md')).isFile(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

function resolveSkills(config, packNameValue) {
  const skillsCfg = (config && config.skills) || {};
  const exclude = new Set(Array.isArray(skillsCfg.exclude) ? skillsCfg.exclude : []);

  const byName = new Map();
  for (const name of listSkillDirs(SHARED_DIR)) {
    byName.set(name, readSkillDir(SHARED_DIR, name, 'shared'));
  }
  if (packNameValue) {
    const packSkillsDir = path.join(PACKS_DIR, packNameValue, 'skills');
    for (const name of listSkillDirs(packSkillsDir)) {
      byName.set(name, readSkillDir(packSkillsDir, name, `pack:${packNameValue}`));
    }
  }

  const skills = [];
  for (const [name, skill] of byName) {
    if (exclude.has(name)) continue;
    skills.push(skill);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function allSkillNames(packNameValue) {
  const names = new Set(listSkillDirs(SHARED_DIR));
  if (packNameValue) {
    for (const n of listSkillDirs(path.join(PACKS_DIR, packNameValue, 'skills'))) names.add(n);
  }
  return names;
}

function buildVars(config) {
  const skillsCfg = (config && config.skills) || {};
  const vars = Object.assign({}, (skillsCfg.vars && typeof skillsCfg.vars === 'object') ? skillsCfg.vars : {});
  const specFirst = (config && config.guardrails && config.guardrails['spec-first']) || {};
  if (vars.ticketPattern === undefined && typeof specFirst.ticketPattern === 'string') {
    vars.ticketPattern = specFirst.ticketPattern;
  }
  if (vars.specDirTemplate === undefined && typeof specFirst.specDirTemplate === 'string') {
    vars.specDirTemplate = specFirst.specDirTemplate;
  }
  if (vars.specDirDisplay === undefined && typeof vars.specDirTemplate === 'string') {
    vars.specDirDisplay = vars.specDirTemplate.replace('{ticket}', '<TICKET-ID>').replace(/\/+$/, '');
  }
  return vars;
}

function render(skill, vars) {
  const merged = Object.assign({}, skill.varDefaults, vars);
  const missing = new Set();
  const content = skill.template.replace(PLACEHOLDER_RE, (whole, varName) => {
    if (merged[varName] === undefined) {
      missing.add(varName);
      return whole;
    }
    return String(merged[varName]);
  });
  return { content, missing: [...missing] };
}

function renderAll(config, packNameValue) {
  const vars = buildVars(config);
  const rendered = [];
  const errors = [];
  for (const skill of resolveSkills(config, packNameValue)) {
    const { content, missing } = render(skill, vars);
    if (missing.length) {
      errors.push(`skill "${skill.name}": unresolved template vars: ${missing.join(', ')} — set skills.vars in agentkit.config.json`);
      continue;
    }
    rendered.push({
      name: skill.name,
      tier: skill.tier,
      target: skill.installPath,
      content,
      hash: sha256(content),
    });
  }
  return { rendered, errors };
}

function readManifest(repoRoot) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_REL), 'utf8'));
    return (m && Array.isArray(m.entries)) ? m : { entries: [] };
  } catch {
    return null;
  }
}

function writeManifest(repoRoot, kitVersion, rendered) {
  const manifest = {
    version: 1,
    kitVersion,
    entries: rendered.map(({ name, tier, target, hash }) => ({ name, tier, target, hash })),
  };
  const p = path.join(repoRoot, MANIFEST_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function fileHash(repoRoot, target) {
  try {
    return sha256(fs.readFileSync(path.join(repoRoot, target), 'utf8'));
  } catch {
    return null;
  }
}

function planSync(repoRoot, rendered, manifest) {
  const actions = [];
  const manifestByName = new Map(((manifest && manifest.entries) || []).map((e) => [e.name, e]));

  for (const r of rendered) {
    const prior = manifestByName.get(r.name);
    const onDisk = fileHash(repoRoot, r.target);
    if (prior && onDisk !== null && onDisk !== prior.hash) {
      actions.push({ type: 'drift', name: r.name, target: r.target });
      continue;
    }
    if (onDisk === null) {
      actions.push({ type: 'create', name: r.name, target: r.target });
    } else if (onDisk !== r.hash) {
      actions.push({ type: 'update', name: r.name, target: r.target });
    } else {
      actions.push({ type: 'unchanged', name: r.name, target: r.target });
    }
    if (prior && prior.target !== r.target) {
      actions.push({ type: 'delete', name: r.name, target: prior.target, reason: 'target moved' });
    }
  }

  const renderedNames = new Set(rendered.map((r) => r.name));
  for (const e of (manifest && manifest.entries) || []) {
    if (!renderedNames.has(e.name)) {
      actions.push({ type: 'delete', name: e.name, target: e.target, reason: 'removed from kit or excluded' });
    }
  }

  return actions;
}

module.exports = {
  MANIFEST_REL,
  sha256,
  allSkillNames,
  resolveSkills,
  buildVars,
  render,
  renderAll,
  readManifest,
  writeManifest,
  fileHash,
  planSync,
};
