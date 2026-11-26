import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildKpiRow, csvCell, KPI_CSV_COLUMNS, kpiToCsv, parseClub, type KpiFacts } from './kpi-model';
import { KPI_MAX_ROWS, KpiInputError, loadKpiRows, type KpiQuery } from './kpi-source';

// PRICESMART KPI — capa independiente de consulta/exportación. Sin inventar datos: lo que SITSA no tiene es NO_DISPONIBLE / SIN_DATO; la entrega solo se EVIDENCIA (nunca «confirmada»: D13).
const base: KpiFacts = { solicitudId: 5, referenciaCliente: 'PS-100', observaciones: '[PS:ab12] PriceSmart (laboratorio) · club C-7 · destinatario Club Ficticio', estadoSolicitud: 'SOLICITADA', fechaSolicitada: '2030-01-15', horaSolicitada: null,
  planId: null, planCodigo: null, estadoPlan: null, fechaPlan: null, horaCarga: null, salidaEn: null, paradas: [], confirmaciones: [] };
const stops = [{ id: 1, type: 'Carga' }, { id: 2, type: 'Entrega' }, { id: 3, type: 'Entrega' }, { id: 4, type: 'Descarga' }];
const ok = (stopId: number, confirmadoEn: string | null) => ({ stopId, result: 'ENTREGADA_POR_PILOTO', revision: 'NO_REQUERIDA', hasEvidence: true, confirmadoEn });
const scheduled: KpiFacts = { ...base, estadoSolicitud: 'PROGRAMADA', planId: 70, planCodigo: 'PLAN-70', estadoPlan: 'En ruta', fechaPlan: '2030-01-14', horaCarga: '06:00', salidaEn: '2030-01-14 06:42:10', paradas: stops };

describe('buildKpiRow — sin inventar', () => {
  it('orden recibida sin programar: solo lo que existe; ventana e ítems NO_DISPONIBLE; sin entrega ni cumplimiento', () => {
    const r = buildKpiRow(base);
    expect(r).toMatchObject({ numeroOrden: 'PS-100', club: 'C-7', fechaPlanificada: null, ventanaEntrega: null, salidaEn: null, entregaEvidenciadaEn: null, entregaNivelEvidencia: 'NO_PROGRAMADA', estadoServicio: 'SOLICITADA', cantidadItems: null, cumplimientoEntrega: 'NO_CALCULABLE', cumplimientoMotivo: 'SIN_PROGRAMAR', cumplimientoBase: null, confirmaEntrega: false });
    expect(r.disponibilidad).toMatchObject({ numeroOrden: 'DISPONIBLE', club: 'DISPONIBLE', fechaPlanificada: 'SIN_DATO', ventanaEntrega: 'NO_DISPONIBLE', salidaEn: 'SIN_DATO', cantidadItems: 'NO_DISPONIBLE', cumplimientoEntrega: 'SIN_DATO' });
  });
  it('viaje en ruta: fecha planificada y salida reales; estado = estado del plan; sin evidencia de entrega aún', () => {
    const r = buildKpiRow({ ...scheduled, confirmaciones: [] });
    expect(r).toMatchObject({ fechaPlanificada: '2030-01-14', salidaEn: '2030-01-14 06:42:10', estadoServicio: 'En ruta', entregaNivelEvidencia: 'NONE', entregaEvidenciadaEn: null, cumplimientoEntrega: 'NO_CALCULABLE', cumplimientoMotivo: 'EVIDENCIA_NONE' });
  });
  it('todas las entregas confirmadas por el piloto con evidencia: la hora es la del ÚLTIMO evento; cumplimiento por día; confirmaEntrega sigue false (D13)', () => {
    const r = buildKpiRow({ ...scheduled, estadoPlan: 'Descargado', confirmaciones: [ok(2, '2030-01-15 09:00:00'), ok(3, '2030-01-15 11:30:00')] });
    expect(r).toMatchObject({ entregaNivelEvidencia: 'PILOT_CONFIRMED_ALL', entregaEvidenciadaEn: '2030-01-15 11:30:00', cumplimientoEntrega: 'A_TIEMPO', cumplimientoBase: 'FECHA_DIA', confirmaEntrega: false });
    expect(buildKpiRow({ ...scheduled, confirmaciones: [ok(2, '2030-01-15 09:00:00'), ok(3, '2030-01-16 00:05:00')] })).toMatchObject({ entregaEvidenciadaEn: '2030-01-16 00:05:00', cumplimientoEntrega: 'TARDE' });
  });
  it('evidencia parcial, pendiente de revisión, incoherente o sin hora fiable → NO se calcula entrega ni cumplimiento', () => {
    expect(buildKpiRow({ ...scheduled, confirmaciones: [ok(2, '2030-01-15 09:00:00')] })).toMatchObject({ entregaNivelEvidencia: 'PARTIAL', entregaEvidenciadaEn: null, cumplimientoEntrega: 'NO_CALCULABLE' });
    expect(buildKpiRow({ ...scheduled, confirmaciones: [ok(2, '2030-01-15 09:00:00'), { stopId: 3, result: 'INCIDENCIA', revision: 'PENDIENTE', hasEvidence: true, confirmadoEn: '2030-01-15 10:00:00' }] })).toMatchObject({ entregaNivelEvidencia: 'REVIEW_REQUIRED', entregaEvidenciadaEn: null, cumplimientoEntrega: 'NO_CALCULABLE' });
    expect(buildKpiRow({ ...scheduled, confirmaciones: [ok(2, '2030-01-15 09:00:00'), ok(3, null)] })).toMatchObject({ entregaNivelEvidencia: 'PILOT_CONFIRMED_ALL', entregaEvidenciadaEn: null, cumplimientoEntrega: 'NO_CALCULABLE', cumplimientoMotivo: 'SIN_HORA_DE_EVIDENCIA' });
    expect(buildKpiRow({ ...scheduled, confirmaciones: [ok(99, '2030-01-15 09:00:00')] })).toMatchObject({ entregaNivelEvidencia: 'REVIEW_REQUIRED', entregaEvidenciadaEn: null });
  });
  it('sin fecha comprometida no hay cumplimiento aunque haya evidencia; tabla de confirmaciones ausente → NO_DISPONIBLE (no «sin entregas»)', () => {
    expect(buildKpiRow({ ...scheduled, fechaSolicitada: null, confirmaciones: [ok(2, '2030-01-15 09:00:00'), ok(3, '2030-01-15 10:00:00')] })).toMatchObject({ entregaEvidenciadaEn: '2030-01-15 10:00:00', cumplimientoEntrega: 'NO_CALCULABLE', cumplimientoMotivo: 'SIN_FECHA_COMPROMETIDA' });
    const r = buildKpiRow({ ...scheduled, confirmaciones: 'UNAVAILABLE' });
    expect(r).toMatchObject({ entregaNivelEvidencia: 'UNAVAILABLE', entregaEvidenciadaEn: null, cumplimientoMotivo: 'CONFIRMACIONES_NO_DISPONIBLES' }); expect(r.disponibilidad.entregaEvidenciadaEn).toBe('NO_DISPONIBLE');
  });
  it('un viaje Descargado o Cerrado NO produce entrega ni cumplimiento por sí solo', () => {
    for (const estadoPlan of ['Descargado', 'Cerrado']) expect(buildKpiRow({ ...scheduled, estadoPlan, confirmaciones: [] })).toMatchObject({ estadoServicio: estadoPlan, entregaEvidenciadaEn: null, cumplimientoEntrega: 'NO_CALCULABLE', confirmaEntrega: false });
  });
  it('el club solo se extrae del formato conocido (lab-demo-1); otro texto → null, nunca se adivina', () => {
    expect(parseClub('x · club ABC-1 · destinatario Y')).toBe('ABC-1'); expect(parseClub('club QA')).toBe('QA');
    for (const t of [null, '', 'Sin club', 'subclub X', 'destinatario club Z más texto']) expect(parseClub(t as never), String(t)).toBeNull();
  });
});

