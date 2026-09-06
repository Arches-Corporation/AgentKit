'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const skillsLib = require('../src/core/lib/skills.cjs');
const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');

const EKB_VARS = {
  feDir: 'apps/web',
  beDir: 'apps/api',
  beStack: 'Rails 7 · MySQL 8 · Elasticsearch/searchkick · Sidekiq',
  sentryProjects: '`ekb-dev` / `ekb-staging` / `ekb-production`',
  orgName: 'EKB',
};

function ekbConfig(extra = {}) {
  return Object.assign({
    project: 'EKB',
    guardrails: { 'spec-first': { ticketPattern: 'EKB-\\d+', specDirTemplate: 'docs/specs/features/{ticket}' } },
    skills: { vars: Object.assign({}, EKB_VARS) },
  }, extra);
}

function tmpRepo(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-skills-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'agentkit.config.json'), JSON.stringify(config));
  return dir;
}

function runCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd });
}

test('resolve: shared + ekb pack skills, sorted, exclude honored', () => {
  const all = skillsLib.resolveSkills(ekbConfig(), 'EKB');
  const names = all.map((s) => s.name);
  assert.ok(names.includes('deep-review'));
  assert.ok(names.includes('route'));
  assert.ok(names.includes('e2e-testing'));
  const excluded = skillsLib.resolveSkills(ekbConfig({ skills: { vars: EKB_VARS, exclude: ['sentry-investigator'] } }), 'EKB');
  assert.ok(!excluded.map((s) => s.name).includes('sentry-investigator'));
});

test('resolve: no pack -> shared only', () => {
  const names = skillsLib.resolveSkills({}, null).map((s) => s.name);
  assert.ok(names.includes('deep-review'));
  assert.ok(!names.includes('route'));
});

test('meta: e2e-testing has custom installPath, others default', () => {
  const skills = skillsLib.resolveSkills(ekbConfig(), 'EKB');
  const e2e = skills.find((s) => s.name === 'e2e-testing');
  assert.strictEqual(e2e.installPath, 'apps/web/.claude/skills/e2e-testing/SKILL.md');
  const dr = skills.find((s) => s.name === 'deep-review');
  assert.strictEqual(dr.installPath, '.agents/skills/deep-review/SKILL.md');
});

test('vars: derived specDirDisplay from spec-first config', () => {
  const vars = skillsLib.buildVars(ekbConfig());
  assert.strictEqual(vars.specDirDisplay, 'docs/specs/features/<TICKET-ID>');
  assert.strictEqual(vars.ticketPattern, 'EKB-\\d+');
});

test('render: ekb vars produce clean content with EKB values, no leftover placeholders', () => {
  const { rendered, errors } = skillsLib.renderAll(ekbConfig(), 'EKB');
  assert.deepStrictEqual(errors, []);
  assert.ok(rendered.length >= 12);
  for (const r of rendered) {
    assert.ok(!/\{\{[a-zA-Z]+\}\}/.test(r.content), `${r.name} has unresolved placeholders`);
  }
  const spec = rendered.find((r) => r.name === 'spec-check');
  assert.match(spec.content, /docs\/specs\/features\/<TICKET-ID>\/proposal\.md/);
  const sec = rendered.find((r) => r.name === 'security-audit');
  assert.match(sec.content, /`apps\/api`/);
  const sentry = rendered.find((r) => r.name === 'sentry-investigator');
  assert.match(sentry.content, /arches-sq/);
  assert.match(sentry.content, /ekb-production/);
});

test('render: missing var without default fails with var name', () => {
  const cfg = { guardrails: {}, skills: { vars: {} } };
  const { errors } = skillsLib.renderAll(cfg, 'EKB');
  assert.ok(errors.some((e) => /security-audit.*beDir/.test(e)), JSON.stringify(errors));
});

test('render: defaults from meta.json apply when var unset', () => {
  const cfg = ekbConfig();
  delete cfg.skills.vars.orgName;
  const { rendered, errors } = skillsLib.renderAll(cfg, 'EKB');
  assert.deepStrictEqual(errors, []);
  const jira = rendered.find((r) => r.name === 'jira-ticket');
  assert.match(jira.content, /Arches workspace standard/);
});

test('cross-references intact after render', () => {
  const { rendered } = skillsLib.renderAll(ekbConfig(), 'EKB');
  const names = new Set(rendered.map((r) => r.name));
  const dr = rendered.find((r) => r.name === 'deep-review');
  assert.match(dr.content, /design-check|design-system/i);
  const apr = rendered.find((r) => r.name === 'attach-pr-recording');
  assert.match(apr.content, /`e2e-testing` skill/);
  assert.ok(names.has('e2e-testing'));
  const route = rendered.find((r) => r.name === 'route');
  for (const ref of ['spec-check', 'deep-review', 'security-audit', 'db-migration', 'jira-ticket', 'sentry-investigator']) {
    assert.ok(route.content.includes(ref), `route references ${ref}`);
    assert.ok(names.has(ref), `route target ${ref} exists`);
  }
});

