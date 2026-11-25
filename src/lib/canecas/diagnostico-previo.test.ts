import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ redis: vi.fn(), fifo: vi.fn(), catalogos: vi.fn(), mapeo: vi.fn(), ventas: vi.fn(), simpl: vi.fn(), estado: vi.fn() }));
vi.mock('../../../scripts/ci/canecas/contrato-redistribucion.mjs', () => ({ verificarContratoRedistribucion: m.redis, verificarCriterioFifo: m.fifo }));
vi.mock('../../../scripts/ci/canecas/contrato-catalogos.mjs', () => ({ verificarContratoCatalogos: m.catalogos, verificarMapeoProveedoresCompleto: m.mapeo }));
vi.mock('../../../scripts/ci/canecas/contrato-ventas.mjs', () => ({ verificarContratoVentas: m.ventas }));
vi.mock('../../../scripts/ci/canecas/contrato-simplificacion.mjs', () => ({ verificarContratoSimplificacion: m.simpl }));
vi.mock('../../../scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs', () => ({ obtenerEstadoSimplificacion: m.estado }));
import { diagnosticarPrevio, formatearDiagnostico, tablasEsperadasPrevias } from '../../../scripts/ci/canecas/diagnostico-previo-simplificacion.mjs';

const BASE = 'u611730801_Plataforma';
const filasPreflight = (n: number, detener: string[] = []) => Array.from({ length: n }, (_, i) => [{ verificacion: `comprobación ${i + 1}`, resultado: detener.includes(`comprobación ${i + 1}`) ? 'DETENER' : 'OK' }]);
function conexion(opciones: { version?: string; grants?: string[]; roConfirmado?: boolean; tablas?: string[]; preflight?: unknown[][] } = {}) {
  const sqls: string[] = [];
  let ro = 0;
  const c = {
    query: vi.fn(async (sql: string) => {
      sqls.push(sql);
      if (sql.startsWith('SELECT DATABASE()')) return [[{ base: BASE, version: opciones.version ?? '11.8.9-MariaDB-ubu2404' }], []];
      if (sql === 'SET SESSION TRANSACTION READ ONLY') { ro = opciones.roConfirmado === false ? 0 : 1; return [{}, []]; }
      if (sql === 'SET SESSION TRANSACTION READ WRITE') { ro = 0; return [{}, []]; }
      if (sql.includes('@@SESSION.tx_read_only')) return [[{ ro }], []];
      if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [(opciones.grants ?? [`GRANT ALL PRIVILEGES ON \`u611730801\\_Plataforma\`.* TO \`u\`@\`%\``]).map(g => ({ g })), []];
      if (sql.includes('@@SESSION.foreign_key_checks')) return [[{ fk: 1, ck: 1, modo: 'STRICT_TRANS_TABLES', strict: 1 }], []];
      if (sql.includes("TABLE_NAME AS t")) return [(opciones.tablas ?? tablasEsperadasPrevias()).map(t => ({ t })), []];
      if (sql.startsWith('SELECT 1 AS verificacion') || sql.includes("AS verificacion")) return [opciones.preflight ?? filasPreflight(22), []];
      return [[], []];
    }),
  };
  return { c: c as never, sqls };
}
beforeEach(() => { vi.clearAllMocks(); for (const f of [m.redis, m.fifo, m.catalogos, m.mapeo, m.ventas, m.simpl]) f.mockResolvedValue(undefined); m.estado.mockResolvedValue([0, 0, 0, 0, 0, 0]); });
const estado = (r: Awaited<ReturnType<typeof diagnosticarPrevio>>, parte: string) => r.comprobaciones.find(c => c.nombre.includes(parte));

