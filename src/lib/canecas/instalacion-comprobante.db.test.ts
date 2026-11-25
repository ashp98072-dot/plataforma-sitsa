import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { registrarCompraConIngreso } from './compra-ingreso';
import { anularVenta, registrarVenta } from './ventas';
import { crearCatalogo } from './catalogos';
import { historialVentas } from './reportes';
import { aplicar, crearBase, k, prepararBaseHastaVentas, type Fila } from './lab-simplificacion';

// Ejecuta los archivos SQL del comprobante con el CLIENTE real de MariaDB (como al pegarlos en phpMyAdmin): sin base por defecto, con
// information_schema o mysql seleccionadas, con CRLF y, en la etapa del trigger, con el delimitador `//`. La base se llama como la de producción.
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const cliente = process.env.CANECAS_LAB_MARIADB ?? 'mariadb';
const BASE = 'u611730801_Plataforma';
const DIR = 'sql/instalacion-comprobante-phpmyadmin';
const SESION_HOSTINGER = "SET SESSION sql_mode='NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', innodb_strict_mode=0";
type Salida = { codigo: number; stdout: string; stderr: string; filas: { verificacion: string; resultado: string }[] };
function ejecutar(nombre: string, { baseDefecto = '', crlf = false, force = false }: { baseDefecto?: string; crlf?: boolean; force?: boolean } = {}): Salida {
  let sql = readFileSync(`${DIR}/${nombre}.sql`, 'utf8');
  const delimitador = nombre.includes('etapa2');
  if (nombre.includes('solo-lectura')) sql = `SET SESSION TRANSACTION READ ONLY;\n${sql}`;
  if (crlf) sql = sql.replace(/\n/g, '\r\n');
  const args = ['--no-defaults', '--protocol=SOCKET', `--socket=${socket}`, '-uroot', '--batch', `--init-command=${SESION_HOSTINGER}`, ...(delimitador ? ['--delimiter=//'] : []), ...(force ? ['--force'] : []), ...(baseDefecto ? [baseDefecto] : [])];
  const r = spawnSync(cliente, args, { input: sql, encoding: 'utf8', timeout: 120000 });
  const filas: Salida['filas'] = [];
  let dentro = false;
  for (const linea of r.stdout.split('\n')) {
    if (linea === 'verificacion\tresultado') { dentro = true; continue; }
    const p = linea.split('\t');
    if (dentro && p.length === 2) filas.push({ verificacion: p[0], resultado: p[1] }); else dentro = false;
  }
  return { codigo: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, filas };
}
const detener = (s: Salida) => s.filas.filter(f => f.resultado === 'DETENER').map(f => f.verificacion);
const dato = (s: Salida, parte: string) => s.filas.find(f => f.verificacion.includes(parte))?.resultado;
const consulta = async (pool: mysql.Pool, sql: string, p: unknown[] = []) => (await pool.query<Fila[]>(sql, p as never))[0];
const triggerBu = async (pool: mysql.Pool) => String((await consulta(pool, `SELECT ACTION_STATEMENT a FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${BASE}' AND TRIGGER_NAME='trg_can_venta_bu'`))[0].a);

async function preparar() {
  const pool = await crearBase(BASE, 8);
  await prepararBaseHastaVentas(pool, { dosEmpresas: true });
  await aplicar(pool, 'sql/migrate-2026-11-canecas-simplificacion-wip.sql');
  await pool.query("INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega')");
  const prov = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
  const cli = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente Uno', nit: null, telefono: null, direccion: 'Zona 1' });
  await registrarCompraConIngreso(pool, 1, 1, { proveedorId: prov, ubicacionId: 1, recibidoPorEmpleadoId: 1, cantidad: 10, precio: '80.00', claveOperacion: k(1) });
  const vender = (clave: number, extra: { quienLleva?: string; quienRecibe?: string } = {}) => registrarVenta(pool, 1, 1, { clienteId: cli, ubicacionId: 1, direccionEntrega: 'Zona 4', cantidad: 1, precio: '95.00', claveOperacion: k(clave), ...extra });
  return { pool, vender };
}

