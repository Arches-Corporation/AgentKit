'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('../src/core/registry.cjs');
const { validateConfig, checkClaudeWiring } = require('../src/core/lib/validate.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');
const RESOLVED = { builtins: registry.list(), pack: [], locals: [] };

function errorsOf(config, resolved = RESOLVED) {
  return validateConfig(config, resolved).errors;
}

test('validate: canonical skeleton config passes', () => {
  const skeleton = JSON.parse(
    spawnSync('node', ['-e', `
      const registry = require('${path.join(__dirname, '..', 'src', 'core', 'registry.cjs')}');
      const guardrails = {};
      for (const g of registry.list()) guardrails[g.name] = Object.assign({ enabled: true }, g.defaults);
      console.log(JSON.stringify({ stateDir: '.agentkit/state', guardrails }));
    `], { encoding: 'utf8' }).stdout
  );
  assert.deepStrictEqual(errorsOf(skeleton), []);
});

test('validate: unknown top-level key rejected', () => {
  const errs = errorsOf({ stateDirr: 'x' });
  assert.ok(errs.some((e) => /unknown top-level key "stateDirr"/.test(e)));
});

test('validate: unknown guardrail name rejected', () => {
  const errs = errorsOf({ guardrails: { 'hardstop': { enabled: true } } });
  assert.ok(errs.some((e) => /guardrails\.hardstop: no such guardrail/.test(e)));
});

test('validate: unknown option on built-in rejected', () => {
  const errs = errorsOf({ guardrails: { 'spec-first': { ticketPatern: 'X-\\d+' } } });
  assert.ok(errs.some((e) => /spec-first\.ticketPatern: unknown option/.test(e)));
});

test('validate: wrong option type rejected', () => {
  const errs = errorsOf({ guardrails: { 'spec-first': { requireSpecDir: 'yes' } } });
  assert.ok(errs.some((e) => /requireSpecDir: must be a boolean/.test(e)));
});

test('validate: invalid regex in ticketPattern rejected', () => {
  const errs = errorsOf({ guardrails: { 'spec-first': { ticketPattern: '[unclosed' } } });
  assert.ok(errs.some((e) => /ticketPattern: invalid regex/.test(e)));
});

test('validate: invalid regex inside sensitive array rejected with index', () => {
  const errs = errorsOf({ guardrails: { 'privacy-block': { sensitive: ['\\.env$', '('] } } });
  assert.ok(errs.some((e) => /sensitive: \[1\] invalid regex/.test(e)));
});

test('validate: extraPatterns entries validated', () => {
  const errs = errorsOf({ guardrails: { 'db-guard': { extraPatterns: [{ pattern: '(', label: 'x' }] } } });
  assert.ok(errs.some((e) => /extraPatterns: \[0\] invalid regex/.test(e)));
  const errs2 = errorsOf({ guardrails: { 'db-guard': { extraPatterns: [{ patern: 'x' }] } } });
  assert.ok(errs2.some((e) => /unknown key "patern"/.test(e)));
});

test('validate: rules-reminder text accepts string and string array, rejects number', () => {
  assert.deepStrictEqual(errorsOf({ guardrails: { 'rules-reminder': { text: 'x' } } }), []);
  assert.deepStrictEqual(errorsOf({ guardrails: { 'rules-reminder': { text: ['a', 'b'] } } }), []);
  const errs = errorsOf({ guardrails: { 'rules-reminder': { text: 42 } } });
  assert.ok(errs.some((e) => /text: must be a string or an array of strings/.test(e)));
});

test('validate: enabled must be boolean everywhere', () => {
  const errs = errorsOf({ guardrails: { 'hard-stop': { enabled: 'true' } } });
  assert.ok(errs.some((e) => /hard-stop\.enabled: must be a boolean/.test(e)));
});

test('validate: pack guardrail keys accepted, unknown pack option rejected', () => {
  const packModule = { name: 'my-rule', events: ['PreToolUse'], matcher: 'Bash', defaults: { level: 'high' }, check: () => null };
  const resolved = { builtins: registry.list(), pack: [packModule], locals: [] };
  assert.deepStrictEqual(errorsOf({ guardrails: { 'my-rule': { enabled: true, level: 'low' } } }, resolved), []);
  const errs = errorsOf({ guardrails: { 'my-rule': { lvel: 'low' } } }, resolved);
  assert.ok(errs.some((e) => /my-rule\.lvel: unknown option/.test(e)));
  const errs2 = errorsOf({ guardrails: { 'my-rule': { level: 5 } } }, resolved);
  assert.ok(errs2.some((e) => /my-rule\.level: must be a string/.test(e)));
});

