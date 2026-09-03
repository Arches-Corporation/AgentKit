#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../src/core/registry.cjs');
const { CONFIG_FILENAME, findRepoRoot, loadConfig } = require('../src/core/lib/config.cjs');
const { DEFAULT_DIR, loadAll } = require('../src/core/lib/local.cjs');
const { packName, packExists, loadPack, listPacks } = require('../src/core/lib/projects.cjs');
const { validateConfig, checkClaudeWiring } = require('../src/core/lib/validate.cjs');
const { hooksFragment } = require('../src/adapters/claude/settings-fragment.cjs');

function usage() {
  process.stdout.write(
    'agentkit <command>\n\n' +
    'Commands:\n' +
    '  init --tool claude|cursor [--project <pack>]   Wire guardrails + write config skeleton\n' +
    '  doctor               Strict check: node, config keys/types/regexes, pack, wiring drift\n' +
    '  list                 List guardrails: built-in, project pack, local\n' +
    '  hook <name>          Run one guardrail as a Claude hook (stdin JSON)\n'
  );
}

function configSkeleton(project) {
  const guardrails = {};
  for (const g of registry.list()) {
    guardrails[g.name] = Object.assign({ enabled: true }, g.defaults);
  }
  const skeleton = {
    $schema: './node_modules/@arches/agentkit/agentkit.config.schema.json',
    stateDir: '.agentkit/state',
    guardrails,
  };
  if (project) skeleton.project = project;
  return skeleton;
}

const CURSOR_RUNNER = 'node "$WORKSPACE_ROOT/node_modules/@arches/agentkit/src/adapters/cursor/run.cjs"';
const CURSOR_EVENTS = ['beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile', 'beforeSubmitPrompt'];

function wireCursor(root) {
  const hooksPath = path.join(root, '.cursor', 'hooks.json');
  let cfg = { version: 1, hooks: {} };
  try { cfg = JSON.parse(fs.readFileSync(hooksPath, 'utf8')); } catch { /* fresh file */ }
  cfg.hooks = cfg.hooks || {};
  for (const event of CURSOR_EVENTS) {
    const cmd = `${CURSOR_RUNNER} ${event}`;
    cfg.hooks[event] = cfg.hooks[event] || [];
    if (!cfg.hooks[event].some((h) => h && h.command === cmd)) {
      cfg.hooks[event].push({ command: cmd });
    }
  }
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, JSON.stringify(cfg, null, 2) + '\n');
  process.stdout.write(`wired ${CURSOR_EVENTS.length} cursor hook events into .cursor/hooks.json (hooks are beta — Cursor 1.7+)\n`);
}

