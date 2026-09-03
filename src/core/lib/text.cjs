'use strict';

const APPROVAL_RE = /APPROVED:/i;

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

module.exports = { hasApproval, stripApproval, commandTargets, sensitiveTokensInCommand };
