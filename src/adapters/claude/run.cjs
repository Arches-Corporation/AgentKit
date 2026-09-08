#!/usr/bin/env node
'use strict';

const fs = require('fs');
const registry = require('../../core/registry.cjs');
const { findRepoRoot, loadConfig, isEnabled, optionsFor, stateDir } = require('../../core/lib/config.cjs');
const { loadByName } = require('../../core/lib/local.cjs');
const { packName, getFromPack } = require('../../core/lib/projects.cjs');
const { createMarkers } = require('../../core/lib/markers.cjs');
const { createLog } = require('../../core/lib/log.cjs');

// Empty stdin = manual invocation, treated as a no-op event. MALFORMED stdin
// is different: Claude Code always sends valid JSON, so garbage means the
// event was tampered with or truncated — a fail-closed guardrail must block
// rather than run against an empty event (which would silently allow).
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

function normalize(input) {
  const ti = (input && input.tool_input) || {};
  const paths = [];
  for (const key of ['file_path', 'path', 'notebook_path']) {
    if (typeof ti[key] === 'string' && ti[key]) paths.push(ti[key]);
  }
  const prompt = typeof input.prompt === 'string'
    ? input.prompt
    : (typeof ti.prompt === 'string' ? ti.prompt : '');
  return {
    hookEvent: typeof input.hook_event_name === 'string' ? input.hook_event_name : null,
    toolName: typeof input.tool_name === 'string' ? input.tool_name : null,
    command: typeof ti.command === 'string' ? ti.command : '',
    paths,
    prompt,
    cwd: typeof input.cwd === 'string' ? input.cwd : process.cwd(),
    sessionId: typeof input.session_id === 'string' ? input.session_id : null,
    raw: input,
  };
}

function main() {
  const name = process.argv[2];
  const { input, malformed } = readStdin();
  const event = normalize(input);
  const repoRoot = findRepoRoot(event.cwd);
  const config = loadConfig(repoRoot);

  const guardrail = (name && registry.get(name))
    || (name && getFromPack(packName(config), name))
    || (name && loadByName(config, repoRoot, name));
  if (!guardrail) {
    process.stderr.write(`agentkit: unknown guardrail "${name || ''}"\n`);
    process.exit(1);
  }

  if (malformed && guardrail.failClosed) {
    process.stderr.write(`[${guardrail.name}] hook event on stdin is not valid JSON — blocking (fail-closed)\n`);
    process.exit(2);
  }

  if (!guardrail.alwaysOn && !isEnabled(config, guardrail.name)) process.exit(0);

  const state = stateDir(config, repoRoot);
  const log = createLog(state);
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
    log({ guardrail: guardrail.name, decision: 'error', reason: String((err && err.message) || err) });
    if (guardrail.failClosed) {
      process.stderr.write(`[${guardrail.name}] internal error — blocking (fail-closed): ${err && err.message}\n`);
      process.exit(2);
    }
    process.exit(0);
  }

  if (result && result.block) {
    log({ guardrail: guardrail.name, decision: 'block', reason: result.block });
    process.stderr.write(result.block.endsWith('\n') ? result.block : result.block + '\n');
    process.exit(2);
  }

  if (result && result.inject) {
    log({ guardrail: guardrail.name, decision: 'inject' });
    // Claude Code's hook contract wants hookEventName echoed back inside
    // hookSpecificOutput for the additionalContext to be attributed.
    const hookSpecificOutput = { additionalContext: result.inject };
    if (event.hookEvent) hookSpecificOutput.hookEventName = event.hookEvent;
    process.stdout.write(JSON.stringify({ hookSpecificOutput }));
    process.exit(0);
  }

  process.exit(0);
}

main();
