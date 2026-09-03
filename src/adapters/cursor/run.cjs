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

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalize(input) {
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
    hookEvent: null,
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

  const input = readStdin();
  const event = normalize(input);
  const repoRoot = findRepoRoot(event.cwd);
  const config = loadConfig(repoRoot);
  const state = stateDir(config, repoRoot);
  const log = createLog(state);

  const builtinNames = new Set(registry.list().map((g) => g.name));
  const pack = loadPack(packName(config)).guardrails.filter((g) => !builtinNames.has(g.name));
  const takenNames = new Set([...builtinNames, ...pack.map((g) => g.name)]);
  const locals = loadAll(config, repoRoot).guardrails.filter((g) => !takenNames.has(g.name));
  const candidates = registry.list().concat(pack, locals).filter(mapping.select);

  for (const guardrail of candidates) {
    if (!isEnabled(config, guardrail.name)) continue;
    const ctx = {
      repoRoot,
      options: optionsFor(config, guardrail.name),
      markers: createMarkers(state),
      log,
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
