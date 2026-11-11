// PRICESMART-API-06A — evaluación de ejecuciones de Vitest y resumen B0–B9. PURO. Nunca convierte "no ejecutada", "incompleta" o "con SKIP" en PASS.
export const BLOCKS = Object.freeze(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9']);
// AUD-04: casos OBLIGATORIOS por fase (ids exactos de mariadb-real.lab.ts; una prueba estática verifica que coinciden con el archivo). Un caso obligatorio debe estar presente
// y en PASS: ausente, duplicado u OMITIDO (skip) hace la fase INCOMPLETA. Los casos de OTRA fase aparecen como omitidos en esta y no cuentan.
export const REQUIRED_CASES = Object.freeze({
  main: Object.freeze(['B0.t1', 'B0.t2', 'B0.t3', 'B1.1', 'B1.2', 'B1.3', 'B1.4', 'B2.1', 'B2.2', 'B3.1', 'B3.2', 'B3.3', 'B4.1', 'B4.2', 'B4.3', 'B4.4', 'B5.1', 'B5.2', 'B5.3', 'B6.1', 'B6.2', 'B6.3', 'B8.1', 'B8.2']),
  'crash-prepare': Object.freeze(['B7.1']),
  'crash-verify': Object.freeze(['B7.2', 'B7.3', 'B7.4']),
});
// Omisiones DECLARADAS (permitidas) por fase.
export const DECLARED_SKIPS = Object.freeze({ main: Object.freeze([]), 'crash-prepare': Object.freeze([]), 'crash-verify': Object.freeze(['B7.5']) });
const KNOWN_IDS = new Set([...Object.values(REQUIRED_CASES).flat(), ...Object.values(DECLARED_SKIPS).flat()]);
const idOf = (title) => /(?<![A-Za-z0-9])(B[0-9]\.[0-9a-z]+)(?![0-9a-z])/.exec(title)?.[1];
// Limitaciones declaradas: deben permanecer SKIP y aparecer SIEMPRE en el informe.
export const DECLARED_LIMITATIONS = Object.freeze([
  Object.freeze({ id: 'B7.5', block: 'B7', name: 'Caída DURANTE el COMMIT (COMMIT_UNKNOWN real)', reason: 'no determinista con este arnés; solo cubierta con doble en API-02' }),
]);
export const OVERALL = Object.freeze(['PASS', 'PASS CON LIMITACIONES', 'FAIL', 'INCOMPLETO']);

const MAP = { passed: 'PASS', failed: 'FAIL', skipped: 'SKIP', pending: 'SKIP', todo: 'SKIP', disabled: 'SKIP' };
const titleOf = (t) => [...(t.ancestorTitles ?? []), t.title].join(' > ');
const blockOf = (title) => /\b(B[0-9])\b/.exec(title)?.[1];

/**
 * AUD-02: evalúa UNA ejecución de Vitest. run = {status, signal, error} del proceso; report = JSON parseado o null.
 * INCOMPLETO si el proceso no terminó normalmente, falta el JSON, no hay casos, el recuento no cuadra o falta algún bloque requerido.
 * FAIL si, siendo completo, hay fallos, suites que no cargaron o código de salida ≠ 0. PASS solo si todo es correcto.
 */
export function evaluateVitestRun(phase, run, report) {
  const reasons = [];
  if (!REQUIRED_CASES[phase]) return { state: 'INCOMPLETO', reasons: [`fase desconocida: ${phase}`] };
  if (!run) return { state: 'INCOMPLETO', reasons: ['sin resultado de la ejecución'] };
  if (run.error) reasons.push(`error de proceso: ${run.error.code ?? run.error.message}`);
  if (run.signal) reasons.push(`terminado por señal ${run.signal}`);
  if (run.status === null || run.status === undefined) reasons.push('sin código de salida');
  let tests = []; let files = [];
  if (!report || typeof report !== 'object') reasons.push('JSON de Vitest ausente o ilegible');
  else {
    files = Array.isArray(report.testResults) ? report.testResults : [];
    tests = files.flatMap((f) => (Array.isArray(f.assertionResults) ? f.assertionResults : []));
    if (tests.length === 0) reasons.push('Vitest no reportó ningún caso');
    if (Number.isFinite(Number(report.numTotalTests)) && Number(report.numTotalTests) !== tests.length) reasons.push(`recuento inconsistente (${report.numTotalTests} vs ${tests.length})`);
    const byId = new Map();
    for (const t of tests) { const id = idOf(titleOf(t)); if (id) byId.set(id, [...(byId.get(id) ?? []), t]); }
    // AUD-04: cada caso obligatorio de ESTA fase debe existir, ser único y NO estar omitido.
    for (const id of REQUIRED_CASES[phase]) {
      const items = byId.get(id) ?? [];
      if (items.length === 0) reasons.push(`caso obligatorio ausente: ${id}`);
      else if (items.length > 1) reasons.push(`caso obligatorio duplicado: ${id}`);
      else if (MAP[items[0].status] === 'SKIP') reasons.push(`caso obligatorio OMITIDO (skip): ${id}`);
    }
    // Una omisión es aceptable solo si pertenece a OTRA fase conocida o está declarada para esta; cualquier otra es inesperada.
    for (const t of tests) {
      if (MAP[t.status] !== 'SKIP') continue;
      const id = idOf(titleOf(t));
      if (!id || !KNOWN_IDS.has(id)) reasons.push(`caso omitido no clasificado: ${titleOf(t)}`);
    }
  }
  if (reasons.length) return { state: 'INCOMPLETO', reasons };
  const failures = [];
  if (run.status !== 0) failures.push(`código de salida ${run.status}`);
  if (report.success === false) failures.push('success=false');
  if (Number(report.numFailedTests) > 0) failures.push(`${report.numFailedTests} casos fallidos`);
  if (Number(report.numFailedTestSuites) > 0) failures.push(`${report.numFailedTestSuites} suites fallidas`);
  for (const f of files) if (f.status === 'failed' && (f.assertionResults ?? []).length === 0) failures.push(`suite que no cargó: ${f.name ?? '?'}`);
  for (const t of tests) if (t.status === 'failed') failures.push(`caso fallido: ${titleOf(t)}`);
  return failures.length ? { state: 'FAIL', reasons: failures } : { state: 'PASS', reasons: [] };
}

/**
 * phaseReports: [{phase, report}] con el JSON de Vitest de cada fase (las omisiones que pertenecen a OTRA fase no se cuentan). executorChecks: [{id,name,status,detail}] medidos por el ejecutor.
 * ctx: { phases:[{name,state,reasons}], halted:{phase,reason}|null, shutdown:{proven,reasons}|null, error:string|null }.
 */
export function summarize(phaseReports, executorChecks = [], ctx0 = {}) {
  const ctx = ctx0 ?? {};
  const rows = []; let otherPhaseOmitted = 0;
  for (const entry of phaseReports) {
    const phase = entry?.phase; const report = entry?.report;
    for (const file of report?.testResults ?? []) {
      for (const t of file.assertionResults ?? []) {
        const title = titleOf(t);
        const status = MAP[t.status] ?? 'FAIL';
        const id = idOf(title);
        // AUD-04: una omisión de un caso que pertenece a OTRA fase es esperada y no se cuenta como SKIP; las demás se conservan.
        if (status === 'SKIP' && phase && id && !(REQUIRED_CASES[phase] ?? []).includes(id) && !(DECLARED_SKIPS[phase] ?? []).includes(id) && KNOWN_IDS.has(id)) { otherPhaseOmitted++; continue; }
        rows.push({ id: id ?? '', block: blockOf(title) ?? 'SIN-BLOQUE', name: title, status, detail: status === 'FAIL' ? String((t.failureMessages ?? [])[0] ?? '').split('\n')[0].slice(0, 300) : '' });
      }
    }
  }
  for (const c of executorChecks) rows.push({ id: c.id, block: c.id.slice(0, 2), name: `${c.id} ${c.name}`, status: c.status, detail: c.detail ?? '' });
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of rows) counts[r.status]++;
  const blocks = Object.fromEntries(BLOCKS.map((b) => {
    const own = rows.filter((r) => r.block === b);
    const status = own.length === 0 ? 'NO EJECUTADA' : own.some((r) => r.status === 'FAIL') ? 'FAIL' : own.every((r) => r.status === 'SKIP') ? 'SKIP' : own.some((r) => r.status === 'SKIP') ? 'PASS CON LIMITACIONES' : 'PASS';
    return [b, { status, pass: own.filter((r) => r.status === 'PASS').length, fail: own.filter((r) => r.status === 'FAIL').length, skip: own.filter((r) => r.status === 'SKIP').length }];
  }));
  const unassigned = rows.filter((r) => r.block === 'SIN-BLOQUE').length;
  const phases = ctx.phases ?? []; const halted = ctx.halted ?? null; const shutdown = ctx.shutdown ?? null; const error = ctx.error ?? null;
  // Limitaciones declaradas: siempre visibles; si dejan de ser SKIP (alguien las activó) se exige nueva revisión.
  const limitations = DECLARED_LIMITATIONS.map((l) => {
    const seen = rows.find((r) => r.id === l.id);
    return { ...l, declared: 'SKIP', observed: seen ? seen.status : 'NO OBSERVADA', violation: Boolean(seen && seen.status !== 'SKIP') };
  });
  const problems = [];
  if (counts.FAIL > 0) problems.push(`${counts.FAIL} casos FAIL`);
  if (unassigned > 0) problems.push(`${unassigned} casos sin bloque`);
  if (phases.some((p) => p.state === 'FAIL')) problems.push('fase en FAIL');
  if (limitations.some((l) => l.violation)) problems.push('una limitación declarada dejó de ser SKIP (requiere nueva revisión)');
  const gaps = [];
  if (BLOCKS.some((b) => blocks[b].status === 'NO EJECUTADA')) gaps.push(`bloques sin resultados: ${BLOCKS.filter((b) => blocks[b].status === 'NO EJECUTADA').join(', ')}`);
  if (phases.some((p) => p.state === 'INCOMPLETO')) gaps.push('fase INCOMPLETA');
  if (halted) gaps.push(`ejecución detenida en ${halted.phase}: ${halted.reason}`);
  if (shutdown && shutdown.proven === false) gaps.push('apagado no demostrado');
  if (!shutdown) gaps.push('apagado no registrado');
  if (error) gaps.push(`error del ejecutor: ${error}`);
  if (limitations.some((l) => l.observed === 'NO OBSERVADA')) gaps.push('limitación declarada no observada');
  const limited = counts.SKIP > 0 || BLOCKS.some((b) => ['SKIP', 'PASS CON LIMITACIONES'].includes(blocks[b].status));
  const overall = problems.length ? 'FAIL' : gaps.length ? 'INCOMPLETO' : limited ? 'PASS CON LIMITACIONES' : 'PASS';
  return { rows, counts, blocks, unassigned, otherPhaseOmitted, phases, halted, shutdown, error, limitations, problems, gaps, overall };
}