function cmdInit(args) {
  const tool = args.includes('--tool') ? args[args.indexOf('--tool') + 1] : 'claude';
  if (tool !== 'claude' && tool !== 'cursor') {
    process.stderr.write(`agentkit init: unsupported tool "${tool}" (available: claude, cursor)\n`);
    process.exit(1);
  }

  const root = findRepoRoot(process.cwd());
  const projectArg = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
  if (projectArg && !packExists(projectArg)) {
    process.stderr.write(`agentkit init: no project pack "${projectArg}" in AgentKit (available: ${listPacks().join(', ') || 'none'})\n`);
    process.exit(1);
  }

  const configPath = path.join(root, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(configSkeleton(projectArg), null, 2) + '\n');
    process.stdout.write(`wrote ${CONFIG_FILENAME}${projectArg ? ` (project: ${projectArg})` : ''}\n`);
  } else {
    if (projectArg) {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (existing.project !== projectArg) {
        existing.project = projectArg;
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
        process.stdout.write(`set project: ${projectArg} in ${CONFIG_FILENAME}\n`);
      }
    }
    process.stdout.write(`${CONFIG_FILENAME} exists — left untouched otherwise\n`);
  }

  const localDirPath = path.join(root, DEFAULT_DIR);
  if (!fs.existsSync(localDirPath)) {
    fs.mkdirSync(localDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(localDirPath, 'README.md'),
      'Repo-local guardrails. One file per guardrail, `<name>.cjs`, exporting\n' +
      '{ name, events, matcher, failClosed, defaults, check(event, ctx) } —\n' +
      'same contract as AgentKit built-ins (see docs/local-guardrails.md in the package).\n' +
      'Re-run `npx agentkit init --tool claude` after adding one to wire it.\n'
    );
    process.stdout.write(`scaffolded ${DEFAULT_DIR}/\n`);
  }

  const config = loadConfig(root);
  const builtinNames = new Set(registry.list().map((g) => g.name));

  const pack = loadPack(packName(config));
  for (const e of pack.errors) process.stdout.write(`warn ${e}\n`);
  const packOk = pack.guardrails.filter((g) => {
    if (builtinNames.has(g.name)) {
      process.stdout.write(`warn pack guardrail "${g.name}" shadows a built-in — ignored\n`);
      return false;
    }
    return true;
  });
  const takenNames = new Set([...builtinNames, ...packOk.map((g) => g.name)]);

  const local = loadAll(config, root);
  for (const e of local.errors) process.stdout.write(`warn local guardrail ${e}\n`);
  const localOk = local.guardrails.filter((g) => {
    if (takenNames.has(g.name)) {
      process.stdout.write(`warn local guardrail "${g.name}" shadows a built-in or pack guardrail — ignored\n`);
      return false;
    }
    return true;
  });
  const extras = packOk.concat(localOk);

  if (tool === 'cursor') {
    wireCursor(root);
    process.stdout.write('next: review agentkit.config.json (ticketPattern, codePathPatterns, specDirTemplate)\n');
    return;
  }

  const settingsPath = path.join(root, '.claude', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
  settings.hooks = settings.hooks || {};

  const fragment = hooksFragment(extras);
  for (const [event, entries] of Object.entries(fragment)) {
    settings.hooks[event] = settings.hooks[event] || [];
    const existing = new Set(
      settings.hooks[event].flatMap((e) => (e.hooks || []).map((h) => h.command))
    );
    for (const entry of entries) {
      const missing = entry.hooks.filter((h) => !existing.has(h.command));
      if (missing.length) settings.hooks[event].push(Object.assign({}, entry, { hooks: missing }));
    }
  }

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  const packNote = packOk.length ? ` + ${packOk.length} pack(${packName(config)})` : '';
  const localNote = localOk.length ? ` + ${localOk.length} local` : '';
  process.stdout.write(`wired ${registry.list().length} built-in${packNote}${localNote} guardrails into .claude/settings.json\n`);
  process.stdout.write('next: review agentkit.config.json (ticketPattern, codePathPatterns, specDirTemplate)\n');
}

