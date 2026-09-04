'use strict';

const APPROVAL_RE = /APPROVED:/i;

// Heredoc bodies are always data, never file arguments — strip them before
// scanning a command for path-shaped tokens. Handles <<EOF, <<'EOF', <<"EOF",
// <<-EOF; body ends at the first line that is exactly the delimiter
// (optionally tab-indented, matching <<-). Unterminated heredoc: strip to end.
function stripHeredocs(cmd) {
  const lines = String(cmd).split('\n');
  const out = [];
  let delimiter = null;
  for (const line of lines) {
    if (delimiter !== null) {
      if (line.replace(/^\t+/, '') === delimiter) delimiter = null;
      continue;
    }
    const m = line.match(/<<-?\s*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/);
    out.push(line);
    if (m) delimiter = m[1] || m[2] || m[3];
  }
  return out.join('\n');
}

function hasApproval(value) {
  return APPROVAL_RE.test(String(value));
}

function stripApproval(value) {
  return String(value).replace(/APPROVED:/ig, '');
}

function commandTargets(cmd) {
  const out = [];
  const re = /(?:^|\s)(APPROVED:)?((?:\.{0,2}\/)?[\w./@-]+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    if (/\//.test(m[2]) || /^\w+$/.test(m[2])) out.push((m[1] || '') + m[2]);
  }
  return out;
}

function sensitiveTokensInCommand(cmd) {
  const out = [];
  const re = /(?:^|\s)((?:APPROVED:)?[\w./@-]*(?:\.(?:env|pem|key|p12)[\w.]*|(?:credential|secret)[\w-]*\.[\w.]+))/gi;
  let m;
  while ((m = re.exec(cmd)) !== null) out.push(m[1]);
  return out;
}

module.exports = { hasApproval, stripApproval, stripHeredocs, commandTargets, sensitiveTokensInCommand };