function wiredSettings(names) {
  const byEvent = {};
  for (const g of registry.list()) {
    if (!names.includes(g.name)) continue;
    for (const event of g.events) {
      byEvent[event] = byEvent[event] || [];
      byEvent[event].push({
        matcher: g.matcher || undefined,
        hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/node_modules/@arches/agentkit/src/adapters/claude/run.cjs" ${g.name}` }],
      });
    }
  }
  return { hooks: byEvent };
}

test('wiring: complete wiring passes', () => {
  const all = registry.list().map((g) => g.name);
  const r = checkClaudeWiring(wiredSettings(all), {}, RESOLVED);
  assert.deepStrictEqual(r.errors, []);
});

test('wiring: enabled-but-unwired guardrail fails', () => {
  const partial = registry.list().map((g) => g.name).filter((n) => n !== 'hard-stop');
  const r = checkClaudeWiring(wiredSettings(partial), {}, RESOLVED);
  assert.ok(r.errors.some((e) => /"hard-stop" is enabled but not wired/.test(e)));
});

test('wiring: disabled guardrail may be unwired', () => {
  const partial = registry.list().map((g) => g.name).filter((n) => n !== 'hard-stop');
  const cfg = { guardrails: { 'hard-stop': { enabled: false } } };
  const r = checkClaudeWiring(wiredSettings(partial), cfg, RESOLVED);
  assert.deepStrictEqual(r.errors, []);
});

test('wiring: stale entry for unknown guardrail fails', () => {
  const settings = wiredSettings(registry.list().map((g) => g.name));
  settings.hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/node_modules/@arches/agentkit/src/adapters/claude/run.cjs" removed-rule' }],
  });
  const r = checkClaudeWiring(settings, {}, RESOLVED);
  assert.ok(r.errors.some((e) => /unknown guardrail "removed-rule"/.test(e)));
});

test('wiring: wrong matcher fails', () => {
  const settings = wiredSettings(registry.list().map((g) => g.name));
  for (const entry of settings.hooks.PreToolUse) {
    for (const h of entry.hooks) {
      if (h.command.endsWith(' hard-stop')) entry.matcher = 'Read';
    }
  }
  const r = checkClaudeWiring(settings, {}, RESOLVED);
  assert.ok(r.errors.some((e) => /"hard-stop" wired with matcher "Read"/.test(e)));
});

test('doctor: pack config keys are known (regression — no unknown-guardrail noise)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-doctor-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, 'agentkit.config.json'), JSON.stringify({
    project: 'ekb',
    guardrails: { 'dev-rules-reminder': { enabled: true }, 'pr-body-contract': { enabled: true } },
  }));
  const r = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo });
  assert.doesNotMatch(r.stdout, /unknown guardrail\(s\)/);
  assert.doesNotMatch(r.stdout, /no such guardrail/);
  assert.match(r.stdout, /ok {3}pack guardrail dev-rules-reminder \(ekb\)/);
});

test('doctor: invalid regex in config fails with exit 1', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-doctor-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, 'agentkit.config.json'), JSON.stringify({
    guardrails: { 'spec-first': { ticketPattern: '[bad' } },
  }));
  const r = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /invalid regex/);
});

test('doctor: wiring drift detected after manual settings edit', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-doctor-'));
  fs.mkdirSync(path.join(repo, '.git'));
  spawnSync('node', [CLI, 'init', '--tool', 'claude'], { encoding: 'utf8', cwd: repo });
  const settingsPath = path.join(repo, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.map((entry) => ({
    ...entry,
    hooks: entry.hooks.filter((h) => !h.command.endsWith(' hard-stop')),
  })).filter((entry) => entry.hooks.length);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  const r = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /"hard-stop" is enabled but not wired/);
});

test('doctor: clean init passes end-to-end', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-doctor-'));
  fs.mkdirSync(path.join(repo, '.git'));
  spawnSync('node', [CLI, 'init', '--tool', 'claude', '--project', 'ekb'], { encoding: 'utf8', cwd: repo });
  const r = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /valid \(keys, option types, regexes\)/);
  assert.match(r.stdout, /wiring matches enabled guardrails/);
});
