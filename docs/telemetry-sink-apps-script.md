# Telemetry sink: Google Apps Script receiver

Free, zero-infra endpoint for `usage-telemetry`'s `endpoint` sink mode — a Google Apps Script web app that appends each daily export to a Google Sheet. Runs entirely inside the org's Workspace; no new vendor, no server.

Access control = the deployment URL itself (long random ID, treat it like a shared link) + HTTPS. No credentials live in the script (per org security rules) and the payload is metadata-only — names and counts, never prompt or code content (see [telemetry.md](telemetry.md)).

## 1. Create the sheet + script

1. New Google Sheet, e.g. `AgentKit usage`. Rename the first tab to `rows`.
2. Extensions → Apps Script, replace the contents with:

```javascript
const SHEET_NAME = 'rows';
const HEADER = ['received_at', 'date', 'user', 'repo', 'sessions', 'skills', 'agents', 'commands', 'prompts', 'top_names', 'guardrail_blocks_day'];

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'invalid JSON' });
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADER);

  const receivedAt = new Date().toISOString();
  const guardrailsByDay = payload.guardrailsByDay || {};
  const rows = ((payload.usage && payload.usage.rows) || []).map(function (r) {
    const topNames = Object.keys(r.names || {})
      .sort(function (a, b) { return r.names[b] - r.names[a]; })
      .slice(0, 5)
      .map(function (n) { return n + ' x' + r.names[n]; })
      .join('; ');
    const blocks = (guardrailsByDay[r.date] && guardrailsByDay[r.date].block) || 0;
    return [receivedAt, r.date, r.user, r.repo, r.sessions, r.skills, r.agents, r.commands, r.prompts || 0, topNames, blocks];
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
  }
  return reply({ ok: true, appended: rows.length });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
```

3. Deploy → New deployment → type **Web app** → Execute as **Me**, access **Anyone with the link** → Deploy. Copy the `https://script.google.com/macros/s/…/exec` URL.

Note: exports are cumulative rollups (the kit re-sends all days it still holds), so the sheet accumulates duplicate `(date, user, repo)` rows across days — dedupe in the summary view: `=SORT(UNIQUE(rows!B2:K))`, or pivot on date+user taking MAX of the counters.

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
