'use strict';

const registry = require('../../core/registry.cjs');

const RUNNER = 'node "$CLAUDE_PROJECT_DIR/node_modules/@arches-corporation/agentkit/src/adapters/claude/run.cjs"';

function hooksFragment(extraGuardrails = []) {
  const byEvent = {};
  for (const g of registry.list().concat(extraGuardrails)) {
    for (const event of g.events) {
      byEvent[event] = byEvent[event] || [];
      byEvent[event].push(g);
    }
  }

  const fragment = {};
  for (const [event, guardrails] of Object.entries(byEvent)) {
    const byMatcher = {};
    for (const g of guardrails) {
      const key = g.matcher || '';
      byMatcher[key] = byMatcher[key] || [];
      byMatcher[key].push({ type: 'command', command: `${RUNNER} ${g.name}` });
    }
    fragment[event] = Object.entries(byMatcher).map(([matcher, hooks]) =>
      matcher ? { matcher, hooks } : { hooks }
    );
  }
  return fragment;
}

module.exports = { hooksFragment };
