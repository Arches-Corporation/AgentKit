'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KIT_ROOT = path.join(__dirname, '..', '..', '..');
const PACKS_DIR = path.join(__dirname, '..', '..', 'projects');
const MANIFEST_REL = '.agentkit/skills.manifest.json';
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

const KINDS = {
  skill: {
    sharedDir: path.join(KIT_ROOT, 'skills'),
    packSubdir: 'skills',
    file: 'SKILL.md',
    defaultTarget: (name) => `.agents/skills/${name}/SKILL.md`,
    configKey: 'skills',
  },
  command: {
    sharedDir: path.join(KIT_ROOT, 'commands'),
    packSubdir: 'commands',
    file: 'COMMAND.md',
    defaultTarget: (name) => `.claude/commands/${name}.md`,
    configKey: 'commands',
  },
  agent: {
    sharedDir: path.join(KIT_ROOT, 'agents'),
    packSubdir: 'agents',
    file: 'AGENT.md',
    defaultTarget: (name) => `.claude/agents/${name}.md`,
    configKey: 'agents',
  },
};

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function assetKey(kind, name) {
  return `${kind}:${name}`;
}

function readAssetDir(dir, name, tier, kind) {
  const spec = KINDS[kind];
  let template;
  try {
    template = fs.readFileSync(path.join(dir, name, spec.file), 'utf8');
  } catch {
    return null;
  }
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, name, 'meta.json'), 'utf8'));
  } catch { /* meta is optional */ }
  return {
    name,
    kind,
    tier,
    template,
    installPath: typeof meta.installPath === 'string' ? meta.installPath : spec.defaultTarget(name),
    varDefaults: (meta.vars && typeof meta.vars === 'object') ? meta.vars : {},
    description: typeof meta.description === 'string' ? meta.description : deriveDescription(template),
  };
}

// One-line "use when" for the rulebook block. Prefer meta.description; else the
// frontmatter `description:`; else the first prose sentence of the body (with
// the frontmatter stripped so we never surface `name:`/`tools:` lines).
function deriveDescription(template) {
  let body = template;
  const fm = template.match(/^---\n([\s\S]*?)\n---\s*([\s\S]*)$/);
  if (fm) {
    const d = fm[1].match(/^description:\s*(.+)$/m);
    if (d) return oneLine(d[1]);
    body = fm[2];
  }
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('---') || t.startsWith('>') || t.startsWith('|')) continue;
    return oneLine(t);
  }
  return '';
}

// Collapse whitespace; prefer the first sentence; cap at a word boundary.
function oneLine(s) {
  const flat = String(s).replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
  const sentence = flat.match(/^(.*?\.)(\s|$)/);
  const pick = sentence && sentence[1].length >= 30 ? sentence[1] : flat;
  if (pick.length <= 160) return pick;
  return pick.slice(0, 157).replace(/\s+\S*$/, '') + '…';
}