function cmdDoctor() {
  let ok = true;
  const fail = (msg) => { ok = false; process.stdout.write(`FAIL ${msg}\n`); };
  const warn = (msg) => process.stdout.write(`warn ${msg}\n`);
  const good = (msg) => process.stdout.write(`ok   ${msg}\n`);

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) good(`node ${process.versions.node}`);
  else fail(`node ${process.versions.node} — need >=20 (see .nvmrc, run: nvm use)`);

  const root = findRepoRoot(process.cwd());
  const configPath = path.join(root, CONFIG_FILENAME);
  let cfg = {};
  if (fs.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      good(`${CONFIG_FILENAME} parses`);
    } catch (err) {
      fail(`${CONFIG_FILENAME} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  } else {
    warn(`no ${CONFIG_FILENAME} — defaults apply (run: agentkit init)`);
  }

  const builtins = registry.list();
  const builtinNames = new Set(builtins.map((g) => g.name));

  const project = packName(cfg);
  if (cfg.project !== undefined && !project) {
    fail(`config "project" is not a valid pack name: ${JSON.stringify(cfg.project)}`);
  }
  if (project && !packExists(project)) {
    fail(`project pack "${project}" not found in AgentKit (available: ${listPacks().join(', ') || 'none'})`);
  }
  const pack = loadPack(project);
  for (const e of pack.errors) fail(e);
  const packOk = [];
  for (const g of pack.guardrails) {
    if (builtinNames.has(g.name)) {
      warn(`pack guardrail "${g.name}" shadows a built-in — ignored at runtime`);
    } else {
      packOk.push(g);
      good(`pack guardrail ${g.name} (${project})`);
    }
  }

  const local = loadAll(cfg, root);
  for (const e of local.errors) fail(`local guardrail ${e}`);
  const takenNames = new Set([...builtinNames, ...packOk.map((g) => g.name)]);
  const localOk = [];
  for (const g of local.guardrails) {
    if (takenNames.has(g.name)) {
      warn(`local guardrail "${g.name}" shadows a built-in or pack guardrail — ignored at runtime`);
    } else {
      localOk.push(g);
      good(`local guardrail ${g.name}`);
    }
  }

  const resolved = { builtins, pack: packOk, locals: localOk };
  const validation = validateConfig(cfg, resolved);
  for (const e of validation.errors) fail(`${CONFIG_FILENAME}: ${e}`);
  if (!validation.errors.length && fs.existsSync(configPath)) good(`${CONFIG_FILENAME} valid (keys, option types, regexes)`);

  const settingsPath = path.join(root, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    let settings = null;
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      fail(`.claude/settings.json is not valid JSON: ${err.message}`);
    }
    if (settings) {
      if (JSON.stringify(settings).includes('@arches/agentkit')) {
        const wiring = checkClaudeWiring(settings, cfg, resolved);
        for (const e of wiring.errors) fail(`.claude/settings.json: ${e}`);
        if (!wiring.errors.length) good('.claude/settings.json wiring matches enabled guardrails (events + matchers)');
      } else {
        warn('.claude/settings.json has no agentkit wiring (run: agentkit init --tool claude)');
      }
    }
  } else {
    warn('no .claude/settings.json (run: agentkit init --tool claude)');
  }

  const cursorHooksPath = path.join(root, '.cursor', 'hooks.json');
  if (fs.existsSync(cursorHooksPath)) {
    try {
      const cursorCfg = JSON.parse(fs.readFileSync(cursorHooksPath, 'utf8'));
      const missing = CURSOR_EVENTS.filter((event) => {
        const entries = (cursorCfg.hooks && cursorCfg.hooks[event]) || [];
        return !entries.some((h) => h && typeof h.command === 'string' && h.command.includes('@arches/agentkit/src/adapters/cursor/run.cjs'));
      });
      if (missing.length) fail(`.cursor/hooks.json missing agentkit wiring for: ${missing.join(', ')} (run: agentkit init --tool cursor)`);
      else good('.cursor/hooks.json wires all agentkit events');
    } catch (err) {
      fail(`.cursor/hooks.json is not valid JSON: ${err.message}`);
    }
  }

  process.exit(ok ? 0 : 1);
}

function cmdList() {
  for (const g of registry.list()) {
    process.stdout.write(`${g.name.padEnd(18)} ${g.events.join(',')}${g.matcher ? ` (${g.matcher})` : ''}\n`);
  }
  const root = findRepoRoot(process.cwd());
  const config = loadConfig(root);
  const project = packName(config);
  for (const g of loadPack(project).guardrails) {
    process.stdout.write(`${g.name.padEnd(18)} ${g.events.join(',')}${g.matcher ? ` (${g.matcher})` : ''} (pack:${project})\n`);
  }
  for (const g of loadAll(config, root).guardrails) {
    process.stdout.write(`${g.name.padEnd(18)} ${g.events.join(',')}${g.matcher ? ` (${g.matcher})` : ''} (local)\n`);
  }
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init': return cmdInit(args);
    case 'doctor': return cmdDoctor();
    case 'list': return cmdList();
    case 'hook': {
      process.argv = [process.argv[0], process.argv[1], args[0]];
      return require('../src/adapters/claude/run.cjs');
    }
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
}

main();
