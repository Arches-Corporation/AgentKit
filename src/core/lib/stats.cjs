'use strict';

function firstLine(text) {
  return String(text || '').split('\n')[0].trim();
}

function aggregate(lines) {
  const byGuardrail = {};
  const blocks = [];
  let total = 0;
  let firstTs = null;
  let lastTs = null;

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry.guardrail !== 'string' || typeof entry.decision !== 'string') continue;
    total += 1;
    if (typeof entry.ts === 'string') {
      if (!firstTs || entry.ts < firstTs) firstTs = entry.ts;
      if (!lastTs || entry.ts > lastTs) lastTs = entry.ts;
    }
    const g = byGuardrail[entry.guardrail] || (byGuardrail[entry.guardrail] = {});
    g[entry.decision] = (g[entry.decision] || 0) + 1;
    if (entry.decision === 'block') {
      blocks.push({ ts: entry.ts || null, guardrail: entry.guardrail, reason: firstLine(entry.reason) });
    }
  }

  const reasonCounts = new Map();
  for (const b of blocks) {
    reasonCounts.set(b.reason, (reasonCounts.get(b.reason) || 0) + 1);
  }
  const topBlockReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    total,
    firstTs,
    lastTs,
    byGuardrail,
    blockCount: blocks.length,
    topBlockReasons,
    recentBlocks: blocks.slice(-10),
  };
}

function formatStats(stats) {
  const out = [];
  if (!stats.total) {
    out.push('log parsed but held no valid entries');
    return out.join('\n');
  }
  out.push(`${stats.total} guardrail events (${stats.firstTs || '?'} → ${stats.lastTs || '?'})`);
  out.push('');
  out.push('by guardrail:');
  const names = Object.keys(stats.byGuardrail).sort();
  for (const name of names) {
    const decisions = stats.byGuardrail[name];
    const parts = Object.keys(decisions).sort().map((d) => `${d} ${decisions[d]}`);
    out.push(`  ${name.padEnd(22)} ${parts.join(' · ')}`);
  }
  if (stats.topBlockReasons.length) {
    out.push('');
    out.push('top block reasons:');
    for (const r of stats.topBlockReasons) {
      out.push(`  ${String(r.count).padStart(3)}× ${r.reason}`);
    }
  }
  if (stats.recentBlocks.length) {
    out.push('');
    out.push(`last ${stats.recentBlocks.length} blocks:`);
    for (const b of stats.recentBlocks) {
      out.push(`  ${b.ts || '?'} ${b.guardrail}: ${b.reason}`);
    }
  }
  return out.join('\n');
}

module.exports = { aggregate, formatStats };
