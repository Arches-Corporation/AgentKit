#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const registry = require('../src/core/registry.cjs');
const { CONFIG_FILENAME, findRepoRoot, loadConfig, isEnabled, optionsFor, stateDir } = require('../src/core/lib/config.cjs');
const { DEFAULT_DIR, loadAll } = require('../src/core/lib/local.cjs');
const { packName, packAliasUsed, packExists, loadPack, listPacks, LEGACY_PACK_ALIASES } = require('../src/core/lib/projects.cjs');
const { validateConfig, checkClaudeWiring } = require('../src/core/lib/validate.cjs');
const { checkRemote } = require('../src/core/lib/remote.cjs');
const { createMarkers } = require('../src/core/lib/markers.cjs');
const { aggregate, formatStats } = require('../src/core/lib/stats.cjs');
const { removeAssets, unwireClaude, unwireCursor, unwireLegacyClaude, unwireLegacyCursor } = require('../src/core/lib/uninstall.cjs');
const skillsLib = require('../src/core/lib/skills.cjs');
const { hooksFragment } = require('../src/adapters/claude/settings-fragment.cjs');

function usage() {
  process.stdout.write(
    'agentkit <command>\n\n' +
    'Commands:\n' +
    '  init --tool claude|cursor [--project <pack>]   Wire guardrails + write config skeleton\n' +
    '  sync [--check]       Render + install managed assets (skills, commands, agents); --check = dry-run for CI\n' +
    '  doctor [--check-remote]  Strict check: node, config, pack, wiring + asset drift; flag also compares installed vs latest kit tag\n' +
    '  verify               doctor + behavioral smoke of every enabled guardrail + sync state — one-shot install proof\n' +
    '  stats [--json]       Aggregate the guardrail log: events by guardrail/decision, top block reasons, recent blocks\n' +
    '  new <kind> <name> [--pack <pack>]  Scaffold a kit asset (guardrail|skill|command|agent) — AgentKit repo only\n' +
    '  uninstall [--purge]  Remove synced assets, unwire hooks, delete state; --purge also removes config + .agentkit/\n' +
    '  list                 List guardrails and synced assets: built-in, project pack, local\n' +
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
  const legacy = unwireLegacyCursor(cfg);
  if (legacy.removed) process.stdout.write(`migrated: removed ${legacy.removed} stale cursor hook(s) wired to the interim @arches-corporation/agentkit package name (v2.0.x)\n`);
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
  let projectArg = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
  if (projectArg && LEGACY_PACK_ALIASES[projectArg]) projectArg = LEGACY_PACK_ALIASES[projectArg];
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
  const legacy = unwireLegacyClaude(settings);
  if (legacy.removed) process.stdout.write(`migrated: removed ${legacy.removed} stale hook(s) wired to the interim @arches-corporation/agentkit package name (v2.0.x)\n`);
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

function cmdSync(args) {
  const checkOnly = args.includes('--check');
  const root = findRepoRoot(process.cwd());
  const cfg = loadConfig(root);
  const project = packName(cfg);

  const { rendered, errors } = skillsLib.renderAll(cfg, project);
  if (errors.length) {
    for (const e of errors) process.stderr.write(`FAIL ${e}\n`);
    process.exit(1);
  }
  if (!rendered.length) {
    process.stdout.write('no assets to sync (none in kit for this configuration)\n');
    process.exit(0);
  }

  const manifest = skillsLib.readManifest(root);
  const actions = skillsLib.planSync(root, rendered, manifest);
  const drift = actions.filter((a) => a.type === 'drift');
  const changes = actions.filter((a) => a.type === 'create' || a.type === 'update' || a.type === 'delete');

  for (const a of actions) {
    if (a.type === 'unchanged') continue;
    process.stdout.write(`${a.type.padEnd(9)} ${(a.kind + ':' + a.name).padEnd(30)} ${a.target}${a.reason ? ` (${a.reason})` : ''}\n`);
  }

  if (drift.length) {
    process.stderr.write(
      `FAIL ${drift.length} locally edited managed asset(s) — revert the edit, or copy it to a repo-local one and add the name to the kind's exclude list, then re-run\n`
    );
    process.exit(1);
  }

  if (checkOnly) {
    if (changes.length) {
      process.stdout.write(`sync --check: ${changes.length} pending change(s)\n`);
      process.exit(1);
    }
    process.stdout.write(`sync --check: clean (${rendered.length} assets in sync)\n`);
    process.exit(0);
  }

  const byKey = new Map(rendered.map((r) => [`${r.kind}:${r.name}`, r]));
  for (const a of actions) {
    if (a.type === 'create' || a.type === 'update') {
      const r = byKey.get(`${a.kind}:${a.name}`);
      const abs = path.join(root, r.target);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, r.content);
    } else if (a.type === 'delete') {
      try {
        fs.rmSync(path.join(root, a.target));
        const dir = path.dirname(path.join(root, a.target));
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch { /* already gone */ }
    }
  }

  let kitVersion = 'unknown';
  try { kitVersion = require('../package.json').version; } catch { /* keep unknown */ }
  skillsLib.writeManifest(root, kitVersion, rendered);
  process.stdout.write(`synced ${rendered.length} assets (${changes.length} changed) — manifest: ${skillsLib.MANIFEST_REL}\n`);
}

function cmdDoctor(args = []) {
  process.exit(runDoctor(args) ? 0 : 1);
}

function runDoctor(args = []) {
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
      return false;
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
  const aliased = packAliasUsed(cfg);
  if (aliased) warn(`project "${aliased.alias}" is a legacy alias — rename to "${aliased.canonical}" (pack names now match the GitHub repo name)`);
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

  const resolved = {
    builtins,
    pack: packOk,
    locals: localOk,
    skillNames: skillsLib.allAssetNames(project, 'skill'),
    commandNames: skillsLib.allAssetNames(project, 'command'),
    agentNames: skillsLib.allAssetNames(project, 'agent'),
  };
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

  const assetsCheck = skillsLib.renderAll(cfg, project);
  {
    const manifest = skillsLib.readManifest(root);
    if (!manifest) {
      if (assetsCheck.errors.length) {
        warn(`kit assets not configured (${assetsCheck.errors.length} missing var(s)) — set skills.vars, then run: agentkit sync`);
      } else if (assetsCheck.rendered.length) {
        warn(`${assetsCheck.rendered.length} kit assets available but never synced (run: agentkit sync)`);
      }
    } else if (assetsCheck.errors.length) {
      for (const e of assetsCheck.errors) fail(e);
    } else if (assetsCheck.rendered.length) {
      const actions = skillsLib.planSync(root, assetsCheck.rendered, manifest);
      let assetsOk = true;
      for (const a of actions) {
        if (a.type === 'drift') {
          assetsOk = false;
          fail(`${a.kind} "${a.name}" locally edited (${a.target}) — revert, or copy to a repo-local one and add to the kind's exclude list`);
        } else if (a.type === 'create') {
          assetsOk = false;
          fail(`${a.kind} "${a.name}" missing at ${a.target} (run: agentkit sync)`);
        } else if (a.type === 'update' || a.type === 'delete') {
          assetsOk = false;
          warn(`${a.kind} "${a.name}" out of date (run: agentkit sync)`);
        }
      }
      if (assetsOk) good(`${assetsCheck.rendered.length} managed assets in sync`);
    }
  }

  if (args.includes('--check-remote')) {
    let pkg = {};
    try { pkg = require('../package.json'); } catch { /* self */ }
    const repoUrl = pkg.repository && pkg.repository.url;
    if (!repoUrl) {
      warn('--check-remote: no repository.url in the installed package');
    } else {
      const r = checkRemote(repoUrl, pkg.version);
      if (r.status === 'behind') warn(`newer kit v${r.latest} available (installed ${r.installed}) — re-run the install command to refresh`);
      else if (r.status === 'current') good(`kit is current (v${r.installed} = latest tag)`);
      else warn(`remote check failed: ${r.message}`);
    }
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

  return ok;
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
  const assets = skillsLib.resolveAssets(config, project);
  for (const kind of Object.keys(skillsLib.KINDS)) {
    const ofKind = assets.filter((a) => a.kind === kind);
    if (!ofKind.length) continue;
    process.stdout.write(`\n${kind}s:\n`);
    for (const a of ofKind) {
      process.stdout.write(`${a.name.padEnd(26)} -> ${a.installPath} (${a.tier})\n`);
    }
  }
}

const SMOKE_FIXTURES = {
  'hard-stop': (tmp) => ({ event: bashSmokeEvent('git commit -m x', tmp), expect: 'block' }),
  'privacy-block': (tmp) => ({ event: pathSmokeEvent(path.join(tmp, '.env'), tmp), expect: 'block' }),
  'secret-output': (tmp) => ({ event: promptSmokeEvent('key AKIAIOSFODNN7EXAMPLE', tmp), expect: 'block' }),
  'scout-block': (tmp) => ({ event: pathSmokeEvent(path.join(tmp, 'node_modules', 'x.js'), tmp), expect: 'block' }),
  'force-push-guard': (tmp) => ({ event: bashSmokeEvent('git push --force origin x', tmp), expect: 'block' }),
  'db-guard': (tmp) => ({ event: bashSmokeEvent('bundle exec rails db:drop', tmp), expect: 'block' }),
};

function bashSmokeEvent(command, cwd) {
  return { hookEvent: 'PreToolUse', toolName: 'Bash', command, paths: [], prompt: '', cwd, sessionId: null };
}

function pathSmokeEvent(p, cwd) {
  return { hookEvent: 'PreToolUse', toolName: 'Read', command: '', paths: [p], prompt: '', cwd, sessionId: null };
}

function promptSmokeEvent(text, cwd) {
  return { hookEvent: 'UserPromptSubmit', toolName: null, command: '', paths: [], prompt: text, cwd, sessionId: null };
}

function cmdVerify() {
  let ok = runDoctor([]);

  const root = findRepoRoot(process.cwd());
  const cfg = loadConfig(root);
  const project = packName(cfg);

  const builtinNames = new Set(registry.list().map((g) => g.name));
  const pack = loadPack(project).guardrails.filter((g) => !builtinNames.has(g.name));
  const takenNames = new Set([...builtinNames, ...pack.map((g) => g.name)]);
  const locals = loadAll(cfg, root).guardrails.filter((g) => !takenNames.has(g.name));

  for (const g of [...registry.list(), ...pack, ...locals]) {
    if (!isEnabled(cfg, g.name)) continue;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-verify-'));
    const ctx = {
      repoRoot: tmp,
      options: optionsFor(cfg, g.name),
      markers: createMarkers(path.join(tmp, 'state')),
      log: () => {},
    };
    const fixture = SMOKE_FIXTURES[g.name];
    try {
      if (fixture) {
        const { event, expect } = fixture(tmp);
        const result = g.check(event, ctx);
        if (expect === 'block' && !(result && result.block)) {
          ok = false;
          process.stdout.write(`FAIL guardrail ${g.name}: canned ${expect} fixture did not block\n`);
        } else {
          process.stdout.write(`ok   guardrail ${g.name} behaves (canned fixture blocks)\n`);
        }
      } else {
        const benign = (g.events || []).includes('UserPromptSubmit')
          ? promptSmokeEvent('hello', tmp)
          : bashSmokeEvent('true', tmp);
        g.check(benign, ctx);
        process.stdout.write(`ok   guardrail ${g.name} contract smoke (no throw)\n`);
      }
    } catch (err) {
      ok = false;
      process.stdout.write(`FAIL guardrail ${g.name} threw: ${String((err && err.message) || err)}\n`);
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp cleanup */ }
    }
  }

  const { rendered, errors } = skillsLib.renderAll(cfg, project);
  if (errors.length) {
    ok = false;
    for (const e of errors) process.stdout.write(`FAIL ${e}\n`);
  } else if (rendered.length) {
    const manifest = skillsLib.readManifest(root);
    const pending = skillsLib.planSync(root, rendered, manifest).filter((a) => a.type !== 'unchanged');
    if (pending.length) {
      ok = false;
      for (const a of pending) process.stdout.write(`FAIL asset ${a.kind}:${a.name} ${a.type} pending (run: agentkit sync)\n`);
    } else {
      process.stdout.write(`ok   ${rendered.length} managed assets verified in sync\n`);
    }
  }

  process.stdout.write(ok ? 'verify: PASS\n' : 'verify: FAIL\n');
  process.exit(ok ? 0 : 1);
}

function cmdStats(args) {
  const root = findRepoRoot(process.cwd());
  const cfg = loadConfig(root);
  const logPath = path.join(stateDir(cfg, root), 'guardrail-log.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch {
    process.stdout.write('no guardrail log yet\n');
    process.exit(0);
  }
  const stats = aggregate(raw.split('\n'));
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
  } else {
    process.stdout.write(formatStats(stats) + '\n');
  }
  process.exit(0);
}

const ASSET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const SCAFFOLD_KINDS = {
  guardrail: null,
  skill: { dir: 'skills', file: 'SKILL.md' },
  command: { dir: 'commands', file: 'COMMAND.md' },
  agent: { dir: 'agents', file: 'AGENT.md' },
};

function guardrailStub(name) {
  return (
    "'use strict';\n\n" +
    'module.exports = {\n' +
    `  name: '${name}',\n` +
    "  events: ['PreToolUse'],\n" +
    "  matcher: 'Bash',\n" +
    '  failClosed: false,\n' +
    '  defaults: {},\n' +
    '  check(event, ctx) {\n' +
    '    return null;\n' +
    '  },\n' +
    '};\n'
  );
}

function assetStub(kind, name) {
  if (kind === 'agent') {
    return (
      '---\n' +
      `name: ${name}\n` +
      'description: When to use this subagent.\n' +
      'tools: Read, Grep, Glob, Bash\n' +
      '---\n\n' +
      `# ${name}\n\n` +
      'Instructions for the subagent.\n'
    );
  }
  return `# ${name}\n\nDescribe when an agent should use this ${kind} and the steps to follow.\n`;
}

function cmdNew(args) {
  const [kind, name] = args.filter((a) => !a.startsWith('--'));
  const pack = args.includes('--pack') ? args[args.indexOf('--pack') + 1] : null;

  if (!(kind in SCAFFOLD_KINDS)) {
    process.stderr.write(`agentkit new: unknown kind "${kind || ''}" (available: ${Object.keys(SCAFFOLD_KINDS).join(', ')})\n`);
    process.exit(1);
  }
  if (!name || !ASSET_NAME_RE.test(name)) {
    process.stderr.write(`agentkit new: invalid name "${name || ''}" (lowercase letters, digits, dashes)\n`);
    process.exit(1);
  }

  const root = findRepoRoot(process.cwd());
  let pkgName = null;
  try { pkgName = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name; } catch { /* no package.json */ }
  if (pkgName !== '@arches/agentkit') {
    process.stderr.write('agentkit new: run inside the AgentKit repo — consumers prototype guardrails in .agentkit/guardrails/ (docs/local-guardrails.md)\n');
    process.exit(1);
  }
  if (pack && !packExists(pack)) {
    process.stderr.write(`agentkit new: no project pack "${pack}" (available: ${listPacks().join(', ') || 'none'})\n`);
    process.exit(1);
  }

  let target;
  let content;
  const nextSteps = [];
  if (kind === 'guardrail') {
    target = pack
      ? path.join(root, 'src', 'projects', pack, `${name}.cjs`)
      : path.join(root, 'src', 'core', 'guardrails', `${name}.cjs`);
    content = guardrailStub(name);
    if (!pack) nextSteps.push('register it in src/core/registry.cjs (packs auto-load; built-ins do not)');
    nextSteps.push('add an option spec to BUILT_IN_OPTION_SPECS in src/core/lib/validate.cjs if it takes options');
    nextSteps.push('add tests in test/ and a doc page docs/guardrails/' + name + '.md + README row');
  } else {
    const spec = SCAFFOLD_KINDS[kind];
    const baseDir = pack
      ? path.join(root, 'src', 'projects', pack, spec.dir)
      : path.join(root, spec.dir);
    target = path.join(baseDir, name, spec.file);
    content = assetStub(kind, name);
    nextSteps.push('write the content (add meta.json next to it for {{vars}} defaults or a custom installPath)');
    nextSteps.push('add coverage in test/skills.test.cjs and a README row');
  }

  if (fs.existsSync(target)) {
    process.stderr.write(`agentkit new: ${path.relative(root, target)} already exists\n`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  process.stdout.write(`scaffolded ${path.relative(root, target)}\nnext:\n`);
  for (const s of nextSteps) process.stdout.write(`  - ${s}\n`);
}

function cmdUninstall(args) {
  const purge = args.includes('--purge');
  const root = findRepoRoot(process.cwd());
  const cfg = loadConfig(root);

  const manifest = skillsLib.readManifest(root);
  const removed = removeAssets(root, manifest);
  const manifestPath = path.join(root, skillsLib.MANIFEST_REL);
  try { fs.rmSync(manifestPath); } catch { /* none */ }
  process.stdout.write(`removed ${removed.length} managed asset(s)${manifest ? ' + manifest' : ''}\n`);

  const settingsPath = path.join(root, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const { removed: n } = unwireClaude(settings);
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      process.stdout.write(`unwired ${n} hook(s) from .claude/settings.json\n`);
    } catch (err) {
      process.stdout.write(`warn .claude/settings.json not valid JSON — left untouched (${err.message})\n`);
    }
  }

  const cursorPath = path.join(root, '.cursor', 'hooks.json');
  if (fs.existsSync(cursorPath)) {
    try {
      const cursorCfg = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
      const { removed: n } = unwireCursor(cursorCfg);
      fs.writeFileSync(cursorPath, JSON.stringify(cursorCfg, null, 2) + '\n');
      process.stdout.write(`unwired ${n} hook(s) from .cursor/hooks.json\n`);
    } catch (err) {
      process.stdout.write(`warn .cursor/hooks.json not valid JSON — left untouched (${err.message})\n`);
    }
  }

  try { fs.rmSync(stateDir(cfg, root), { recursive: true, force: true }); } catch { /* none */ }
  process.stdout.write('removed state dir (markers, log)\n');

  if (purge) {
    try { fs.rmSync(path.join(root, CONFIG_FILENAME)); } catch { /* none */ }
    try { fs.rmSync(path.join(root, '.agentkit'), { recursive: true, force: true }); } catch { /* none */ }
    process.stdout.write(`purged ${CONFIG_FILENAME} and .agentkit/ (including any repo-local prototype guardrails)\n`);
  } else {
    process.stdout.write(`kept ${CONFIG_FILENAME} and .agentkit/guardrails/ (repo-owned; --purge removes them)\n`);
  }

  process.stdout.write('now run: npm uninstall @arches/agentkit   (pnpm remove -w @arches/agentkit · yarn remove @arches/agentkit)\n');
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init': return cmdInit(args);
    case 'sync': return cmdSync(args);
    case 'doctor': return cmdDoctor(args);
    case 'verify': return cmdVerify();
    case 'stats': return cmdStats(args);
    case 'new': return cmdNew(args);
    case 'uninstall': return cmdUninstall(args);
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
