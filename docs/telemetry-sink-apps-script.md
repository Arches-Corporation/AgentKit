# Telemetry sink: Google Apps Script receiver

Free, zero-infra endpoint for `usage-telemetry`'s `endpoint` sink mode — a Google Apps Script web app that appends each daily export to a Google Sheet. Runs entirely inside the org's Workspace; no new vendor, no server.

Access control = the deployment URL itself (long random ID, treat it like a shared link) + HTTPS. No credentials live in the script (per org security rules) and the payload is metadata-only — names and counts, never prompt or code content (see [telemetry.md](telemetry.md)).

## 1. Create the sheet + script

1. New Google Sheet, e.g. `AgentKit usage`. Rename the first tab to `rows`.
2. Extensions → Apps Script, replace the contents with:

```javascript
const SHEET_NAME = 'rows';
const HEADER = ['received_at', 'date', 'user', 'repo', 'sessions', 'skills', 'agents', 'commands', 'prompts', 'top_names', 'guardrail_blocks_day', 'guardrail_names'];
const TOKENS_SHEET = 'tokens';
const TOKENS_HEADER = ['received_at', 'date', 'user', 'repo', 'model', 'input', 'output', 'cache_read', 'cache_write', 'messages'];

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'invalid JSON' });
  }

  // Serialize concurrent writes: if many engineers' exports land at once, the
  // lock makes each append atomic so no two writes target the same row. A
  // caller that can't get the lock in 30s gets a 'busy' reply and its client
  // retries with backoff (and, failing that, next day) — never a lost/clobbered row.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return reply({ ok: false, error: 'busy' });
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const receivedAt = new Date().toISOString();

    const sheet = getSheet(ss, SHEET_NAME, HEADER);
    const guardrailsByDay = payload.guardrailsByDay || {};
    const rows = ((payload.usage && payload.usage.rows) || []).map(function (r) {
      const topNames = Object.keys(r.names || {})
        .sort(function (a, b) { return r.names[b] - r.names[a]; })
        .slice(0, 5)
        .map(function (n) { return n + ' x' + r.names[n]; })
        .join('; ');
      const day = guardrailsByDay[r.date] || {};
      const blocks = day.block || 0;
      // which guardrail fired, e.g. "hard-stop block:2; scout-block block:1"
      const gnames = Object.keys(day.guardrails || {}).map(function (n) {
        const dec = day.guardrails[n];
        return n + ' ' + Object.keys(dec).map(function (k) { return k + ':' + dec[k]; }).join('/');
      }).join('; ');
      return [receivedAt, r.date, r.user, r.repo, r.sessions, r.skills, r.agents, r.commands, r.prompts || 0, topNames, blocks, gnames];
    });
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);

    // Token totals (from local Claude Code transcripts — usage numbers only)
    const tokenRows = ((payload.tokens && payload.tokens.rows) || []).map(function (t) {
      return [receivedAt, t.date, payload.user || '', payload.repo || '', t.model, t.input, t.output, t.cacheRead, t.cacheWrite, t.messages];
    });
    if (tokenRows.length) {
      const ts = getSheet(ss, TOKENS_SHEET, TOKENS_HEADER);
      ts.getRange(ts.getLastRow() + 1, 1, tokenRows.length, TOKENS_HEADER.length).setValues(tokenRows);
    }

    return reply({ ok: true, appended: rows.length, tokens: tokenRows.length });
  } finally {
    lock.releaseLock();
  }
}

function getSheet(ss, name, header) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(header);
  return sheet;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
```

3. Deploy → New deployment → type **Web app** → Execute as **Me**, access **Anyone with the link** → Deploy. Copy the `https://script.google.com/macros/s/…/exec` URL.

Note: exports are cumulative rollups (the kit re-sends all days it still holds), so the sheet accumulates duplicate `(date, user, repo)` rows across days — dedupe in the summary view: `=SORT(UNIQUE(rows!B2:L))` (activity) / `=SORT(UNIQUE(tokens!B2:J))` (tokens), or pivot on date+user taking MAX of the counters. The `tokens` tab is created on the first export that carries token data.

### Rate limits & concurrency (why this is safe for the whole team)

- **Volume is a non-issue.** The kit debounces to at most **one POST per engineer per repo per 24 h** (see [telemetry.md](telemetry.md)). At 15–50 engineers that's ~30–100 requests/day against an Apps Script quota of ~20,000/day — well under 1%.
- **Simultaneous writes are serialized.** `doPost` takes a `LockService` script lock, so if several exports arrive in the same second each append is atomic — two writes can never target the same row. A caller that can't get the lock within 30 s gets `{"ok":false,"error":"busy"}`.
- **The client retries.** The kit's endpoint export retries on `429`/`5xx` **and** on a `200 {ok:false, busy}` body, with exponential backoff **plus random jitter** — so a burst of engineers starting at 9 am spreads out instead of retrying in lockstep. If all retries fail, the export is fail-open and simply re-sends the cumulative rollup on the next day's session. No row is ever lost or clobbered.

## 2. Point the kit at it

In each consuming repo's `agentkit.config.json`:

```json
"usage-telemetry": {
  "enabled": true,
  "sinkMode": "endpoint",
  "sinkUrl": "https://script.google.com/macros/s/DEPLOYMENT_ID/exec"
}
```

Leave `sinkAuthTokenEnv` empty — Apps Script cannot read HTTP headers, and the metadata-only payload doesn't warrant a second factor beyond the unguessable URL. Rotating the "secret" = create a new deployment, update the config.

First session start of each day then POSTs the rollup automatically (detached, fail-open — an unreachable script never blocks a session). Manual test: `npx agentkit report --export`.

## 3. Reading it

- Sheet tab `rows` = raw feed (one row per user/repo/day per export).
- Add a summary tab with the dedupe formula above for weekly adoption review: active users, sessions/dev, skill mix, guardrail blocks.
- Missing rows mean "no data that day" (laptop off, kit not installed) — not "zero usage". Read absence as a coverage gap before reading it as non-adoption.
