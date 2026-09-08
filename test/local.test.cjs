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

// Local guardrails only run once explicitly trusted (`agentkit trust`).
// Tests use an isolated trust store via AGENTKIT_TRUST_DIR.
function trustEnv(repo) {
  const trustDir = path.join(repo, '.trust-store');
  return Object.assign({}, process.env, { AGENTKIT_TRUST_DIR: trustDir });
}

function trust(repo, env) {
  return spawnSync('node', [CLI, 'trust'], { encoding: 'utf8', cwd: repo, env });
}

function runHook(name, input, cwd, env) {
  return spawnSync('node', [RUN, name], { input: JSON.stringify(input), encoding: 'utf8', cwd, env });
}

test('local guardrail: untrusted is not loaded (adapter reports unknown)', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo forbidden-word' }, cwd: repo }, repo, env);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /unknown guardrail/);
});

test('local guardrail: blocks via adapter once trusted', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  const t = trust(repo, env);
  assert.match(t.stdout, /trusted 1 local guardrail/);
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo forbidden-word' }, cwd: repo }, repo, env);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /forbidden-word/);
});

test('local guardrail: edit after trust invalidates it', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  trust(repo, env);
  fs.appendFileSync(path.join(repo, '.agentkit', 'guardrails', 'no-forbidden.cjs'), '\n// edited\n');
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo forbidden-word' }, cwd: repo }, repo, env);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /unknown guardrail/);
});

test('local guardrail: allows benign command', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  trust(repo, env);
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo hello' }, cwd: repo }, repo, env);
  assert.strictEqual(r.status, 0);
});

test('local guardrail: can be disabled via config', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  trust(repo, env);
  fs.writeFileSync(
    path.join(repo, 'agentkit.config.json'),
    JSON.stringify({ guardrails: { 'no-forbidden': { enabled: false } } })
  );
  const r = runHook('no-forbidden', { tool_name: 'Bash', tool_input: { command: 'echo forbidden-word' }, cwd: repo }, repo, env);
  assert.strictEqual(r.status, 0);
});

test('local guardrail: cannot shadow a built-in at runtime', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  fs.writeFileSync(
    path.join(repo, '.agentkit', 'guardrails', 'hard-stop.cjs'),
    "module.exports = { name: 'hard-stop', events: ['PreToolUse'], matcher: 'Bash', check: () => null };"
  );
  trust(repo, env);
  const input = { tool_name: 'Bash', tool_input: { command: 'git ' + 'commit -m x' }, cwd: repo };
  const r = runHook('hard-stop', input, repo, env);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /HARD STOP/);
});

test('local guardrail: receives raw input on event', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  fs.writeFileSync(
    path.join(repo, '.agentkit', 'guardrails', 'raw-echo.cjs'),
    "module.exports = { name: 'raw-echo', events: ['PreCompact'], matcher: null, check: (e) => e.raw && e.raw.trigger === 'manual' ? { block: 'raw-ok' } : null };"
  );
  trust(repo, env);
  const r = runHook('raw-echo', { hook_event_name: 'PreCompact', trigger: 'manual', cwd: repo }, repo, env);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /raw-ok/);
});

test('init warns on untrusted local guardrail, wires it after trust', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  const first = spawnSync('node', [CLI, 'init', '--tool', 'claude'], { encoding: 'utf8', cwd: repo, env });
  assert.match(first.stdout, /untrusted — not wired/);
  trust(repo, env);
  const init = spawnSync('node', [CLI, 'init', '--tool', 'claude'], { encoding: 'utf8', cwd: repo, env });
  assert.match(init.stdout, /\+ 1 local/);
  const settings = fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8');
  assert.match(settings, /no-forbidden/);
  const doctor = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo, env });
  assert.match(doctor.stdout, /ok {3}local guardrail no-forbidden/);
});

test('doctor fails on broken local guardrail (trusted)', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  fs.writeFileSync(path.join(repo, '.agentkit', 'guardrails', 'broken.cjs'), 'syntax error {{{');
  trust(repo, env);
  const doctor = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo, env });
  assert.strictEqual(doctor.status, 1);
  assert.match(doctor.stdout, /FAIL local guardrail broken/);
});

test('doctor warns (not executes) on untrusted local guardrail', () => {
  const repo = tmpRepoWithLocal();
  const env = trustEnv(repo);
  const sentinel = path.join(repo, 'pwned.txt');
  fs.writeFileSync(
    path.join(repo, '.agentkit', 'guardrails', 'evil.cjs'),
    `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'x');\n` +
    "module.exports = { name: 'evil', events: ['PreToolUse'], matcher: 'Bash', check: () => null };"
  );
  const doctor = spawnSync('node', [CLI, 'doctor'], { encoding: 'utf8', cwd: repo, env });
  assert.match(doctor.stdout, /untrusted — not loaded/);
  assert.strictEqual(fs.existsSync(sentinel), false);
});