describe('CSV', () => {
  it('columnas fijas; NO_DISPONIBLE para lo que SITSA no tiene; vacío para lo que falta; confirma_entrega siempre false', () => {
    const csv = kpiToCsv([buildKpiRow(base)]).split('\n'); expect(csv[0]).toBe(KPI_CSV_COLUMNS.join(','));
    const cells = csv[1].split(','); expect(cells[KPI_CSV_COLUMNS.indexOf('ventana_entrega')]).toBe('NO_DISPONIBLE'); expect(cells[KPI_CSV_COLUMNS.indexOf('cantidad_items')]).toBe('NO_DISPONIBLE');
    expect(cells[KPI_CSV_COLUMNS.indexOf('fecha_planificada')]).toBe(''); expect(cells.at(-1)).toBe('false'); expect(csv.at(-1)).toBe('');
  });
  it('neutraliza fórmulas de hoja de cálculo y escapa comillas/saltos de línea (los datos vienen de un tercero)', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`); for (const v of ['+1', '-1', '@x', '\tx']) expect(csvCell(v).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('l1\nl2')).toBe('"l1\nl2"'); expect(csvCell(null)).toBe(''); expect(csvCell('normal')).toBe('normal');
    expect(kpiToCsv([buildKpiRow({ ...base, referenciaCliente: '=cmd|\' /C calc\'!A0' })])).toContain(`'=cmd`);
  });
});

