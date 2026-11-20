'use strict';
const { PRICING_URL } = require('./links');

const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];
const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical', 'blocking'];

function parseOptions(raw) {
  const minGrade = (raw.minGrade || '').trim().toUpperCase();
  if (minGrade && !GRADES.includes(minGrade)) {
    throw new Error(`min-grade invalid: "${raw.minGrade}" (expected A to F or empty)`);
  }
  const sev = (raw.failOnSeverity || 'none').trim().toLowerCase();
  if (sev !== 'none' && !SEVERITIES.includes(sev)) {
    throw new Error(`fail-on-severity invalid: "${raw.failOnSeverity}" (expected none, low, medium, high, critical or blocking)`);
  }
  return { minGrade, failOnSeverity: sev, failOnPartial: /^(true|1|yes)$/i.test(raw.failOnPartial || '') };
}

function normalizeDomain(input) {
  const d = (input || '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').toLowerCase();
  if (!d || !d.includes('.')) throw new Error(`domain invalid: "${input}"`);
  return d;
}

function failedFindings(result) {
  return (result.findings || []).filter((f) => f.status === 'fail' && !f.superseded);
}

function worstSeverity(findings) {
  let worst = -1;
  for (const f of findings) worst = Math.max(worst, SEVERITIES.indexOf(f.severity));
  return worst < 0 ? '' : SEVERITIES[worst];
}

// Retourne { passed, reasons[], failed[], worst }.
function evaluate(result, opts) {
  const failed = failedFindings(result);
  const worst = worstSeverity(failed);
  const reasons = [];
  const grade = result.grade || '';
  if (!grade) {
    if (opts.failOnPartial) reasons.push('partial grade (fewer than 70% of checks verified)');
  } else if (opts.minGrade && GRADES.indexOf(grade) > GRADES.indexOf(opts.minGrade)) {
    reasons.push(`grade ${grade} is below the minimum ${opts.minGrade}`);
  }
  if (opts.failOnSeverity !== 'none') {
    const limit = SEVERITIES.indexOf(opts.failOnSeverity);
    const hits = failed.filter((f) => SEVERITIES.indexOf(f.severity) >= limit);
    if (hits.length) reasons.push(`${hits.length} failed check(s) with severity ${opts.failOnSeverity} or worse`);
  }
  return { passed: reasons.length === 0, reasons, failed, worst };
}

function esc(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function summary(result, verdict, opts, siteUrl) {
  const grade = result.grade || 'partial';
  const lines = [
    `## AttackScout Check: ${esc(result.domain)}`,
    '',
    `${verdict.passed ? 'PASSED' : 'FAILED'} - grade **${grade}**, ${verdict.failed.length} failed check(s)` +
      (verdict.worst ? `, worst severity **${verdict.worst}**` : ''),
    '',
  ];
  if (!verdict.passed) {
    for (const r of verdict.reasons) lines.push(`- ${esc(r)}`);
    lines.push('');
  }
  const thresholds = [];
  if (opts.minGrade) thresholds.push(`min-grade ${opts.minGrade}`);
  if (opts.failOnSeverity !== 'none') thresholds.push(`fail-on-severity ${opts.failOnSeverity}`);
  if (opts.failOnPartial) thresholds.push('fail-on-partial');
  lines.push(`Thresholds: ${thresholds.join(', ') || 'none'}`, '');
  if (verdict.failed.length) {
    lines.push('| Check | Family | Severity | Code |', '|---|---|---|---|');
    const sorted = [...verdict.failed].sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity));
    for (const f of sorted.slice(0, 25)) {
      lines.push(`| ${esc(f.id)} | ${esc(f.family)} | ${esc(f.severity || '')} | ${esc(f.code)} |`);
    }
    if (sorted.length > 25) lines.push('', `... and ${sorted.length - 25} more.`);
    lines.push('');
  }
  const soon = (result.deadlines || []).filter((d) => d.urgency === 'now' || d.urgency === 'this_month').slice(0, 5);
  if (soon.length) {
    lines.push('Upcoming deadlines:', '');
    for (const d of soon) lines.push(`- ${esc(String(d.date).slice(0, 10))}: ${esc(d.control)} ${esc(d.code)} (${esc(d.urgency)})`);
    lines.push('');
  }
  lines.push(`Public audit by [AttackScout](${siteUrl}) - what is visible from the Internet, nothing more.`, '');
  lines.push(`[Surveiller ce domaine](${PRICING_URL})`);
  return lines.join('\n');
}

module.exports = { parseOptions, normalizeDomain, evaluate, summary, GRADES, SEVERITIES };
