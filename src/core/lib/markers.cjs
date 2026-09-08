'use strict';

const fs = require('fs');
const path = require('path');

function createMarkers(stateDirPath) {
  function markerPath(name) {
    return path.join(stateDirPath, name);
  }

  function exists(name) {
    return fs.existsSync(markerPath(name));
  }

  function consume(name) {
    const p = markerPath(name);
    if (!fs.existsSync(p)) return false;
    // One-shot means DELETED-then-approved. If the delete fails (permissions
    // games on the state dir), the marker would become a permanent approval —
    // fail closed instead.
    try {
      fs.unlinkSync(p);
    } catch (err) {
      process.stderr.write(`agentkit: approval marker "${name}" exists but could not be consumed (${err && err.message}) — treating as NOT approved\n`);
      return false;
    }
    return true;
  }

  function place(name) {
    try {
      fs.mkdirSync(stateDirPath, { recursive: true });
      fs.writeFileSync(markerPath(name), '');
      return true;
    } catch {
      return false;
    }
  }

  return { markerPath, exists, consume, place };
}

module.exports = { createMarkers };