test('sync: end-to-end create, idempotent, manifest written', () => {
  const repo = tmpRepo(ekbConfig());
  const first = runCli(['sync'], repo);
  assert.strictEqual(first.status, 0, first.stderr + first.stdout);
  assert.ok(fs.existsSync(path.join(repo, '.agents/skills/deep-review/SKILL.md')));
  assert.ok(fs.existsSync(path.join(repo, 'apps/web/.claude/skills/e2e-testing/SKILL.md')));
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.agentkit/skills.manifest.json'), 'utf8'));
  assert.ok(manifest.entries.length >= 12);
  const second = runCli(['sync', '--check'], repo);
  assert.strictEqual(second.status, 0, second.stdout);
  assert.match(second.stdout, /clean/);
});

test('sync: local edit detected as drift, sync and doctor fail', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['sync'], repo);
  const target = path.join(repo, '.agents/skills/deep-review/SKILL.md');
  fs.appendFileSync(target, '\nlocal hack\n');
  const check = runCli(['sync', '--check'], repo);
  assert.strictEqual(check.status, 1);
  assert.match(check.stdout + check.stderr, /drift/);
  const doctor = runCli(['doctor'], repo);
  assert.strictEqual(doctor.status, 1);
  assert.match(doctor.stdout, /locally edited/);
});

test('sync: exclusion after sync deletes the managed file', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['sync'], repo);
  const cfg = ekbConfig({ skills: { vars: EKB_VARS, exclude: ['pr-review'] } });
  fs.writeFileSync(path.join(repo, 'agentkit.config.json'), JSON.stringify(cfg));
  const out = runCli(['sync'], repo);
  assert.strictEqual(out.status, 0);
  assert.ok(!fs.existsSync(path.join(repo, '.agents/skills/pr-review/SKILL.md')));
});

test('sync: repo-owned skill untouched', () => {
  const repo = tmpRepo(ekbConfig());
  const own = path.join(repo, '.agents/skills/my-own-skill/SKILL.md');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, '# mine');
  runCli(['sync'], repo);
  assert.strictEqual(fs.readFileSync(own, 'utf8'), '# mine');
});

test('doctor: unsynced repo warns, synced repo passes', () => {
  const repo = tmpRepo(ekbConfig());
  const before = runCli(['doctor'], repo);
  assert.match(before.stdout, /never synced/);
  runCli(['sync'], repo);
  const after = runCli(['doctor'], repo);
  assert.strictEqual(after.status, 0, after.stdout);
  assert.match(after.stdout, /managed assets in sync/);
});

test('kinds: ekb pack resolves commands and agents alongside skills', () => {
  const assets = skillsLib.resolveAssets(ekbConfig(), 'EKB');
  const byKind = (k) => assets.filter((a) => a.kind === k).map((a) => a.name);
  for (const c of ['pr', 'ekb-up', 'verify-all']) assert.ok(byKind('command').includes(c), `command ${c}`);
  for (const a of ['advisor', 'conductor', 'fe-agent', 'be-agent']) assert.ok(byKind('agent').includes(a), `agent ${a}`);
  const pr = assets.find((a) => a.kind === 'command' && a.name === 'pr');
  assert.strictEqual(pr.installPath, '.claude/commands/pr.md');
  const advisor = assets.find((a) => a.kind === 'agent' && a.name === 'advisor');
  assert.strictEqual(advisor.tier, 'shared');
  assert.strictEqual(advisor.installPath, '.claude/agents/advisor.md');
});

test('kinds: advisor renders org vars, defaults apply without them', () => {
  const { rendered, errors } = skillsLib.renderAll(ekbConfig(), 'EKB');
  assert.deepStrictEqual(errors, []);
  const advisor = rendered.find((r) => r.kind === 'agent' && r.name === 'advisor');
  assert.match(advisor.content, /EKB decision advisor/);
  assert.match(advisor.content, /`AGENTS\.md` constraints/);
  const cfg = ekbConfig();
  delete cfg.skills.vars.orgName;
  const fallback = skillsLib.renderAll(cfg, 'EKB').rendered.find((r) => r.kind === 'agent' && r.name === 'advisor');
  assert.match(fallback.content, /Arches decision advisor/);
});

test('kinds: no pack -> advisor only, no commands', () => {
  const assets = skillsLib.resolveAssets({}, null);
  assert.strictEqual(assets.filter((a) => a.kind === 'command').length, 0);
  assert.deepStrictEqual(assets.filter((a) => a.kind === 'agent').map((a) => a.name), ['advisor']);
});

test('kinds: per-kind exclude, same name spaces independent', () => {
  const cfg = ekbConfig({ skills: { vars: EKB_VARS }, commands: { exclude: ['ekb-up'] }, agents: { exclude: ['conductor'] } });
  const assets = skillsLib.resolveAssets(cfg, 'EKB');
  assert.ok(!assets.some((a) => a.kind === 'command' && a.name === 'ekb-up'));
  assert.ok(!assets.some((a) => a.kind === 'agent' && a.name === 'conductor'));
  assert.ok(assets.some((a) => a.kind === 'skill' && a.name === 'route'));
});

