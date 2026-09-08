#!/usr/bin/env node
'use strict';

const fs = require('fs');
const registry = require('../../core/registry.cjs');
const { findRepoRoot, loadConfig, isEnabled, optionsFor, stateDir } = require('../../core/lib/config.cjs');
const { loadAll } = require('../../core/lib/local.cjs');
const { packName, loadPack } = require('../../core/lib/projects.cjs');
const { createMarkers } = require('../../core/lib/markers.cjs');
const { createLog } = require('../../core/lib/log.cjs');

const EVENT_MAP = {
  beforeShellExecution: { select: (g) => g.matcher && /Bash/.test(g.matcher), reply: 'permission' },
  beforeMCPExecution: { select: (g) => g.matcher && /Bash/.test(g.matcher), reply: 'permission' },
  beforeReadFile: { select: (g) => g.matcher && /Read/.test(g.matcher), reply: 'permission' },
  beforeSubmitPrompt: { select: (g) => g.events.includes('UserPromptSubmit'), reply: 'continue' },
};

// Empty stdin = manual invocation (no-op event); malformed stdin = tampered or
// truncated event — fail-closed guardrails must deny, not run against {}.
function readStdin() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return { input: {}, malformed: false };
  }
  if (!raw.trim()) return { input: {}, malformed: false };
  try {
    return { input: JSON.parse(raw), malformed: false };
  } catch {
    return { input: {}, malformed: true };
  }
}

// Cursor event names → the kit's canonical hookEvent vocabulary, so guardrails
// that branch on event.hookEvent behave the same under both adapters.
const HOOK_EVENT_MAP = { beforeSubmitPrompt: 'UserPromptSubmit' };

function normalize(input, eventName) {
  const paths = [];
  for (const key of ['file_path', 'path']) {
    if (typeof input[key] === 'string' && input[key]) paths.push(input[key]);
  }
  const cwd = typeof input.cwd === 'string'
    ? input.cwd
    : (Array.isArray(input.workspace_roots) && typeof input.workspace_roots[0] === 'string'
      ? input.workspace_roots[0]
      : process.cwd());
  return {
    hookEvent: HOOK_EVENT_MAP[eventName] || null,
    toolName: null,
    command: typeof input.command === 'string' ? input.command : '',
    paths,
    prompt: typeof input.prompt === 'string' ? input.prompt : (typeof input.text === 'string' ? input.text : ''),
    cwd,
    sessionId: typeof input.conversation_id === 'string' ? input.conversation_id : null,
    raw: input,
  };
}

function respond(kind, blockReason) {
  if (kind === 'continue') {
    process.stdout.write(JSON.stringify(
      blockReason ? { continue: false, userMessage: blockReason, agentMessage: blockReason } : { continue: true }
    ));
  } else {
    process.stdout.write(JSON.stringify(
      blockReason ? { permission: 'deny', userMessage: blockReason, agentMessage: blockReason } : { permission: 'allow' }
    ));
  }
  process.exit(0);
}

function main() {
  const eventName = process.argv[2];
  const mapping = EVENT_MAP[eventName];
  if (!mapping) {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    process.exit(0);
  }

  const { input, malformed } = readStdin();
  const event = normalize(input, eventName);
  const repoRoot = findRepoRoot(event.cwd);
  const config = loadConfig(repoRoot);
  const state = stateDir(config, repoRoot);
  const log = createLog(state);

  const builtinNames = new Set(registry.list().map((g) => g.name));
  const pack = loadPack(packName(config)).guardrails.filter((g) => !builtinNames.has(g.name));
  const takenNames = new Set([...builtinNames, ...pack.map((g) => g.name)]);
  const locals = loadAll(config, repoRoot).guardrails.filter((g) => !takenNames.has(g.name));
  const candidates = registry.list().concat(pack, locals).filter(mapping.select);

  if (malformed && candidates.some((g) => g.failClosed)) {
    respond(mapping.reply, 'agentkit: hook event on stdin is not valid JSON — blocking (fail-closed)');
  }

  for (const guardrail of candidates) {
    if (!guardrail.alwaysOn && !isEnabled(config, guardrail.name)) continue;
    const ctx = {
      repoRoot,
      options: optionsFor(config, guardrail.name),
      markers: createMarkers(state),
      log,
      stateDirPath: state,
      adapter: 'cursor',
    };
    let result = null;
    try {
      result = guardrail.check(event, ctx);
    } catch (err) {
      log({ guardrail: guardrail.name, adapter: 'cursor', decision: 'error', reason: String((err && err.message) || err) });
      if (guardrail.failClosed) {
        respond(mapping.reply, `[${guardrail.name}] internal error — blocking (fail-closed).`);
      }
      continue;
    }
    if (result && result.block) {
      log({ guardrail: guardrail.name, adapter: 'cursor', decision: 'block', reason: result.block });
      respond(mapping.reply, result.block);
    }
  }

  respond(mapping.reply, null);
}

main();
