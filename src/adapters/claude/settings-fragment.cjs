'use strict';

const registry = require('../../core/registry.cjs');

const RUNNER = 'node "$CLAUDE_PROJECT_DIR/node_modules/@arches/agentkit/src/adapters/claude/run.cjs"';

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
      // Per-event override (g.matchers[event]) beats the single g.matcher —
      // lets one guardrail listen narrowly on PostToolUse but broadly on
      // SessionStart.
      const perEvent = g.matchers && Object.prototype.hasOwnProperty.call(g.matchers, event)
        ? g.matchers[event]
        : g.matcher;
      const key = perEvent || '';
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
