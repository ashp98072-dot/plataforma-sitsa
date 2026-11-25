import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { crearBase, hayLaboratorio, instaladorEn, opciones, prepararBaseHastaVentas, type Fila } from './lab-simplificacion';
import { diagnosticarPrevio, formatearDiagnostico } from '../../../scripts/ci/canecas/diagnostico-previo-simplificacion.mjs';
import { ejecutarSimplificacionControlado } from '../../../scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs';

type Resultado = Awaited<ReturnType<typeof diagnosticarPrevio>>;
const ESCRITURA = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|RENAME)\b/i;
/** Ejecuta el diagnóstico con una conexión que registra todo el SQL enviado. */
async function diagnosticar(pool: mysql.Pool) {
  const conn = await pool.getConnection();
  const sqls: string[] = [];
  const original = conn.query.bind(conn) as (...a: unknown[]) => Promise<unknown>;
  (conn as unknown as { query: unknown }).query = (...a: unknown[]) => { sqls.push(String(typeof a[0] === 'string' ? a[0] : (a[0] as { sql: string }).sql)); return original(...a); };
  try {
    const r: Resultado = await diagnosticarPrevio(conn as never);
    const [ro] = await original('SELECT @@SESSION.tx_read_only AS ro') as [Fila[]];
    return { r, sqls, roAlTerminar: Number(ro[0].ro) };
  } finally { conn.release(); }
}
const huella = async (pool: mysql.Pool) => {
  const tablas = (await pool.query<Fila[]>("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY 1"))[0].map(f => String(f.t));
  const datos = Object.fromEntries(await Promise.all(tablas.map(async t => [t, (await pool.query<Fila[]>(`SELECT * FROM \`${t}\``))[0]])));
  const esquema = (await pool.query<Fila[]>("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY 1,2"))[0];
  const triggers = (await pool.query<Fila[]>("SELECT TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY 1"))[0];
  return { tablas, datos, esquema, triggers };
};
const por = (r: Resultado, parte: string) => r.comprobaciones.find(c => c.nombre.includes(parte));
const fallos = (r: Resultado) => r.comprobaciones.filter(c => c.estado === 'FALLO').map(c => c.nombre);

