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
    try { fs.unlinkSync(p); } catch { /* one-shot best-effort */ }
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
