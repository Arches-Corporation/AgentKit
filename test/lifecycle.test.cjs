'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { aggregate } = require('../src/core/lib/stats.cjs');
const { unwireClaude } = require('../src/core/lib/uninstall.cjs');
const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');

const EKB_VARS = {
  feDir: 'apps/web',
  beDir: 'apps/api',
  beStack: 'Rails 7 · MySQL 8 · Elasticsearch/searchkick · Sidekiq',
  sentryProjects: '`ekb-dev` / `ekb-staging` / `ekb-production`',
  orgName: 'EKB',
};

function ekbConfig() {
  return {
    project: 'ekb',
    guardrails: { 'spec-first': { ticketPattern: 'EKB-\\d+', specDirTemplate: 'docs/specs/features/{ticket}' } },
    skills: { vars: Object.assign({}, EKB_VARS) },
  };
}

function tmpRepo(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-lifecycle-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'agentkit.config.json'), JSON.stringify(config));
  return dir;
}

function runCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd });
}

// ---- verify ----

test('verify: synced repo passes, canned fixtures block', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['init', '--tool', 'claude'], repo);
  runCli(['sync'], repo);
  const r = runCli(['verify'], repo);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /guardrail hard-stop behaves/);
  assert.match(r.stdout, /guardrail privacy-block behaves/);
  assert.match(r.stdout, /managed assets verified in sync/);
  assert.match(r.stdout, /verify: PASS/);
});

test('verify: drift fails', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['init', '--tool', 'claude'], repo);
  runCli(['sync'], repo);
  fs.appendFileSync(path.join(repo, '.claude/commands/pr.md'), '\nhack\n');
  const r = runCli(['verify'], repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /verify: FAIL/);
});

test('verify: broken wiring fails', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['init', '--tool', 'claude'], repo);
  runCli(['sync'], repo);
  const settingsPath = path.join(repo, '.claude/settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.slice(1);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  const r = runCli(['verify'], repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /not wired/);
});

test('verify: leaves real markers untouched', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['init', '--tool', 'claude'], repo);
  runCli(['sync'], repo);
  const marker = path.join(repo, '.agentkit/state/git-approved');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, '');
  const r = runCli(['verify'], repo);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(fs.existsSync(marker), 'verify consumed a real marker');
});

// ---- stats ----

test('stats: aggregate counts, top reasons, malformed lines skipped', () => {
  const lines = [
    JSON.stringify({ ts: '2026-01-01T00:00:00Z', guardrail: 'hard-stop', decision: 'block', reason: 'BLOCKED: HARD STOP\nlong tail' }),
    JSON.stringify({ ts: '2026-01-02T00:00:00Z', guardrail: 'hard-stop', decision: 'block', reason: 'BLOCKED: HARD STOP\nother tail' }),
    JSON.stringify({ ts: '2026-01-03T00:00:00Z', guardrail: 'scout-block', decision: 'block', reason: 'BLOCKED: node_modules' }),
    JSON.stringify({ ts: '2026-01-04T00:00:00Z', guardrail: 'rules-reminder', decision: 'inject' }),
    'not json at all {',
    JSON.stringify({ nothing: true }),
    '',
  ];
  const s = aggregate(lines);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.blockCount, 3);
  assert.strictEqual(s.byGuardrail['hard-stop'].block, 2);
  assert.strictEqual(s.byGuardrail['rules-reminder'].inject, 1);
  assert.strictEqual(s.firstTs, '2026-01-01T00:00:00Z');
  assert.strictEqual(s.lastTs, '2026-01-04T00:00:00Z');
  assert.deepStrictEqual(s.topBlockReasons[0], { reason: 'BLOCKED: HARD STOP', count: 2 });
  assert.strictEqual(s.recentBlocks.length, 3);
});

test('stats: CLI renders log, --json parses, missing log ok', () => {
  const repo = tmpRepo(ekbConfig());
  const none = runCli(['stats'], repo);
  assert.strictEqual(none.status, 0);
  assert.match(none.stdout, /no guardrail log yet/);

  const logPath = path.join(repo, '.agentkit/state/guardrail-log.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify({ ts: '2026-01-01T00:00:00Z', guardrail: 'db-guard', decision: 'block', reason: 'BLOCKED: db drop' }) + '\n');
  const text = runCli(['stats'], repo);
  assert.strictEqual(text.status, 0);
  assert.match(text.stdout, /1 guardrail events/);
  assert.match(text.stdout, /db-guard/);
  const json = runCli(['stats', '--json'], repo);
  const parsed = JSON.parse(json.stdout);
  assert.strictEqual(parsed.total, 1);
  assert.strictEqual(parsed.byGuardrail['db-guard'].block, 1);
});

// ---- new ----

function tmpKitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-fakekit-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@arches/agentkit', version: '0.0.0' }));
  return dir;
}

test('new: refuses outside the kit repo', () => {
  const repo = tmpRepo(ekbConfig());
  const r = runCli(['new', 'guardrail', 'my-rule'], repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /run inside the AgentKit repo/);
});