describe.skipIf(!hayLaboratorio)('diagnóstico previo de solo lectura en MariaDB 11.8.9 desechable', () => {
  it('el servidor impone el solo lectura de la sesión (el mecanismo en el que se apoya el diagnóstico)', async () => {
    const pool = await crearBase('canecas_simp_diag_ro', 4);
    try {
      await pool.query('CREATE TABLE t (id INT)');
      const c = await mysql.createConnection(opciones('canecas_simp_diag_ro'));
      try {
        await c.query('SET SESSION TRANSACTION READ ONLY');
        expect(Number((await c.query<Fila[]>('SELECT @@SESSION.tx_read_only ro'))[0][0].ro)).toBe(1);
        await expect(c.query('INSERT INTO t VALUES (1)')).rejects.toThrow(/read.only/i);
        await expect(c.query('CREATE TABLE u (id INT)')).rejects.toThrow(/read.only/i);
      } finally { await c.end(); }
    } finally { await pool.end(); }
  }, 60000);

  it('esquema previo correcto (cadena completa instalada): sin fallos, 17 tablas, preflight 22 OK y NADA cambia', async () => {
    const pool = await crearBase('canecas_simp_diag_a', 8);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      const antes = await huella(pool);
      const { r, sqls, roAlTerminar } = await diagnosticar(pool);
      expect(fallos(r)).toEqual([]);
      expect(r.falla).toBe(false);
      expect(por(r, 'Las 17 tablas')!.detalle).toContain('17 esperadas presentes');
      expect(por(r, 'Estado de la simplificación')!.detalle).toContain('ausente');
      for (const parte of ['Contrato de redistribución', 'Criterio FIFO', 'Contrato de catálogos', 'Contrato de ventas anterior', 'Preflight', 'Privilegios', 'Versión']) expect(por(r, parte)!.estado, parte).toBe('OK');
      expect(r.comprobaciones.filter(c => c.nombre.startsWith('  ·') && c.estado === 'OK')).toHaveLength(r.comprobaciones.filter(c => c.nombre.startsWith('  ·') && c.estado !== 'INFO').length);
      expect(formatearDiagnostico(r)).toContain('RESULTADO: SIN BLOQUEOS');
      // Solo lectura: ninguna sentencia de escritura, sesión restaurada y base idéntica (datos, esquema y triggers).
      expect(sqls.filter(s => ESCRITURA.test(s))).toEqual([]);
      expect(roAlTerminar).toBe(0);
      expect(await huella(pool)).toEqual(antes);
    } finally { await pool.end(); }
  }, 180000);

  it('un esquema previo dañado se informa por contrato sin detener las demás comprobaciones ni modificar nada', async () => {
    const pool = await crearBase('canecas_simp_diag_b', 8);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      await pool.query('DROP TRIGGER trg_can_venta_bd');
      await pool.query('ALTER TABLE canecas_clientes ADD COLUMN intruso INT NULL');
      const antes = await huella(pool);
      const { r, sqls } = await diagnosticar(pool);
      expect(r.falla).toBe(true);
      expect(por(r, 'Contrato de ventas anterior')).toMatchObject({ estado: 'FALLO' });
      expect(por(r, 'Contrato de catálogos')).toMatchObject({ estado: 'FALLO' });
      expect(por(r, 'Contrato de redistribución')!.estado).toBe('OK'); // el resto se evalúa igual
      expect(por(r, 'Criterio FIFO')!.estado).toBe('OK');
      expect(por(r, 'Preflight')!.estado).toBe('FALLO'); // el preflight también detecta los triggers de ventas faltantes
      expect(formatearDiagnostico(r)).toContain('RESULTADO: BLOQUEADO');
      expect(sqls.filter(s => ESCRITURA.test(s))).toEqual([]);
      expect(await huella(pool)).toEqual(antes);
    } finally { await pool.end(); }
  }, 180000);

  it('preflight en DETENER (dos canecas activas en una empresa) y estado parcial se informan', async () => {
    const pool = await crearBase('canecas_simp_diag_c', 8);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      await pool.query("INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,'B','Otra','Caneca',5,'litros','caneca')");
      const { r } = await diagnosticar(pool);
      expect(por(r, 'Preflight')!.detalle).toContain('ninguna empresa con más de una caneca activa');
      expect(r.falla).toBe(true);
      await pool.query('UPDATE canecas_productos SET activo=0 WHERE codigo=?', ['B']);
      await pool.query('CREATE TABLE canecas_secuencias (empresa_id INT NOT NULL, tipo VARCHAR(20) NOT NULL, ultimo BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (empresa_id,tipo)) ENGINE=InnoDB');
      const parcial = (await diagnosticar(pool)).r;
      expect(por(parcial, 'Estado de la simplificación')).toMatchObject({ estado: 'FALLO' });
      expect(por(parcial, 'Estado de la simplificación')!.detalle).toContain('recuperacion-canecas-simplificacion-solo-lectura.sql');
    } finally { await pool.end(); }
  }, 180000);

  it('tras instalar la simplificación omite los contratos anteriores de catálogos y ventas, verifica el nuevo y el postcheck (15) sin fallos', async () => {
    const pool = await crearBase('canecas_simp_diag_d', 8);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      expect(await instaladorEn(pool, c => ejecutarSimplificacionControlado(c))).toEqual({ instalado: true, yaInstalado: false });
      const antes = await huella(pool);
      const { r, sqls } = await diagnosticar(pool);
      expect(fallos(r)).toEqual([]);
      expect(por(r, 'Estado de la simplificación')!.detalle).toContain('completa');
      expect(por(r, 'Contrato de ventas ANTERIOR')!.estado).toBe('OMITIDA');
      expect(por(r, 'Contrato de catálogos ANTERIOR')!.estado).toBe('OMITIDA');
      expect(por(r, 'Contrato de redistribución')!.estado).toBe('OK'); // este sigue vigente tras la simplificación
      expect(por(r, 'Contrato de simplificación')!.estado).toBe('OK');
      expect(por(r, 'Postcheck')!.estado).toBe('OK');
      expect(sqls.filter(s => ESCRITURA.test(s))).toEqual([]);
      expect(await huella(pool)).toEqual(antes);
    } finally { await pool.end(); }
  }, 180000);
});
