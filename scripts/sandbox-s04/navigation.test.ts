// Actual application functions, constrained DB double; NOT HTTP or MariaDB acceptance.
import { beforeEach, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadFixtures, materialize } from './fixtures.mjs';
import { buildPlan } from './plan.mjs';
import { verificarCredenciales } from '../../src/lib/auth';
import { empresasParaUsuario } from '../../src/lib/empresas';
import { listarSolicitudesCliente, validarParadasSolicitud } from '../../src/lib/tms/solicitudes-cliente';
import { listarRutas } from '../../src/lib/tms/cliente-rutas';

const db = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock('../../src/lib/db', () => db);
let data: { tables: Record<string, Record<string, unknown>[]> }, passwords: Record<string, string>;
const allowed = new Set(buildPlan().grants.map(g => g.table));
beforeEach(() => {
  passwords = Object.fromEntries(['qa-s04-reader', 'qa-s04-other', 'qa-s04-portal'].map(u => [u, `sandbox:pricesmart-qa:${randomBytes(32).toString('hex')}`]));
  data = materialize(loadFixtures(), passwords);
  db.execute.mockImplementation(() => { throw Error('S04_MODEL_WRITE_DENIED'); });
  db.getPool.mockImplementation(() => { throw Error('S04_MODEL_CONNECTION_DENIED'); });
  db.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (!/^\s*SELECT\b/i.test(sql)) throw Error('S04_MODEL_DDL_WRITE_DENIED');
    for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+`?(\w+)`?/gi)) if (!allowed.has(match[1])) throw Error('S04_MODEL_TABLE_DENIED');
    if (/FROM usuarios WHERE username/.test(sql)) return data.tables.usuarios.filter(u => u.username === params[0]);
    if (/INNER JOIN usuario_empresa/.test(sql)) {
      const ids = data.tables.usuario_empresa.filter(u => u.usuario_id === params[0]).map(u => u.empresa_id);
      return data.tables.empresas.filter(e => ids.includes(e.id));
    }
    if (/FROM tms_solicitudes_cliente s/.test(sql)) return data.tables.tms_solicitudes_cliente.filter(r => r.empresa_id === params[0] && r.cliente_id === params[1]);
    if (/FROM tms_cliente_rutas r/.test(sql)) return data.tables.tms_cliente_rutas.filter(r => r.empresa_id === params[0]).map(r => ({ ...r, cliente_nombre: 'QA Cliente Ficticio S04' }));
    return [];
  });
});
it('modern synthetic user authenticates with existing function using SELECT only', async () => {
  const user = await verificarCredenciales('qa-s04-reader', passwords['qa-s04-reader']);
  expect(user?.id).toBe(720001); expect(user?.rol).toBe('Visualizador'); expect(db.execute).not.toHaveBeenCalled();
});
it('invalid synthetic password is rejected without DDL or UPDATE', async () => {
  expect(await verificarCredenciales('qa-s04-reader', 'invalid-synthetic-password')).toBeNull(); expect(db.execute).not.toHaveBeenCalled();
});
it('existing company selector filters the synthetic user assignment in the DB double', async () => {
  const companies = await empresasParaUsuario({ usuarioId: 720001, rol: 'Visualizador', accesoTodas: false });
  expect(companies.map(c => c.slug)).toEqual(['kt-monaco']);
});
it('existing request reader and real stop validator accept synthetic request', async () => {
  const list = await listarSolicitudesCliente(710001, 750001); expect(list[0].estado).toBe('SOLICITADA');
  const stops = data.tables.tms_solicitud_paradas.map(p => ({ orden: Number(p.orden), tipo: String(p.tipo), lugarNombre: String(p.lugar_nombre) }));
  expect(validarParadasSolicitud(stops).ok).toBe(true);
  expect(validarParadasSolicitud(stops.filter(s => s.tipo !== 'Entrega')).ok).toBe(false);
  expect(await listarSolicitudesCliente(710002, 750001)).toEqual([]); // Model filters; not proof of DB row security.
});
it('existing route reader uses the SELECT table allowlist without ensureSchema', async () => {
  const routes = await listarRutas(710001); expect(routes[0].codigo).toBe('R-900001'); expect(db.execute).not.toHaveBeenCalled();
});
it('permission model denies marker update, DDL and a foreign schema', async () => {
  await expect(db.query('UPDATE novalvion_environment SET environment=?', ['production'])).rejects.toThrow('S04_MODEL_DDL_WRITE_DENIED');
  await expect(db.query('CREATE TABLE fake(id INT)')).rejects.toThrow('S04_MODEL_DDL_WRITE_DENIED');
  await expect(db.query('SELECT * FROM other_database.usuarios')).rejects.toThrow('S04_MODEL_TABLE_DENIED');
});
