#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('../src/core/registry.cjs');
const { CONFIG_FILENAME, findRepoRoot, loadConfig } = require('../src/core/lib/config.cjs');
const { DEFAULT_DIR, loadAll } = require('../src/core/lib/local.cjs');
const { hooksFragment } = require('../src/adapters/claude/settings-fragment.cjs');

function usage() {
  process.stdout.write(
    'agentkit <command>\n\n' +
    'Commands:\n' +
    '  init --tool claude   Wire guardrails into .claude/settings.json + write config skeleton\n' +
    '  doctor               Verify node version, config, and settings wiring\n' +
    '  list                 List available guardrails\n' +
    '  hook <name>          Run one guardrail as a Claude hook (stdin JSON)\n'
  );
}

function configSkeleton() {
  const guardrails = {};
  for (const g of registry.list()) {
    guardrails[g.name] = Object.assign({ enabled: true }, g.defaults);
  }
  return { stateDir: '.agentkit/state', guardrails };
}

function cmdInit(args) {
  const tool = args.includes('--tool') ? args[args.indexOf('--tool') + 1] : 'claude';
  if (tool !== 'claude') {
    process.stderr.write(`agentkit init: unsupported tool "${tool}" (available: claude)\n`);
    process.exit(1);
  }

  const root = findRepoRoot(process.cwd());

  const configPath = path.join(root, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(configSkeleton(), null, 2) + '\n');
    process.stdout.write(`wrote ${CONFIG_FILENAME}\n`);
  } else {
    process.stdout.write(`${CONFIG_FILENAME} exists — left untouched\n`);
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
  const local = loadAll(config, root);
  for (const e of local.errors) process.stdout.write(`warn local guardrail ${e}\n`);
  const builtinNames = new Set(registry.list().map((g) => g.name));
  const localOk = local.guardrails.filter((g) => {
    if (builtinNames.has(g.name)) {
      process.stdout.write(`warn local guardrail "${g.name}" shadows a built-in — ignored\n`);
      return false;
    }
    return true;
  });

  const settingsPath = path.join(root, '.claude', 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
  settings.hooks = settings.hooks || {};

  const fragment = hooksFragment(localOk);
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
  const localNote = localOk.length ? ` + ${localOk.length} local` : '';
  process.stdout.write(`wired ${registry.list().length} built-in${localNote} guardrails into .claude/settings.json\n`);
  process.stdout.write('next: review agentkit.config.json (ticketPattern, codePathPatterns, specDirTemplate)\n');
}

function cmdDoctor() {
  let ok = true;
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) {
    process.stdout.write(`ok   node ${process.versions.node}\n`);
  } else {
    ok = false;
    process.stdout.write(`FAIL node ${process.versions.node} — need >=20 (see .nvmrc, run: nvm use)\n`);
  }

  const root = findRepoRoot(process.cwd());
  const configPath = path.join(root, CONFIG_FILENAME);
  if (fs.existsSync(configPath)) {
    try {
      loadConfig(root);
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const known = new Set(registry.list().map((g) => g.name));
      const unknown = Object.keys(parsed.guardrails || {}).filter((k) => !known.has(k));
      if (unknown.length) {
        process.stdout.write(`warn ${CONFIG_FILENAME}: unknown guardrail(s): ${unknown.join(', ')}\n`);
      }
      process.stdout.write(`ok   ${CONFIG_FILENAME} parses\n`);
    } catch {
      ok = false;
      process.stdout.write(`FAIL ${CONFIG_FILENAME} is not valid JSON\n`);
    }
  } else {
    process.stdout.write(`warn no ${CONFIG_FILENAME} — defaults apply (run: agentkit init)\n`);
  }

  const settingsPath = path.join(root, '.claude', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (raw.includes('@arches/agentkit')) {
      process.stdout.write('ok   .claude/settings.json wires agentkit\n');
    } else {
      process.stdout.write('warn .claude/settings.json has no agentkit wiring (run: agentkit init --tool claude)\n');
    }
  } catch {
    process.stdout.write('warn no .claude/settings.json (run: agentkit init --tool claude)\n');
  }

  const local = loadAll(loadConfig(root), root);
  for (const e of local.errors) {
    ok = false;
    process.stdout.write(`FAIL local guardrail ${e}\n`);
  }
  const builtinNames = new Set(registry.list().map((g) => g.name));
  for (const g of local.guardrails) {
    if (builtinNames.has(g.name)) {
      process.stdout.write(`warn local guardrail "${g.name}" shadows a built-in — ignored at runtime\n`);
    } else {
      process.stdout.write(`ok   local guardrail ${g.name}\n`);
    }
  }

  process.exit(ok ? 0 : 1);
}

function cmdList() {
  for (const g of registry.list()) {
    process.stdout.write(`${g.name.padEnd(16)} ${g.events.join(',')}${g.matcher ? ` (${g.matcher})` : ''}\n`);
  }
  const root = findRepoRoot(process.cwd());
  const local = loadAll(loadConfig(root), root);
  for (const g of local.guardrails) {
    process.stdout.write(`${g.name.padEnd(16)} ${g.events.join(',')}${g.matcher ? ` (${g.matcher})` : ''} (local)\n`);
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