test('kinds: sync installs commands and agents, manifest v2 carries kind', () => {
  const repo = tmpRepo(ekbConfig());
  const out = runCli(['sync'], repo);
  assert.strictEqual(out.status, 0, out.stderr + out.stdout);
  assert.ok(fs.existsSync(path.join(repo, '.claude/commands/pr.md')));
  assert.ok(fs.existsSync(path.join(repo, '.claude/agents/advisor.md')));
  assert.ok(fs.existsSync(path.join(repo, '.claude/agents/be-agent.md')));
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.agentkit/skills.manifest.json'), 'utf8'));
  assert.strictEqual(manifest.version, 2);
  assert.ok(manifest.entries.some((e) => e.kind === 'command' && e.name === 'pr'));
  assert.ok(manifest.entries.some((e) => e.kind === 'agent' && e.name === 'advisor'));
  const prBody = fs.readFileSync(path.join(repo, '.claude/commands/pr.md'), 'utf8');
  assert.match(prBody, /HARD STOP/);
});

test('kinds: v1 manifest reads compatibly — skills matched, new kinds created', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['sync'], repo);
  const mPath = path.join(repo, '.agentkit/skills.manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  const v1 = {
    version: 1,
    kitVersion: manifest.kitVersion,
    entries: manifest.entries.filter((e) => e.kind === 'skill').map(({ name, tier, target, hash }) => ({ name, tier, target, hash })),
  };
  fs.writeFileSync(mPath, JSON.stringify(v1, null, 2));
  fs.rmSync(path.join(repo, '.claude/commands'), { recursive: true });
  fs.rmSync(path.join(repo, '.claude/agents'), { recursive: true });
  const { rendered } = skillsLib.renderAll(ekbConfig(), 'EKB');
  const actions = skillsLib.planSync(repo, rendered, skillsLib.readManifest(repo));
  assert.ok(!actions.some((a) => a.kind === 'skill' && a.type !== 'unchanged'), JSON.stringify(actions.filter((a) => a.kind === 'skill' && a.type !== 'unchanged')));
  assert.ok(actions.some((a) => a.kind === 'command' && a.type === 'create'));
  assert.ok(actions.some((a) => a.kind === 'agent' && a.type === 'create'));
});

test('kinds: local edit to managed command is drift, doctor fails', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['sync'], repo);
  fs.appendFileSync(path.join(repo, '.claude/commands/pr.md'), '\nlocal hack\n');
  const doctor = runCli(['doctor'], repo);
  assert.strictEqual(doctor.status, 1);
  assert.match(doctor.stdout, /command "pr" locally edited/);
});

test('validate: unknown commands.exclude name fails doctor', () => {
  const repo = tmpRepo(ekbConfig({ commands: { exclude: ['no-such-command'] } }));
  const r = runCli(['doctor'], repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /no such command "no-such-command"/);
});

test('kinds: boolean false disables a whole kind (guardrails-only style)', () => {
  const cfg = ekbConfig({ skills: false, agents: false });
  const assets = skillsLib.resolveAssets(cfg, 'EKB');
  assert.strictEqual(assets.filter((a) => a.kind === 'skill').length, 0);
  assert.strictEqual(assets.filter((a) => a.kind === 'agent').length, 0);
  assert.ok(assets.filter((a) => a.kind === 'command').length >= 3, 'commands unaffected');
});

test('kinds: disabling a synced kind removes its files on next sync, doctor stays clean', () => {
  const repo = tmpRepo(ekbConfig());
  runCli(['sync'], repo);
  assert.ok(fs.existsSync(path.join(repo, '.agents/skills/deep-review/SKILL.md')));
  fs.writeFileSync(path.join(repo, 'agentkit.config.json'), JSON.stringify(ekbConfig({ skills: false })));
  const out = runCli(['sync'], repo);
  assert.strictEqual(out.status, 0, out.stderr + out.stdout);
  assert.ok(!fs.existsSync(path.join(repo, '.agents/skills/deep-review/SKILL.md')), 'managed skill removed');
  assert.ok(fs.existsSync(path.join(repo, '.claude/commands/pr.md')), 'commands kept');
  const doctor = runCli(['doctor'], repo);
  assert.strictEqual(doctor.status, 0, doctor.stdout);
});

test('validate: skills true rejected, false accepted', () => {
  const bad = tmpRepo(ekbConfig({ skills: true }));
  const r = runCli(['doctor'], bad);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /skills: must be an object or false/);
});

test('validate: vars under commands rejected', () => {
  const repo = tmpRepo(ekbConfig({ commands: { vars: { a: 'b' } } }));
  const r = runCli(['doctor'], repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /commands\.vars: unknown key/);
});

test('validate: unknown skills.exclude name fails doctor', () => {
  const repo = tmpRepo(ekbConfig({ skills: { vars: EKB_VARS, exclude: ['no-such-skill'] } }));
  const r = runCli(['doctor'], repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /no such skill "no-such-skill"/);
});

test('validate: non-string var fails doctor', () => {
  const cfg = ekbConfig();
  cfg.skills.vars = Object.assign({}, EKB_VARS, { feDir: 42 });
  const repo = tmpRepo(cfg);
  const r = runCli(['doctor'], repo);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /skills\.vars\.feDir: must be a string/);
});
