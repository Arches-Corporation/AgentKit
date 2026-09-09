'use strict';

// Shared HTTP POST-with-retry for telemetry sinks (endpoint + otel). Kept
// dependency-free: raw http/https. Retry uses exponential backoff + random
// jitter so many engineers whose exports fire in the same window (e.g. 9am)
// spread out instead of retrying in lockstep. The whole export is detached, so
// no session ever waits on it.
const ENDPOINT_MAX_ATTEMPTS = 3;
const ENDPOINT_BASE_BACKOFF_MS = 500;

function isRetryableStatus(code) {
  return code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
}

function postOnce(parsed, headers, body, done) {
  const transport = parsed.protocol === 'https:' ? require('https') : require('http');
  const req = transport.request(parsed, { method: 'POST', headers, timeout: 5000 }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { if (buf.length < 4096) buf += chunk; });
    res.on('end', () => {
      const code = res.statusCode || 0;
      // The Apps Script lock returns HTTP 200 with {"ok":false,"error":"busy"}
      // when it can't serialize the write — treat that as retryable, not success.
      if (/"ok"\s*:\s*false/.test(buf) && /busy/.test(buf)) {
        done(Object.assign(new Error('endpoint busy (lock contention)'), { retryable: true }));
        return;
      }
      // 3xx counts as delivered: Apps Script web apps run the handler, then
      // answer POST with a 302 to the result page.
      if (code >= 200 && code < 400) done(null, `${code}`);
      else done(Object.assign(new Error(`endpoint responded ${code}`), { statusCode: code }));
    });
  });
  req.on('timeout', () => req.destroy(Object.assign(new Error('endpoint timeout after 5s'), { retryable: true })));
  req.on('error', (err) => done(err));
  req.write(body);
  req.end();
}

function postWithRetry(parsed, headers, body, done) {
  const attempt = (n) => {
    postOnce(parsed, headers, body, (err, status) => {
      if (!err) return done(null, status);
      const retryable = err.retryable || isRetryableStatus(err.statusCode);
      if (!retryable || n >= ENDPOINT_MAX_ATTEMPTS) return done(err);
      const backoff = ENDPOINT_BASE_BACKOFF_MS * Math.pow(2, n - 1);
      const jitter = Math.floor(Math.random() * ENDPOINT_BASE_BACKOFF_MS);
      setTimeout(() => attempt(n + 1), backoff + jitter);
    });
  };
  attempt(1);
}

module.exports = { ENDPOINT_MAX_ATTEMPTS, ENDPOINT_BASE_BACKOFF_MS, isRetryableStatus, postOnce, postWithRetry };