function listAssetDirs(dir, kind) {
  const spec = KINDS[kind];
  try {
    return fs.readdirSync(dir).filter((d) => {
      if (!NAME_RE.test(d)) return false;
      try { return fs.statSync(path.join(dir, d, spec.file)).isFile(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

function resolveAssets(config, packNameValue) {
  const assets = [];
  for (const kind of Object.keys(KINDS)) {
    const spec = KINDS[kind];
    if (config && config[spec.configKey] === false) continue;
    const kindCfg = (config && config[spec.configKey]) || {};
    const exclude = new Set(Array.isArray(kindCfg.exclude) ? kindCfg.exclude : []);

    const byName = new Map();
    for (const name of listAssetDirs(spec.sharedDir, kind)) {
      byName.set(name, readAssetDir(spec.sharedDir, name, 'shared', kind));
    }
    if (packNameValue) {
      const packDir = path.join(PACKS_DIR, packNameValue, spec.packSubdir);
      for (const name of listAssetDirs(packDir, kind)) {
        byName.set(name, readAssetDir(packDir, name, `pack:${packNameValue}`, kind));
      }
    }

    for (const [name, asset] of byName) {
      if (exclude.has(name)) continue;
      assets.push(asset);
    }
  }
  return assets.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

function resolveSkills(config, packNameValue) {
  return resolveAssets(config, packNameValue).filter((a) => a.kind === 'skill');
}

function allAssetNames(packNameValue, kind) {
  const spec = KINDS[kind];
  const names = new Set(listAssetDirs(spec.sharedDir, kind));
  if (packNameValue) {
    for (const n of listAssetDirs(path.join(PACKS_DIR, packNameValue, spec.packSubdir), kind)) names.add(n);
  }
  return names;
}

function allSkillNames(packNameValue) {
  return allAssetNames(packNameValue, 'skill');
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

// Substitute {{vars}} in a plain string; leave unknown placeholders as-is.
function renderVars(text, merged) {
  if (!text) return '';
  return String(text).replace(PLACEHOLDER_RE, (whole, v) => (merged[v] === undefined ? whole : String(merged[v])));
}

function render(asset, vars) {
  const merged = Object.assign({}, asset.varDefaults, vars);
  const missing = new Set();
  const content = asset.template.replace(PLACEHOLDER_RE, (whole, varName) => {
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
  for (const asset of resolveAssets(config, packNameValue)) {
    const { content, missing } = render(asset, vars);
    if (missing.length) {
      errors.push(`${asset.kind} "${asset.name}": unresolved template vars: ${missing.join(', ')} — set skills.vars in agentkit.config.json`);
      continue;
    }
    rendered.push({
      name: asset.name,
      kind: asset.kind,
      tier: asset.tier,
      target: asset.installPath,
      description: renderVars(asset.description, Object.assign({}, asset.varDefaults, vars)),
      content,
      hash: sha256(content),
    });
  }
  return { rendered, errors };
}

function readManifest(repoRoot) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_REL), 'utf8'));
    if (!m || !Array.isArray(m.entries)) return { entries: [] };
    for (const e of m.entries) {
      if (e && e.kind === undefined) e.kind = 'skill';
    }
    return m;
  } catch {
    return null;
  }
}

function writeManifest(repoRoot, kitVersion, rendered) {
  const manifest = {
    version: 2,
    kitVersion,
    entries: rendered.map(({ name, kind, tier, target, hash }) => ({ name, kind, tier, target, hash })),
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
  const manifestByKey = new Map(((manifest && manifest.entries) || []).map((e) => [assetKey(e.kind, e.name), e]));

  for (const r of rendered) {
    const prior = manifestByKey.get(assetKey(r.kind, r.name));
    const onDisk = fileHash(repoRoot, r.target);
    if (prior && onDisk !== null && onDisk !== prior.hash) {
      actions.push({ type: 'drift', name: r.name, kind: r.kind, target: r.target });
      continue;
    }
    if (onDisk === null) {
      actions.push({ type: 'create', name: r.name, kind: r.kind, target: r.target });
    } else if (onDisk !== r.hash) {
      actions.push({ type: 'update', name: r.name, kind: r.kind, target: r.target });
    } else {
      actions.push({ type: 'unchanged', name: r.name, kind: r.kind, target: r.target });
    }
    if (prior && prior.target !== r.target) {
      actions.push({ type: 'delete', name: r.name, kind: r.kind, target: prior.target, reason: 'target moved' });
    }
  }

  const renderedKeys = new Set(rendered.map((r) => assetKey(r.kind, r.name)));
  for (const e of (manifest && manifest.entries) || []) {
    if (!renderedKeys.has(assetKey(e.kind, e.name))) {
      actions.push({ type: 'delete', name: e.name, kind: e.kind, target: e.target, reason: 'removed from kit or excluded' });
    }
  }

  return actions;
}

module.exports = {
  MANIFEST_REL,
  KINDS,
  sha256,
  allAssetNames,
  allSkillNames,
  resolveAssets,
  resolveSkills,
  buildVars,
  render,
  renderAll,
  readManifest,
  writeManifest,
  fileHash,
  planSync,
};
