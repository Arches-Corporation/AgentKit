'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUN = path.join(__dirname, '..', 'src', 'adapters', 'claude', 'run.cjs');
const CLI = path.join(__dirname, '..', 'bin', 'agentkit.cjs');

const LOCAL_GUARDRAIL = `'use strict';
function check(event) {
  if (event.command && /forbidden-word/.test(event.command)) {
    return { block: 'BLOCKED: forbidden-word is not allowed here.' };
  }
  return null;
}
module.exports = { name: 'no-forbidden', events: ['PreToolUse'], matcher: 'Bash', failClosed: false, defaults: {}, check };
`;

function tmpRepoWithLocal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-local-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, '.agentkit', 'guardrails'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agentkit', 'guardrails', 'no-forbidden.cjs'), LOCAL_GUARDRAIL);
  return dir;
}

function runHook(name, input, cwd) {
  return spawnSync('node', [RUN, name], { input: JSON.stringify(input), encoding: 'utf8', cwd });
}

test('local guardrail: blocks via adapter', () => {
  const repo = tmpRepoWithLocal();
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo forbidden-word' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /forbidden-word/);
});

test('local guardrail: allows benign command', () => {
  const repo = tmpRepoWithLocal();
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo hello' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('local guardrail: can be disabled via config', () => {
  const repo = tmpRepoWithLocal();
  fs.writeFileSync(
    path.join(repo, 'agentkit.config.json'),
    JSON.stringify({ guardrails: { 'no-forbidden': { enabled: false } } })
  );
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo forbidden-word' }, cwd: repo }, repo);
  assert.strictEqual(r.status, 0);
});

test('local guardrail: cannot shadow a built-in at runtime', () => {
  const repo = tmpRepoWithLocal();
  fs.writeFileSync(
    path.join(repo, '.agentkit', 'guardrails', 'hard-stop.cjs'),
    "module.exports = { name: 'hard-stop', events: ['PreToolUse'], matcher: 'Bash', check: () => null };"
  );
  const input = { tool_name: 'Bash', tool_input: { command: 'git ' + 'commit -m x' }, cwd: repo };
  const r = runHook('hard-stop', input, repo);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /HARD STOP/);
});

test('local guardrail: receives raw input on event', () => {
  const repo = tmpRepoWithLocal();
  fs.writeFileSync(
    path.join(repo, '.agentkit', 'guardrails', 'raw-echo.cjs'),
    "module.exports = { name: 'raw-echo', events: ['PreCompact'], matcher: null, check: (e) => e.raw && e.raw.trigger === 'manual' ? { block: 'raw-ok' } : null };"
  );
  const r = runHook('raw-echo', { hook_event_name: 'PreCompact', trigger: 'manual', cwd: repo }, repo);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /raw-ok/);
});

test('init wires local guardrails and doctor reports them', () => {
  const repo = tmpRepoWithLocal();
  const init = spawnSync('node', [CLI, 'init', '--tool', 'claude'], { encoding: 'utf8', cwd: repo });
  assert.match(init.stdout, /\+ 1 local/);
  const settings = fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8');
  assert.match(settings, /no-forbidden/);
  const doctor = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo });
  assert.match(doctor.stdout, /ok {3}local guardrail no-forbidden/);
});

test('doctor fails on broken local guardrail', () => {
  const repo = tmpRepoWithLocal();
  fs.writeFileSync(path.join(repo, '.agentkit', 'guardrails', 'broken.cjs'), 'syntax error {{{');
  const doctor = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo });
  assert.strictEqual(doctor.status, 1);
  assert.match(doctor.stdout, /FAIL local guardrail broken/);
});