describe('loadKpiRows — consulta acotada', () => {
  const schema = 'sandbox_api02_x';
  const query = (answers: Record<string, unknown>[][]): KpiQuery & ReturnType<typeof vi.fn> => { let n = 0; return vi.fn(async () => answers[n++] ?? []) as never; };
  it('solo SELECT; acotada por empresa (y cliente/fechas si se piden) y por el VÍNCULO de PriceSmart; límite máximo', async () => {
    const q = query([[{ id: 5, referencia_cliente: 'PS-1', observaciones: 'club Q', estado: 'SOLICITADA', fecha_solicitada: '2030-01-15', hora_solicitada: null, plan_id: null }]]);
    const rows = await loadKpiRows(q, { empresaId: 9, clienteId: 3, desde: '2030-01-01', hasta: '2030-01-31', limite: 99999 }, schema);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ numeroOrden: 'PS-1', club: 'Q', entregaNivelEvidencia: 'NO_PROGRAMADA' });
    const [sql, params] = q.mock.calls[0] as [string, unknown[]]; expect(sql).toMatch(/^SELECT /); expect(sql).toMatch(/s\.empresa_id = \? AND EXISTS \(SELECT 1 FROM `sandbox_api02_x`\.ps_api12_tms_links l WHERE l\.empresa_id = s\.empresa_id AND l\.solicitud_id = s\.id\)/);
    expect(sql).toMatch(/s\.cliente_id = \?/); expect(sql).toMatch(/p\.cliente_id = s\.cliente_id/); expect(params).toEqual([9, 3, '2030-01-01', '2030-01-31', KPI_MAX_ROWS]);
    expect(q.mock.calls.every(([s]) => /^SELECT /.test(String(s)))).toBe(true);
  });
  it('con plan: trae salida, paradas y confirmaciones acotadas por empresa; tabla de confirmaciones ausente → NO_DISPONIBLE; otros errores se propagan', async () => {
    const sol = [{ id: 5, referencia_cliente: 'PS-1', observaciones: null, estado: 'PROGRAMADA', fecha_solicitada: '2030-01-15', plan_id: 70, plan_codigo: 'P70', plan_estado: 'En ruta', fecha_plan: '2030-01-14', hora_carga: null }];
    const ok = vi.fn(async (sql: string) => /FROM tms_solicitudes_cliente/.test(sql) ? sol : /flota_viajes/.test(sql) ? [{ plan_id: 70, salida: new Date(2030, 0, 14, 6, 42, 10) }] : /tms_plan_paradas/.test(sql) ? [{ id: 2, plan_id: 70, tipo: 'Entrega' }] : /tms_parada_confirmaciones/.test(sql) ? [{ plan_id: 70, parada_id: 2, resultado: 'ENTREGADA_POR_PILOTO', revision: 'NO_REQUERIDA', evidencia_id: 9, confirmado_en: '2030-01-15 10:00:00' }] : []);
    expect((await loadKpiRows(ok as never, { empresaId: 9 }, schema))[0]).toMatchObject({ salidaEn: '2030-01-14 06:42:10', entregaEvidenciadaEn: '2030-01-15 10:00:00', cumplimientoEntrega: 'A_TIEMPO' });
    for (const c of ok.mock.calls.slice(1)) expect(String(c[0])).toMatch(/empresa_id = \?/);
    const sinTabla = vi.fn(async (sql: string) => { if (/FROM tms_solicitudes_cliente/.test(sql)) return sol; if (/tms_parada_confirmaciones/.test(sql)) throw Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE' }); return []; });
    expect((await loadKpiRows(sinTabla as never, { empresaId: 9 }, schema))[0]).toMatchObject({ entregaNivelEvidencia: 'UNAVAILABLE', cumplimientoMotivo: 'CONFIRMACIONES_NO_DISPONIBLES' });
    const roto = vi.fn(async (sql: string) => { if (/FROM tms_solicitudes_cliente/.test(sql)) return sol; if (/tms_parada_confirmaciones/.test(sql)) throw new Error('conexión'); return []; });
    await expect(loadKpiRows(roto as never, { empresaId: 9 }, schema)).rejects.toThrow('conexión');
  });
  it('entradas inválidas se rechazan antes de consultar', async () => {
    const q = vi.fn(async () => []);
    for (const f of [{ empresaId: 0 }, { empresaId: 1.5 }, { empresaId: 1, clienteId: -1 }, { empresaId: 1, desde: '15/01/2030' }, { empresaId: 1, hasta: '2030-1-5' }]) await expect(loadKpiRows(q as never, f as never, schema), JSON.stringify(f)).rejects.toThrow(KpiInputError);
    await expect(loadKpiRows(q as never, { empresaId: 1 }, 'produccion`; DROP')).rejects.toThrow(KpiInputError); expect(q).not.toHaveBeenCalled();
  });
});

describe('separación de la integración operativa', () => {
  const root = path.resolve(__dirname, '..');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const f = path.join(dir, n); return statSync(f).isDirectory() ? walk(f) : /\.ts$/.test(n) && !/\.test\./.test(n) ? [f] : []; });
  it('ningún módulo operativo (salvo el punto de entrada de laboratorio `lab-demo/kpi-entry.ts`) importa la capa KPI y la capa KPI no importa runtime, transporte, M2M, handlers ni los contratos de la API', () => {
    const kpiDir = path.join(root, 'kpi');
    for (const f of walk(root).filter((x) => !x.startsWith(kpiDir) && path.relative(root, x) !== path.join('lab-demo', 'kpi-entry.ts'))) expect(readFileSync(f, 'utf8'), path.relative(root, f)).not.toMatch(/from ['"][^'"]*\/kpi\//);
    for (const f of walk(kpiDir)) { const imports = [...readFileSync(f, 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]); for (const i of imports) expect(i, `${path.basename(f)} → ${i}`).toMatch(/^\.\/|^\.\.\/delivery-evidence$/); }
  });
});
