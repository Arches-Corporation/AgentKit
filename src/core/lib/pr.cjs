'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Shared helpers for guardrails that hook `gh pr create` and reason about the
// ticket's spec. Kept separate so pack pr-body-contract and the shared
// spec-conformance guardrail agree on parsing.

function isPrCreate(cmd) {
  return !!cmd && /\bgh\s+pr\s+create\b/.test(cmd);
}

// The dir the command actually runs in, following any `cd` in the segment.
function effectiveDir(cmd, cwd) {
  let dir = cwd || process.cwd();
  const re = /(?:^|&&|;|\|\|)\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const target = (m[1] || m[2] || m[3]).replace(/^~(?=\/|$)/, process.env.HOME || '~');
    dir = path.isAbsolute(target) ? target : path.resolve(dir, target);
  }
  return dir;
}

// The PR body text, from --body-file/-F or inline --body.
function resolveBody(cmd, cwd) {
  const fileMatch = cmd.match(/(?:--body-file|-F)[=\s]+(['"]?)([^'"\s]+)\1/);
  if (fileMatch) {
    const p = fileMatch[2];
    const abs = path.isAbsolute(p) ? p : path.join(cwd || process.cwd(), p);
    try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  }
  const inline = cmd.match(/--body[=\s]+(['"])([\s\S]*?)\1/);
  if (inline) return inline[2];
  return null;
}

function currentBranch(repoRoot) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function ticketFromBranch(branch, ticketPattern) {
  const m = String(branch).match(new RegExp(`\\b${ticketPattern}\\b`, 'i'));
  return m ? m[0].toUpperCase() : null;
}

// Parse checklist ACs from a spec's "Acceptance Criteria" section. Returns
// [{ text, checked }] — `- [ ] foo` / `- [x] foo` lines until the next heading.
// An AC may carry an executable test ref: `- [ ] foo {test: e2e/x.spec.ts:foo}`.
// Tier 3 (`spec-verify`) runs it; Tiers 1/2 ignore the ref (stripped from text).
function parseAcceptanceCriteria(specText) {
  const lines = String(specText).split('\n');
  const acs = [];
  let inAc = false;
  let acLevel = 0; // heading depth of the "Acceptance Criteria" section
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s/);
    if (h) {
      const level = h[1].length;
      if (!inAc) {
        if (/acceptance criteria/i.test(line)) { inAc = true; acLevel = level; }
      } else if (level <= acLevel) {
        // a sibling/parent section ends the AC block; deeper sub-headings
        // (e.g. `### Partner Search`) stay inside it.
        inAc = false;
      }
      continue;
    }
    if (!inAc) continue;
    const m = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+?)\s*$/);
    if (!m) continue;
    let raw = m[2];
    const t = raw.match(/\{test:\s*([^}]+)\}/i);
    const test = t ? t[1].trim() : null;
    if (t) raw = raw.replace(t[0], '');
    acs.push({ text: normalizeAc(raw), checked: m[1].toLowerCase() === 'x', test });
  }
  return acs;
}

function normalizeAc(s) {
  return String(s).replace(/\s+/g, ' ').replace(/[.:]+$/, '').trim().toLowerCase();
}

// Read every .md in the ticket's spec dir and collect its ACs.
function specAcs(repoRoot, specDirRel) {
  const dir = path.join(repoRoot, specDirRel);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; }
  return acsFromFiles(repoRoot, files.map((f) => path.join(specDirRel, f)));
}

function acsFromFiles(repoRoot, relFiles) {
  const acs = [];
  for (const rel of relFiles) {
    try { acs.push(...parseAcceptanceCriteria(fs.readFileSync(path.join(repoRoot, rel), 'utf8'))); } catch { /* skip */ }
  }
  return acs;
}

// The --base branch of a `gh pr create` command (default null → caller decides).
function baseFromPrCreate(cmd) {
  const m = String(cmd).match(/(?:--base|-B)[=\s]+(['"]?)([^'"\s]+)\1/);
  return m ? m[2] : null;
}

// Spec files this branch adds/changes vs a base ref, filtered by specPathPattern.
// For repos whose specs are flat, per-change files (spec-in-commit model) rather
// than ticket folders.
function changedSpecFiles(repoRoot, base, specPathPattern) {
  const re = new RegExp(specPathPattern);
  const ranges = [`${base}...HEAD`, `${base}..HEAD`, 'HEAD'];
  for (const range of ranges) {
    try {
      const out = execSync(`git diff --name-only ${range}`, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const files = out.split('\n').map((s) => s.trim()).filter((f) => f && re.test(f) && f.endsWith('.md'));
      if (files.length) return files;
    } catch { /* try next range */ }
  }
  return [];
}

module.exports = {
  isPrCreate,
  effectiveDir,
  resolveBody,
  currentBranch,
  ticketFromBranch,
  parseAcceptanceCriteria,
  normalizeAc,
  specAcs,
  acsFromFiles,
  baseFromPrCreate,
  changedSpecFiles,
};