describe.skipIf(!socket)('comprobante de venta: instalación manual por etapas en MariaDB 11.8.9 desechable', () => {
  it('sin migrar todo funciona y lo nuevo se rechaza; con las etapas (cualquier base seleccionada, CRLF, repetidas) se instala, el trigger protege las columnas y la anulación sigue funcionando', async () => {
    const { pool, vender } = await preparar();
    try {
      // Sin migrar: venta sin personas funciona; con personas se rechaza sin tocar nada.
      const sin = await vender(10);
      await expect(vender(11, { quienLleva: 'Juan' })).rejects.toThrow('COMPROBANTE_NO_INSTALADO');
      expect((await historialVentas(pool, 1, {}, false))[0]).toMatchObject({ documento: sin.documento, quien_lleva: null, quien_recibe: null });

      // Preflight (solo lectura) desde cualquier contexto: sin DETENER; columnas pendientes.
      for (const [baseDefecto, crlf] of [['', false], ['information_schema', true], ['mysql', false]] as const) {
        const p = ejecutar('01-preflight-solo-lectura', { baseDefecto, crlf });
        expect(p.codigo, p.stderr).toBe(0); expect(detener(p), baseDefecto).toEqual([]);
        expect(dato(p, 'columnas del comprobante presentes')).toBe('0'); expect(dato(p, 'recuento canecas_ventas')).toBe('1');
      }
      const antesTrigger = await triggerBu(pool);
      // Etapa 1 desde information_schema, repetida desde mysql (idempotente).
      expect(ejecutar('02-etapa1-columnas', { baseDefecto: 'information_schema', crlf: true }).codigo).toBe(0);
      expect(ejecutar('02-etapa1-columnas', { baseDefecto: 'mysql' }).codigo).toBe(0);
      const v1 = ejecutar('03-verificar-etapa1-solo-lectura');
      expect(v1.codigo, v1.stderr).toBe(0); expect(detener(v1)).toEqual([]);
      expect(await triggerBu(pool)).toBe(antesTrigger); // la etapa 1 no toca el trigger
      // Etapa 2 (delimitador //) sin base por defecto y repetida con otra base: el trigger queda exacto.
      const e2 = ejecutar('04-etapa2-trigger', { crlf: true }); expect(e2.codigo, e2.stderr).toBe(0);
      expect(ejecutar('04-etapa2-trigger', { baseDefecto: 'information_schema' }).codigo).toBe(0);
      expect(await triggerBu(pool)).toContain('NEW.quien_lleva <=> OLD.quien_lleva');
      for (const [baseDefecto, crlf] of [['', false], ['information_schema', true], ['mysql', false]] as const) {
        const pc = ejecutar('05-postcheck-solo-lectura', { baseDefecto, crlf });
        expect(pc.codigo, pc.stderr).toBe(0); expect(detener(pc), baseDefecto).toEqual([]);
        expect(dato(pc, 'recuento canecas_ventas')).toBe('1');
      }
      const pre = ejecutar('01-preflight-solo-lectura'); expect(detener(pre)).toEqual([]); expect(dato(pre, 'columnas del comprobante presentes')).toBe('2');

      // Con la migración: se guarda, idempotencia por clave, aislamiento por empresa e historial.
      const con = await vender(12, { quienLleva: ' Juan Pérez ', quienRecibe: 'Ana López' });
      expect(await vender(12, { quienLleva: 'Juan Pérez', quienRecibe: 'Ana López' })).toMatchObject({ id: con.id, yaRegistrada: true });
      await expect(vender(12, { quienLleva: 'Otro', quienRecibe: 'Ana López' })).rejects.toThrow('CLAVE_REUTILIZADA');
      expect((await historialVentas(pool, 1, {}, false)).find(v => v.documento === con.documento)).toMatchObject({ quien_lleva: 'Juan Pérez', quien_recibe: 'Ana López' });
      expect(await historialVentas(pool, 2, {}, false)).toEqual([]);
      expect(dato(ejecutar('05-postcheck-solo-lectura'), 'ventas con quien_lleva o quien_recibe')).toBe('1');

      // Inmutabilidad: el trigger protege también las dos columnas (también en ventas históricas) y la anulación sigue funcionando.
      for (const sql of ['UPDATE canecas_ventas SET quien_lleva=\'Otro\' WHERE id=?', 'UPDATE canecas_ventas SET quien_recibe=\'Otro\' WHERE id=?', 'UPDATE canecas_ventas SET quien_lleva=\'Otro\' WHERE id=?']) {
        await expect(pool.query(sql, [con.id])).rejects.toThrow(/CANECAS_VENTA_INMUTABLE/);
      }
      await expect(pool.query("UPDATE canecas_ventas SET quien_recibe='Otro' WHERE id=?", [sin.id])).rejects.toThrow(/CANECAS_VENTA_INMUTABLE/);
      await expect(pool.query('DELETE FROM canecas_ventas WHERE id=?', [con.id])).rejects.toThrow(/CANECAS_VENTA_NO_ELIMINABLE/);
      expect(await anularVenta(pool, 1, 1, String(con.id), 'Error de captura')).toEqual({ yaAnulada: false });
      expect((await historialVentas(pool, 1, {}, false)).find(v => v.documento === con.documento)).toMatchObject({ estado: 'ANULADA', quien_lleva: 'Juan Pérez', quien_recibe: 'Ana López' });
      await expect(pool.query("UPDATE canecas_ventas SET quien_lleva='Otro' WHERE id=?", [con.id])).rejects.toThrow(/CANECAS_VENTA_INMUTABLE/);
    } finally { await pool.end(); }
  }, 240000);

  it('guarda de la etapa 2: sin las columnas no reemplaza el trigger (ni con un cliente que continúa tras el error) y no deja el trigger roto', async () => {
    const { pool, vender } = await preparar();
    try {
      const antes = await triggerBu(pool);
      for (const force of [false, true]) {
        const s = ejecutar('04-etapa2-trigger', { force });
        if (!force) expect(s.codigo).not.toBe(0);
        expect(s.stderr).toMatch(/1242/);
        expect(await triggerBu(pool)).toBe(antes);
      }
      // El preflight y la verificación de la etapa 1 avisan; las ventas normales siguen funcionando con el trigger original.
      expect(detener(ejecutar('03-verificar-etapa1-solo-lectura')).length).toBeGreaterThan(0);
      expect(await vender(20)).toMatchObject({ yaRegistrada: false });
      expect(detener(ejecutar('05-postcheck-solo-lectura')).length).toBeGreaterThan(0);
    } finally { await pool.end(); }
  }, 240000);
});