describe('diagnóstico previo de solo lectura', () => {
  it('esquema previo correcto: todas las comprobaciones en OK, reutiliza los verificadores y no bloquea', async () => {
    const { c } = conexion();
    const r = await diagnosticarPrevio(c);
    expect(r.falla).toBe(false);
    expect(r.comprobaciones.filter(x => x.estado === 'FALLO')).toEqual([]);
    for (const f of [m.redis, m.fifo, m.catalogos, m.ventas]) expect(f).toHaveBeenCalledTimes(1); // los verificadores de los instaladores, sin duplicar su lógica
    expect(m.simpl).not.toHaveBeenCalled();
    expect(estado(r, 'Las 17 tablas')!.detalle).toContain('17 esperadas presentes');
    expect(estado(r, 'Preflight')!.estado).toBe('OK');
    expect(formatearDiagnostico(r)).toContain('RESULTADO: SIN BLOQUEOS');
  });
  it('impone la sesión de solo lectura ANTES de consultar y la restaura al terminar; nunca emite escrituras', async () => {
    const { c, sqls } = conexion();
    await diagnosticarPrevio(c);
    const iRo = sqls.indexOf('SET SESSION TRANSACTION READ ONLY');
    expect(iRo).toBeGreaterThan(-1);
    expect(sqls.slice(iRo + 2).every(s => !/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b/i.test(s))).toBe(true);
    expect(sqls.filter(s => /^SET /i.test(s))).toEqual(['SET SESSION TRANSACTION READ ONLY', 'SET SESSION TRANSACTION READ WRITE']);
    expect(sqls.at(-1)).toBe('SET SESSION TRANSACTION READ WRITE');
  });
  it('si el servidor no confirma el solo lectura, se detiene sin ejecutar ninguna comprobación', async () => {
    const { c } = conexion({ roConfirmado: false });
    await expect(diagnosticarPrevio(c)).rejects.toThrow('no se pudo imponer la sesión de solo lectura');
    expect(m.redis).not.toHaveBeenCalled(); expect(m.ventas).not.toHaveBeenCalled();
  });
  it('una falla no detiene las demás: cada contrato se informa por separado', async () => {
    m.redis.mockRejectedValue(new Error('DETENER: contrato de redistribución incompatible en triggers'));
    m.ventas.mockRejectedValue(new Error('DETENER: definición incompatible del trigger trg_can_venta_bd'));
    const { c } = conexion();
    const r = await diagnosticarPrevio(c);
    expect(r.falla).toBe(true);
    expect(estado(r, 'Contrato de redistribución')).toMatchObject({ estado: 'FALLO', detalle: 'contrato de redistribución incompatible en triggers' });
    expect(estado(r, 'Contrato de ventas anterior')).toMatchObject({ estado: 'FALLO' });
    expect(estado(r, 'Criterio FIFO')!.estado).toBe('OK'); expect(estado(r, 'Contrato de catálogos')!.estado).toBe('OK');
    expect(m.catalogos).toHaveBeenCalled(); expect(m.fifo).toHaveBeenCalled();
    expect(formatearDiagnostico(r)).toContain('RESULTADO: BLOQUEADO');
  });
  it('privilegios insuficientes, versión distinta y tablas faltantes se reportan sin ejecutar nada', async () => {
    const r = await diagnosticarPrevio(conexion({ version: '10.11.14-MariaDB', grants: [`GRANT SELECT, CREATE ON \`${BASE.replace('_', '\\_')}\`.* TO \`u\`@\`%\``], tablas: tablasEsperadasPrevias().filter(t => t !== 'canecas_ventas') }).c);
    expect(estado(r, 'Versión')!.estado).toBe('FALLO');
    expect(estado(r, 'Privilegios')).toMatchObject({ estado: 'FALLO', detalle: 'faltan: ALTER, INDEX, REFERENCES, TRIGGER' });
    expect(estado(r, 'Las 17 tablas')).toMatchObject({ estado: 'FALLO', detalle: 'faltan: canecas_ventas' });
  });
  it('un preflight en DETENER (p. ej. más de una caneca activa) bloquea y lo nombra', async () => {
    const r = await diagnosticarPrevio(conexion({ preflight: filasPreflight(22, ['comprobación 10']) }).c);
    expect(estado(r, 'Preflight')).toMatchObject({ estado: 'FALLO' });
    expect(estado(r, 'Preflight')!.detalle).toContain('comprobación 10');
    expect(r.falla).toBe(true);
  });
  it('estado parcial de la simplificación se informa y apunta al diagnóstico de recuperación', async () => {
    m.estado.mockResolvedValue([1, 0, 0, 0, 0, 0]);
    const r = await diagnosticarPrevio(conexion().c);
    expect(estado(r, 'Estado de la simplificación')).toMatchObject({ estado: 'FALLO' });
    expect(estado(r, 'Estado de la simplificación')!.detalle).toContain('recuperacion-canecas-simplificacion-solo-lectura.sql');
  });
  it('con la simplificación ya instalada omite los contratos anteriores de catálogos y ventas y verifica el nuevo con el postcheck (15)', async () => {
    m.estado.mockResolvedValue([1, 1, 1, 1, 1, 1]);
    const r = await diagnosticarPrevio(conexion({ preflight: filasPreflight(15) }).c);
    expect(m.ventas).not.toHaveBeenCalled(); expect(m.catalogos).not.toHaveBeenCalled(); expect(m.simpl).toHaveBeenCalledTimes(1);
    expect(estado(r, 'Contrato de ventas ANTERIOR')!.estado).toBe('OMITIDA');
    expect(estado(r, 'Contrato de catálogos ANTERIOR')!.estado).toBe('OMITIDA');
    expect(estado(r, 'Postcheck')!.estado).toBe('OK');
    expect(r.falla).toBe(false);
  });
  it('las compras históricas sin mapear son informativas: no bloquean', async () => {
    m.mapeo.mockRejectedValue(new Error('DETENER: 3 compras históricas sin proveedor de Canecas; requiere mapeo manual antes de continuar'));
    const r = await diagnosticarPrevio(conexion().c);
    expect(estado(r, 'mapeado')).toMatchObject({ estado: 'INFO' });
    expect(r.falla).toBe(false);
  });
  it('el script no contiene sentencias de escritura ni imprime credenciales', () => {
    const fuente = readFileSync('scripts/ci/canecas/diagnostico-previo-simplificacion.mjs', 'utf8');
    const sinComentarios = fuente.split('\n').filter(l => !/^\s*\/\//.test(l) && !l.includes('matchAll(')).join('\n'); // matchAll lee las migraciones; no las ejecuta
    expect(sinComentarios).not.toMatch(/\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|DROP |ALTER TABLE|CREATE TABLE|TRUNCATE)\b/i);
    expect(sinComentarios).not.toMatch(/console\.(log|error)\([^)]*(password|PASSWORD)/);
    expect(sinComentarios).not.toMatch(/rejectUnauthorized:\s*false/);
  });
  it('las 17 tablas esperadas salen de las migraciones anteriores (sin las de la simplificación)', () => {
    const t = tablasEsperadasPrevias();
    expect(t).toHaveLength(17);
    expect(t).not.toContain('canecas_secuencias');
    expect(t).toEqual(expect.arrayContaining(['canecas_productos', 'canecas_ventas', 'canecas_compras_mapeo_proveedor', 'canecas_redistribuciones_origen']));
  });
});
