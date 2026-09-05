'use strict';

const fs = require('fs');
const path = require('path');

const CLAUDE_RUNNER_FRAGMENT = '@arches/agentkit/src/adapters/claude/run.cjs';
const CURSOR_RUNNER_FRAGMENT = '@arches/agentkit/src/adapters/cursor/run.cjs';

function pruneEmptyDirs(root, target) {
  let dir = path.dirname(path.join(root, target));
  const rootAbs = path.resolve(root);
  while (dir.startsWith(rootAbs) && dir !== rootAbs) {
    try {
      if (fs.readdirSync(dir).length) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

function removeAssets(root, manifest) {
  const removed = [];
  for (const e of (manifest && manifest.entries) || []) {
    if (!e || typeof e.target !== 'string') continue;
    try {
      fs.rmSync(path.join(root, e.target));
      removed.push(e.target);
    } catch { /* already gone */ }
    pruneEmptyDirs(root, e.target);
  }
  return removed;
}

function unwireHooks(settings, runnerFragment) {
  if (!settings || typeof settings !== 'object' || !settings.hooks || typeof settings.hooks !== 'object') {
    return { settings, removed: 0 };
  }
  let removed = 0;
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = [];
    for (const entry of entries) {
      if (entry && Array.isArray(entry.hooks)) {
        const keptHooks = entry.hooks.filter((h) => {
          const isKit = h && typeof h.command === 'string' && h.command.includes(runnerFragment);
          if (isKit) removed += 1;
          return !isKit;
        });
        if (keptHooks.length) kept.push(Object.assign({}, entry, { hooks: keptHooks }));
      } else if (entry && typeof entry.command === 'string' && entry.command.includes(runnerFragment)) {
        removed += 1;
      } else {
        kept.push(entry);
      }
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return { settings, removed };
}

function unwireClaude(settings) {
  return unwireHooks(settings, CLAUDE_RUNNER_FRAGMENT);
}

function unwireCursor(cfg) {
  return unwireHooks(cfg, CURSOR_RUNNER_FRAGMENT);
}

module.exports = { removeAssets, unwireClaude, unwireCursor, pruneEmptyDirs };
