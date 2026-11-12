// PORTAL-E2E — comprobaciones DIRECTAS contra la API real del Portal (sin la interfaz) sobre el entorno desechable del harness.
// Uso: node scripts/ci/portal-e2e/api-checks.mjs   (requiere `up`, `schema`, `seed` y `app` ejecutados). Datos FICTICIOS; solo 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runDir = fs.readFileSync(path.join(fs.realpathSync.native(os.tmpdir()), 'portal-e2e-current-run.txt'), 'utf8').trim();
const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
const base = `http://127.0.0.1:${state.app.port}`; const { seed } = state;
const sql = (q) => JSON.parse(cp.execFileSync(process.execPath, [path.join(here, 'harness.mjs'), 'sql', q], { encoding: 'utf8' }));
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function login(user) {
  const res = await fetch(`${base}/api/portal/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password: user.password }) });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!res.ok || !cookie) throw new Error(`login ${user.username}: ${res.status}`);
  return cookie;
}
const confirmar = async (cookie, viaje, parada, body, extraHeaders = {}) => {
  const res = await fetch(`${base}/api/portal/viajes/${viaje}/paradas/${parada}/confirmar`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
};
const count = (where) => Number(sql(`SELECT COUNT(*) AS n FROM tms_parada_confirmaciones WHERE ${where}`)[0].n);
const audits = () => Number(sql("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'confirmar_entrega_parada_piloto'")[0].n);
// JPEG mínimo válido (1x1) para subir evidencia por la API real
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
async function subirEvidencia(cookie, viaje, parada) {
  const form = new FormData(); form.set('tipo', 'producto'); form.set('paradaId', String(parada)); form.set('latitud', '14.6'); form.set('longitud', '-90.5');
  form.append('files', new Blob([JPEG], { type: 'image/jpeg' }), `ev_${parada}.jpg`);
  const res = await fetch(`${base}/api/portal/viajes/${viaje}/evidencias`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  return res.status;
}

const [piloto, aux] = [await login(seed.piloto), await login(seed.auxiliar)];
const [VIAJE] = [seed.viaje]; const [CARGA, , , FINAL] = seed.paradas; const P3 = seed.paradas[2]; const P2 = seed.paradas[1];
// Estado base (si la prueba de interfaz no lo creó): parada 2 ENTREGADA POR PILOTO y parada 3 con incidencia PARCIAL pendiente, ambas con su evidencia, por la API real.
if (count(`parada_id = ${P2}`) === 0) { await subirEvidencia(piloto, VIAJE, P2); await confirmar(piloto, VIAJE, P2, { resultado: 'ENTREGADA_POR_PILOTO' }); }
if (count(`parada_id = ${P3}`) === 0) { await subirEvidencia(piloto, VIAJE, P3); await confirmar(piloto, VIAJE, P3, { resultado: 'PARCIAL', nota: 'abc cajas faltantes: 3 de 10' }); }
const before = { total: count('1=1'), audits: audits() };

// ---- sin sesión / identificadores
check('sin sesión ⇒ 401', (await confirmar(null, VIAJE, FINAL, { resultado: 'ENTREGADA_POR_PILOTO' })).status === 401);
check('viaje inexistente ⇒ 403 (no participa)', (await confirmar(piloto, 99999, FINAL, { resultado: 'ENTREGADA_POR_PILOTO' })).status === 403);
check('parada inexistente ⇒ 404', (await confirmar(piloto, VIAJE, 99999, { resultado: 'ENTREGADA_POR_PILOTO' })).status === 404);
check('identificador no numérico ⇒ 404', (await confirmar(piloto, VIAJE, 'abc', { resultado: 'ENTREGADA_POR_PILOTO' })).status === 404);
check('cuerpo con campos extra (empresaId, piloto, hora, estado externo) ⇒ 400', (await Promise.all([{ empresaId: 9 }, { pilotoId: 1 }, { confirmadoEn: '2020-01-01' }, { estadoExterno: 'DELIVERED' }].map((x) => confirmar(piloto, VIAJE, FINAL, { resultado: 'ENTREGADA_POR_PILOTO', ...x })))).every((r) => r.status === 400));
check('JSON ilegible ⇒ 400', (await confirmar(piloto, VIAJE, FINAL, '{no', {})).status === 400);

// ---- paso 5: sin evidencia no se confirma
const sinEv = await confirmar(piloto, VIAJE, FINAL, { resultado: 'ENTREGADA_POR_PILOTO' });
check('SIN evidencia ⇒ 409 SIN_EVIDENCIA, nada guardado', sinEv.status === 409 && sinEv.json?.codigo === 'SIN_EVIDENCIA' && count(`parada_id = ${FINAL}`) === 0, JSON.stringify(sinEv.json));
check('parada de Carga ⇒ 409 TIPO_NO_CONFIRMABLE', (await confirmar(piloto, VIAJE, CARGA, { resultado: 'ENTREGADA_POR_PILOTO' })).json?.codigo === 'TIPO_NO_CONFIRMABLE');
check('incidencia sin nota ⇒ 400 NOTA_REQUERIDA', (await confirmar(piloto, VIAJE, FINAL, { resultado: 'PARCIAL' })).json?.codigo === 'NOTA_REQUERIDA');

// ---- paso 9: el auxiliar NO puede confirmar, ni con evidencia existente, ni con ninguno de los resultados
check('subir evidencia de la parada final (piloto, API real) ⇒ 200', (await subirEvidencia(piloto, VIAJE, FINAL)) === 200);
const rAux = await Promise.all([{ resultado: 'ENTREGADA_POR_PILOTO' }, { resultado: 'PARCIAL', nota: 'incidencia del auxiliar' }, { resultado: 'RECHAZADA', nota: 'rechazo del auxiliar' }, { resultado: 'INCIDENCIA', nota: 'incidencia del auxiliar' }].map((b) => confirmar(aux, VIAJE, FINAL, b)));
check('AUXILIAR con evidencia existente, 4 resultados ⇒ 403 NO_ASIGNADO y nada guardado', rAux.every((r) => r.status === 403 && r.json?.codigo === 'NO_ASIGNADO') && count(`parada_id = ${FINAL}`) === 0, rAux.map((r) => r.status).join(','));
check('auxiliar tampoco puede sobre la parada ya confirmada ni sobre la pendiente', (await Promise.all([P2, P3].map((p) => confirmar(aux, VIAJE, p, { resultado: 'ENTREGADA_POR_PILOTO' })))).every((r) => r.status === 403));
check('el auxiliar SÍ puede leer el historial de la parada (solo lectura)', (await fetch(`${base}/api/portal/viajes/${VIAJE}/paradas/${P2}/confirmar`, { headers: { Cookie: aux } })).status === 200);

// ---- doble confirmación / revisión pendiente
const dup = await confirmar(piloto, VIAJE, P2, { resultado: 'PARCIAL', nota: 'segundo intento distinto' });
check('parada ya ENTREGADA + otro resultado ⇒ 409 YA_CONFIRMADA', dup.status === 409 && dup.json?.codigo === 'YA_CONFIRMADA');
const pend = await confirmar(piloto, VIAJE, P3, { resultado: 'ENTREGADA_POR_PILOTO' });
check('parada con incidencia PENDIENTE + entregada ⇒ 409 REVISION_PENDIENTE', pend.status === 409 && pend.json?.codigo === 'REVISION_PENDIENTE');
const rep = await confirmar(piloto, VIAJE, P2, { resultado: 'ENTREGADA_POR_PILOTO' });
check('reintento idéntico ⇒ 200 replayed, misma confirmación', rep.status === 200 && rep.json?.replayed === true && rep.json?.confirmacion?.id === sql(`SELECT id FROM tms_parada_confirmaciones WHERE parada_id = ${P2}`)[0].id);

// ---- paso 8: ráfaga concurrente (reintentos simultáneos) ⇒ UNA sola fila
const rafaga = await Promise.all(Array.from({ length: 8 }, () => confirmar(piloto, VIAJE, FINAL, { resultado: 'ENTREGADA_POR_PILOTO' })));
const codigos = rafaga.map((r) => r.status).sort().join(',');
check('8 confirmaciones simultáneas de la misma parada ⇒ una sola fila (el resto replay)', count(`parada_id = ${FINAL}`) === 1 && rafaga.filter((r) => r.status === 201).length === 1 && rafaga.every((r) => [200, 201].includes(r.status)), codigos);
check('una sola auditoría por confirmación real (parada final)', Number(sql(`SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'confirmar_entrega_parada_piloto' AND detalle LIKE '%parada #${FINAL} %'`)[0].n) === 1);

// ---- paso 10: nada se publica como recepción oficial
const fila = sql(`SELECT * FROM tms_parada_confirmaciones WHERE parada_id = ${FINAL}`)[0];
check('la fila guarda «ENTREGADA_POR_PILOTO» y ninguna columna de recepción oficial/estado externo', fila.resultado === 'ENTREGADA_POR_PILOTO' && !Object.keys(fila).some((k) => /oficial|pricesmart|externo|publicad/i.test(k)));
check('la respuesta declara NO_ACEPTADA_POR_PRICESMART y estadoExternoPublicado=false', rep.json?.confirmacion?.recepcionOficial === 'NO_ACEPTADA_POR_PRICESMART' && rep.json?.confirmacion?.estadoExternoPublicado === false);
check('el entorno no tiene tablas de integración PriceSmart (outbox/adaptación): nada pudo publicarse', Number(sql("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'ps\\_api0%' OR TABLE_NAME LIKE '%pricesmart%')")[0].n) === 0);
check('la auditoría de las confirmaciones no incluye texto de notas', sql("SELECT detalle FROM auditoria WHERE accion = 'confirmar_entrega_parada_piloto'").every((a) => !/cajas faltantes|incidencia del auxiliar/.test(a.detalle)));

const after = { total: count('1=1'), audits: audits() };
check('totales: 3 confirmaciones nuevas máximo desde el inicio de las comprobaciones (solo la parada final)', after.total - before.total === 1 && after.audits - before.audits === 1, `${before.total}→${after.total} filas, ${before.audits}→${after.audits} auditorías`);
const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} comprobaciones aprobadas`);
process.exitCode = failed.length ? 1 : 0;
