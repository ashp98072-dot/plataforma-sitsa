// PRICESMART-API-06A — resumen PASS/FAIL/SKIP por bloque B0–B9. PURO. Nunca convierte "no ejecutada" en PASS.
export const BLOCKS = Object.freeze(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9']);

const MAP = { passed: 'PASS', failed: 'FAIL', skipped: 'SKIP', pending: 'SKIP', todo: 'SKIP', disabled: 'SKIP' };

/** reports: JSON de vitest (--reporter=json). executorChecks: [{id,name,status,detail}] de B0/B9 medidos por el ejecutor. */
export function summarize(reports, executorChecks = []) {
  const rows = [];
  for (const report of reports) {
    for (const file of report?.testResults ?? []) {
      for (const t of file.assertionResults ?? []) {
        const title = [...(t.ancestorTitles ?? []), t.title].join(' > ');
        const block = /\b(B[0-9])\b/.exec(title)?.[1] ?? 'SIN-BLOQUE';
        const status = MAP[t.status] ?? 'FAIL';
        rows.push({ block, name: title, status, detail: status === 'FAIL' ? String((t.failureMessages ?? [])[0] ?? '').split('\n')[0].slice(0, 300) : '' });
      }
    }
  }
  for (const c of executorChecks) rows.push({ block: c.id.slice(0, 2), name: `${c.id} ${c.name}`, status: c.status, detail: c.detail ?? '' });
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of rows) counts[r.status]++;
  const blocks = Object.fromEntries(BLOCKS.map((b) => {
    const own = rows.filter((r) => r.block === b);
    const status = own.length === 0 ? 'NO EJECUTADA' : own.some((r) => r.status === 'FAIL') ? 'FAIL' : own.every((r) => r.status === 'SKIP') ? 'SKIP' : own.some((r) => r.status === 'SKIP') ? 'PASS (con SKIP)' : 'PASS';
    return [b, { status, pass: own.filter((r) => r.status === 'PASS').length, fail: own.filter((r) => r.status === 'FAIL').length, skip: own.filter((r) => r.status === 'SKIP').length }];
  }));
  const unassigned = rows.filter((r) => r.block === 'SIN-BLOQUE').length;
  const overall = counts.FAIL > 0 || unassigned > 0 ? 'FAIL' : BLOCKS.some((b) => blocks[b].status === 'NO EJECUTADA') ? 'INCOMPLETO' : 'PASS';
  return { rows, counts, blocks, unassigned, overall };
}

export function renderMarkdown(summary, header = '') {
  const lines = [`# Resultados API-06A${header ? ` — ${header}` : ''}`, '', `Global: **${summary.overall}** (PASS ${summary.counts.PASS} / FAIL ${summary.counts.FAIL} / SKIP ${summary.counts.SKIP})`, '',
    '| Bloque | Estado | PASS | FAIL | SKIP |', '|---|---|---|---|---|'];
  for (const b of BLOCKS) lines.push(`| ${b} | ${summary.blocks[b].status} | ${summary.blocks[b].pass} | ${summary.blocks[b].fail} | ${summary.blocks[b].skip} |`);
  lines.push('', '| Caso | Estado | Detalle |', '|---|---|---|');
  for (const r of summary.rows) lines.push(`| ${r.name.replace(/\|/g, '/')} | ${r.status} | ${r.detail.replace(/\|/g, '/')} |`);
  return lines.join('\n') + '\n';
}
