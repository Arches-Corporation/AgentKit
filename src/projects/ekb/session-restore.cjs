'use strict';

const fs = require('fs');

function check(event, ctx) {
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(ctx.markers.markerPath('session-latest.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!snap || typeof snap !== 'object') return null;
  const bits = [];
  if (snap.branch) bits.push(`branch ${snap.branch}`);
  if (snap.ticket) bits.push(`ticket ${snap.ticket}`);
  if (!bits.length) return null;
  return {
    inject: `Resuming EKB session — ${bits.join(', ')} (snapshot ${snap.ts}). Continue that work unless the user redirects.`,
  };
}

module.exports = {
  name: 'session-restore',
  events: ['SessionStart'],
  matcher: null,
  failClosed: false,
  defaults: {},
  check,
};
