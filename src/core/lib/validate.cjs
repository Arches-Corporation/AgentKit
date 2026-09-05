'use strict';

const TOP_LEVEL_KEYS = new Set(['$schema', 'stateDir', 'project', 'localGuardrailsDir', 'guardrails', 'skills', 'commands', 'agents']);

function validateAssetSection(sectionName, sectionCfg, allowedKeys, kindLabel, knownNames, errors) {
  if (!sectionCfg || typeof sectionCfg !== 'object' || Array.isArray(sectionCfg)) {
    errors.push(`${sectionName}: must be an object`);
    return;
  }
  for (const key of Object.keys(sectionCfg)) {
    if (!allowedKeys.includes(key)) errors.push(`${sectionName}.${key}: unknown key (known: ${allowedKeys.join(', ')})`);
  }
  if (allowedKeys.includes('vars') && sectionCfg.vars !== undefined) {
    if (!sectionCfg.vars || typeof sectionCfg.vars !== 'object' || Array.isArray(sectionCfg.vars)) {
      errors.push(`${sectionName}.vars: must be an object of string values`);
    } else {
      for (const [k, v] of Object.entries(sectionCfg.vars)) {
        if (typeof v !== 'string') errors.push(`${sectionName}.vars.${k}: must be a string`);
      }
    }
  }
  if (sectionCfg.exclude !== undefined) {
    if (!Array.isArray(sectionCfg.exclude)) {
      errors.push(`${sectionName}.exclude: must be an array of ${kindLabel} names`);
    } else if (knownNames) {
      for (const name of sectionCfg.exclude) {
        if (typeof name !== 'string') errors.push(`${sectionName}.exclude: entries must be strings`);
        else if (!knownNames.has(name)) errors.push(`${sectionName}.exclude: no such ${kindLabel} "${name}"`);
      }
    }
  }
}

const TYPES = {
  string(value) {
    return typeof value === 'string' ? null : 'must be a string';
  },
  boolean(value) {
    return typeof value === 'boolean' ? null : 'must be a boolean';
  },
  regex(value) {
    if (typeof value !== 'string') return 'must be a regex string';
    try { new RegExp(value); return null; } catch (err) { return `invalid regex: ${err.message}`; }
  },
  stringArray(value) {
    if (!Array.isArray(value)) return 'must be an array of strings';
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') return `[${i}] must be a string`;
    }
    return null;
  },
  regexArray(value) {
    if (!Array.isArray(value)) return 'must be an array of regex strings';
    for (let i = 0; i < value.length; i++) {
      const err = TYPES.regex(value[i]);
      if (err) return `[${i}] ${err}`;
    }
    return null;
  },
  patternObjArray(value) {
    if (!Array.isArray(value)) return 'must be an array of {pattern, flags?, label?} objects';
    for (let i = 0; i < value.length; i++) {
      const entry = value[i];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `[${i}] must be an object`;
      for (const key of Object.keys(entry)) {
        if (!['pattern', 'flags', 'label'].includes(key)) return `[${i}] unknown key "${key}"`;
      }
      if (typeof entry.pattern !== 'string') return `[${i}].pattern must be a regex string`;
      try { new RegExp(entry.pattern, entry.flags || ''); } catch (err) { return `[${i}] invalid regex: ${err.message}`; }
      if (entry.flags !== undefined && typeof entry.flags !== 'string') return `[${i}].flags must be a string`;
      if (entry.label !== undefined && typeof entry.label !== 'string') return `[${i}].label must be a string`;
    }
    return null;
  },
  stringOrStringArray(value) {
    if (typeof value === 'string') return null;
    return TYPES.stringArray(value) === null ? null : 'must be a string or an array of strings';
  },
};

const BUILT_IN_OPTION_SPECS = {
  'hard-stop': { approvalMarker: 'string' },
  'spec-first': {
    approvalMarker: 'string',
    ticketPattern: 'regex',
    codePathPatterns: 'regexArray',
    specDirTemplate: 'string',
    requireSpecDir: 'boolean',
    hintText: 'string',
  },
  'privacy-block': { sensitive: 'regexArray', safe: 'regexArray' },
  'secret-output': { extraPatterns: 'patternObjArray' },
  'scout-block': { ignoreFile: 'string', fallbackDirs: 'stringArray' },
  'force-push-guard': { allowForceWithLease: 'boolean', approvalMarker: 'string' },
  'db-guard': { extraPatterns: 'patternObjArray', approvalMarker: 'string' },
  'rules-reminder': { text: 'stringOrStringArray', oncePerSession: 'boolean' },
};

function typeNameOf(defaultValue) {
  if (typeof defaultValue === 'string') return 'string';
  if (typeof defaultValue === 'boolean') return 'boolean';
  if (Array.isArray(defaultValue)) return 'array';
  return null;
}

function validateLooseOption(guardrailName, key, value, defaults, errors) {
  const known = Object.keys(defaults || {});
  if (!known.includes(key)) {
    errors.push(`guardrails.${guardrailName}.${key}: unknown option (known: enabled${known.length ? ', ' + known.join(', ') : ''})`);
    return;
  }
  const expected = typeNameOf(defaults[key]);
  if (expected === 'string' && typeof value !== 'string') {
    errors.push(`guardrails.${guardrailName}.${key}: must be a string`);
  } else if (expected === 'boolean' && typeof value !== 'boolean') {
    errors.push(`guardrails.${guardrailName}.${key}: must be a boolean`);
  } else if (expected === 'array' && !Array.isArray(value)) {
    errors.push(`guardrails.${guardrailName}.${key}: must be an array`);
  }
}

