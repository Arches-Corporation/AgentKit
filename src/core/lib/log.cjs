'use strict';

const fs = require('fs');
const path = require('path');

const LOG_MAX_BYTES = 512 * 1024;

function createLog(stateDirPath) {
  const logPath = path.join(stateDirPath, 'guardrail-log.jsonl');

  return function log(entry) {
    try {
      fs.mkdirSync(stateDirPath, { recursive: true });
      try {
        const st = fs.statSync(logPath);
        if (st.size > LOG_MAX_BYTES) fs.truncateSync(logPath, 0);
      } catch { /* no log yet */ }
      const line = JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n';
      fs.appendFileSync(logPath, line);
    } catch { /* logging must never break a guardrail */ }
  };
}

module.exports = { createLog };