test('new: guardrail stub loads and matches the contract', () => {
  const kit = tmpKitRepo();
  const r = runCli(['new', 'guardrail', 'my-rule'], kit);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const stubPath = path.join(kit, 'src/core/guardrails/my-rule.cjs');
  assert.ok(fs.existsSync(stubPath));
  const mod = require(stubPath);
  assert.strictEqual(mod.name, 'my-rule');
  assert.ok(Array.isArray(mod.events));
  assert.strictEqual(typeof mod.check, 'function');
  assert.strictEqual(mod.check({}, {}), null);
  assert.match(r.stdout, /registry\.cjs/);
});

test('new: skill/command/agent stubs, pack placement, duplicates refused', () => {
  const kit = tmpKitRepo();
  assert.strictEqual(runCli(['new', 'skill', 'my-skill'], kit).status, 0);
  assert.ok(fs.existsSync(path.join(kit, 'skills/my-skill/SKILL.md')));
  assert.strictEqual(runCli(['new', 'command', 'my-cmd', '--pack', 'ekb'], kit).status, 0);
  assert.ok(fs.existsSync(path.join(kit, 'src/projects/ekb/commands/my-cmd/COMMAND.md')));
  assert.strictEqual(runCli(['new', 'agent', 'my-agent'], kit).status, 0);
  assert.match(fs.readFileSync(path.join(kit, 'agents/my-agent/AGENT.md'), 'utf8'), /^---\nname: my-agent/);
  const dup = runCli(['new', 'skill', 'my-skill'], kit);
  assert.strictEqual(dup.status, 1);
  assert.match(dup.stderr, /already exists/);
  const bad = runCli(['new', 'skill', 'Bad_Name'], kit);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /invalid name/);
  const badKind = runCli(['new', 'widget', 'x'], kit);
  assert.strictEqual(badKind.status, 1);
  assert.match(badKind.stderr, /unknown kind/);
});

// ---- uninstall ----

test('uninstall: assets, wiring, state removed; config and foreign hooks kept', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['init', '--tool', 'claude'], repo);
  runCli(['init', '--tool', 'cursor'], repo);
  runCli(['sync'], repo);

  const settingsPath = path.join(repo, '.claude/settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo my-own-hook' }] });
  settings.env = { KEEP: 'me' };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  fs.mkdirSync(path.join(repo, '.agentkit/state'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agentkit/state/guardrail-log.jsonl'), '{}\n');

  const r = runCli(['uninstall'], repo);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);

  assert.ok(!fs.existsSync(path.join(repo, '.agents')));
  assert.ok(!fs.existsSync(path.join(repo, '.claude/commands')));
  assert.ok(!fs.existsSync(path.join(repo, '.claude/agents')));
  assert.ok(!fs.existsSync(path.join(repo, '.agentkit/skills.manifest.json')));
  assert.ok(!fs.existsSync(path.join(repo, '.agentkit/state')));

  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const cmds = JSON.stringify(after);
  assert.ok(!cmds.includes('@arches/agentkit'), 'kit wiring still present');
  assert.ok(cmds.includes('echo my-own-hook'), 'foreign hook lost');
  assert.strictEqual(after.env.KEEP, 'me');

  const cursor = JSON.parse(fs.readFileSync(path.join(repo, '.cursor/hooks.json'), 'utf8'));
  assert.ok(!JSON.stringify(cursor).includes('@arches/agentkit'));

  assert.ok(fs.existsSync(path.join(repo, 'agentkit.config.json')), 'config must survive default uninstall');
  assert.ok(fs.existsSync(path.join(repo, '.agentkit/guardrails')), 'local guardrails dir must survive');
  assert.match(r.stdout, /npm uninstall @arches\/agentkit/);

  const again = runCli(['uninstall'], repo);
  assert.strictEqual(again.status, 0, 'uninstall must be idempotent');
});

test('uninstall --purge: config and .agentkit removed', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['init', '--tool', 'claude'], repo);
  runCli(['sync'], repo);
  const r = runCli(['uninstall', '--purge'], repo);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.ok(!fs.existsSync(path.join(repo, 'agentkit.config.json')));
  assert.ok(!fs.existsSync(path.join(repo, '.agentkit')));
});

test('init: migrates stale wiring from the interim @arches-corporation/agentkit name', () => {
  const repo = tmpRepo(ekbConfig());
  const settingsPath = path.join(repo, '.claude/settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/node_modules/@arches-corporation/agentkit/src/adapters/claude/run.cjs" hard-stop' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] },
      ],
    },
  }));
  const r = runCli(['init', '--tool', 'claude'], repo);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /migrated: removed 1 stale hook/);
  const after = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(!after.includes('@arches-corporation/agentkit/'), 'interim-name wiring must be gone');
  assert.ok(after.includes('@arches/agentkit/src/adapters/claude/run.cjs'), 'current wiring present');
  assert.ok(after.includes('echo keep-me'), 'foreign hook preserved');
});

test('unwireClaude: pure helper strips only kit commands', () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/node_modules/@arches/agentkit/src/adapters/claude/run.cjs" hard-stop' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] },
      ],
    },
  };
  const { removed } = unwireClaude(settings);
  assert.strictEqual(removed, 1);
  assert.strictEqual(settings.hooks.PreToolUse.length, 1);
  assert.strictEqual(settings.hooks.PreToolUse[0].hooks[0].command, 'echo mine');
});