function validateConfig(config, resolved) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { errors: ['config must be a JSON object'] };
  }

  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown top-level key "${key}"`);
  }
  if (config.stateDir !== undefined && typeof config.stateDir !== 'string') {
    errors.push('stateDir: must be a string');
  }
  if (config.localGuardrailsDir !== undefined && typeof config.localGuardrailsDir !== 'string') {
    errors.push('localGuardrailsDir: must be a string');
  }
  if (config.project !== undefined && typeof config.project !== 'string') {
    errors.push('project: must be a string');
  }

  if (config.skills !== undefined) {
    validateAssetSection('skills', config.skills, ['vars', 'exclude'], 'skill', resolved.skillNames || null, errors);
  }
  if (config.commands !== undefined) {
    validateAssetSection('commands', config.commands, ['exclude'], 'command', resolved.commandNames || null, errors);
  }
  if (config.agents !== undefined) {
    validateAssetSection('agents', config.agents, ['exclude'], 'agent', resolved.agentNames || null, errors);
  }

  const guardrailsCfg = config.guardrails;
  if (guardrailsCfg === undefined) return { errors };
  if (!guardrailsCfg || typeof guardrailsCfg !== 'object' || Array.isArray(guardrailsCfg)) {
    errors.push('guardrails: must be an object');
    return { errors };
  }

  const byName = new Map();
  for (const g of resolved.builtins) byName.set(g.name, { tier: 'builtin', module: g });
  for (const g of resolved.pack) if (!byName.has(g.name)) byName.set(g.name, { tier: 'pack', module: g });
  for (const g of resolved.locals) if (!byName.has(g.name)) byName.set(g.name, { tier: 'local', module: g });

  for (const [name, entry] of Object.entries(guardrailsCfg)) {
    const known = byName.get(name);
    if (!known) {
      errors.push(`guardrails.${name}: no such guardrail (not a built-in, not in the active pack, not local)`);
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`guardrails.${name}: must be an object`);
      continue;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'enabled') {
        if (typeof value !== 'boolean') errors.push(`guardrails.${name}.enabled: must be a boolean`);
        continue;
      }
      const spec = BUILT_IN_OPTION_SPECS[name];
      if (known.tier === 'builtin' && spec) {
        if (!(key in spec)) {
          errors.push(`guardrails.${name}.${key}: unknown option (known: enabled, ${Object.keys(spec).join(', ')})`);
          continue;
        }
        const typeError = TYPES[spec[key]](value);
        if (typeError) errors.push(`guardrails.${name}.${key}: ${typeError}`);
      } else {
        validateLooseOption(name, key, value, known.module.defaults, errors);
      }
    }
  }

  return { errors };
}

function extractWiredNames(settings, runnerPathFragment) {
  const wired = [];
  const hooks = settings && settings.hooks;
  if (!hooks || typeof hooks !== 'object') return wired;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const matcher = entry && typeof entry.matcher === 'string' ? entry.matcher : null;
      const cmds = (entry && Array.isArray(entry.hooks)) ? entry.hooks : [];
      for (const h of cmds) {
        const cmd = h && typeof h.command === 'string' ? h.command : '';
        if (!cmd.includes(runnerPathFragment)) continue;
        const m = cmd.match(/run\.cjs"\s+([a-z0-9-]+)\s*$/);
        if (m) wired.push({ name: m[1], event, matcher });
      }
    }
  }
  return wired;
}

function checkClaudeWiring(settings, config, resolved) {
  const errors = [];
  const wired = extractWiredNames(settings, '@arches-corporation/agentkit/src/adapters/claude/run.cjs');

  const byName = new Map();
  for (const g of resolved.builtins) byName.set(g.name, g);
  for (const g of resolved.pack) if (!byName.has(g.name)) byName.set(g.name, g);
  for (const g of resolved.locals) if (!byName.has(g.name)) byName.set(g.name, g);

  const guardrailsCfg = (config && config.guardrails) || {};
  const isEnabled = (name) => {
    const entry = guardrailsCfg[name];
    return !entry || entry.enabled !== false;
  };

  const wiredNames = new Set(wired.map((w) => w.name));
  for (const [name, g] of byName) {
    if (!isEnabled(name)) continue;
    if (!wiredNames.has(name)) {
      errors.push(`"${name}" is enabled but not wired in .claude/settings.json — run: agentkit init --tool claude`);
      continue;
    }
    for (const w of wired.filter((x) => x.name === name)) {
      if (!g.events.includes(w.event)) {
        errors.push(`"${name}" wired under event ${w.event} but declares ${g.events.join(',')}`);
      }
      const expectedMatcher = g.matcher || null;
      if (w.matcher !== expectedMatcher) {
        errors.push(`"${name}" wired with matcher ${JSON.stringify(w.matcher)} but declares ${JSON.stringify(expectedMatcher)}`);
      }
    }
  }

  for (const name of wiredNames) {
    if (!byName.has(name)) {
      errors.push(`settings.json wires unknown guardrail "${name}" — stale entry, run: agentkit init --tool claude`);
    }
  }

  return { errors };
}

module.exports = { validateConfig, checkClaudeWiring, extractWiredNames, BUILT_IN_OPTION_SPECS };
