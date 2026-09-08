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

// Words that hand execution to their arguments — `command git commit`,
// `env git push`, `sh -c "git push"`, `xargs git push` all end up running git.
// A first token in this set means the REAL command may be further along.
const EXEC_WRAPPERS = new Set([
  'command', 'builtin', 'exec', 'eval', 'env', 'nohup', 'nice', 'time',
  'timeout', 'xargs', 'sudo', 'doas', 'setsid', 'stdbuf', 'script', 'watch',
  'sh', 'bash', 'zsh', 'dash', 'ksh',
]);

// Strip the shell-quoting/substitution noise that hides a command word:
// `\git` (alias bypass), `$(git`, `` `git ``, and stray quotes from segments
// split mid-string.
function bareToken(t) {
  return String(t).replace(/^[\\$(`'"]+/, '').replace(/[)`'"]+$/, '');
}

// Which git subcommand does this shell segment run, if any? Wrapper-aware:
// finds `git` as the leading word, behind an exec wrapper chain, or inside a
// command substitution — a plain mention in prose (`echo "git commit"`) does
// NOT count unless an exec-capable word leads the segment.
function gitSubcommand(segment) {
  const lead = String(segment).replace(/^(?:\w+=(?:"(?:\\.|[^"\\])*"|'[^']*'|\S+)\s+)+/, '');
  const tokens = lead
    .replace(/"((?:\\.|[^"\\])*)"/g, '$1')
    .replace(/'([^']*)'/g, '$1')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return null;

  let gitIndex = -1;
  if (bareToken(tokens[0]) === 'git') {
    gitIndex = 0;
  } else if (EXEC_WRAPPERS.has(bareToken(tokens[0]))) {
    for (let i = 1; i < tokens.length; i++) {
      if (bareToken(tokens[i]) === 'git') { gitIndex = i; break; }
    }
  } else {
    for (let i = 0; i < tokens.length; i++) {
      if (/^[\\$(`]/.test(tokens[i]) && bareToken(tokens[i]) === 'git') { gitIndex = i; break; }
    }
  }
  if (gitIndex === -1) return null;

  for (let i = gitIndex + 1; i < tokens.length; i++) {
    const t = bareToken(tokens[i]);
    if (t === '-C' || t === '-c') { i += 1; continue; }
    if (t.startsWith('-')) continue;
    return t;
  }
  return null;
}

function gitSegments(cmd, subcommands) {
  const wanted = new Set(subcommands);
  return String(cmd)
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter((s) => wanted.has(gitSubcommand(s)));
}

module.exports = {
  hasApproval, stripApproval, stripHeredocs, commandTargets, sensitiveTokensInCommand,
  gitSubcommand, gitSegments,
};