export function renderMarkdown(summary, header = '') {
  const lines = [`# Resultados API-06A${header ? ` — ${header}` : ''}`, '', `Global: **${summary.overall}** (PASS ${summary.counts.PASS} / FAIL ${summary.counts.FAIL} / SKIP ${summary.counts.SKIP})`];
  if (summary.problems.length) lines.push('', `Problemas: ${summary.problems.join('; ')}`);
  if (summary.gaps.length) lines.push('', `Pendiente/incompleto: ${summary.gaps.join('; ')}`);
  lines.push('', '| Bloque | Estado | PASS | FAIL | SKIP |', '|---|---|---|---|---|');
  for (const b of BLOCKS) lines.push(`| ${b} | ${summary.blocks[b].status} | ${summary.blocks[b].pass} | ${summary.blocks[b].fail} | ${summary.blocks[b].skip} |`);
  lines.push('', '## Limitaciones declaradas (permanecen SKIP)', '', '| Caso | Declarado | Observado | Motivo |', '|---|---|---|---|');
  for (const l of summary.limitations) lines.push(`| ${l.id} ${l.name} | ${l.declared} | ${l.observed} | ${l.reason} |`);
  if (summary.phases.length) { lines.push('', '## Fases de Vitest', '', '| Fase | Estado | Motivos |', '|---|---|---|'); for (const p of summary.phases) lines.push(`| ${p.name} | ${p.state} | ${(p.reasons ?? []).join('; ').replace(/\|/g, '/')} |`); }
  if (summary.shutdown) lines.push('', `Apagado demostrado: ${summary.shutdown.proven ? 'sí' : 'NO'}${summary.shutdown.reasons?.length ? ` (${summary.shutdown.reasons.join('; ')})` : ''}`);
  lines.push('', '## Casos', '', '| Caso | Estado | Detalle |', '|---|---|---|');
  for (const r of summary.rows) lines.push(`| ${r.name.replace(/\|/g, '/')} | ${r.status} | ${r.detail.replace(/\|/g, '/')} |`);
  return lines.join('\n') + '\n';
}
