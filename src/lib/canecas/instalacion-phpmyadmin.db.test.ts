import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { registrarCompraConIngreso } from './compra-ingreso';
import { registrarVenta } from './ventas';
import { crearCatalogo } from './catalogos';
import { crearBase, instaladorEn, k, prepararBaseHastaVentas, type Fila } from './lab-simplificacion';
import { BASE, DIR_SALIDA } from '../../../scripts/ci/canecas/generar-instalacion-phpmyadmin.mjs';
import { ejecutarSimplificacionControlado } from '../../../scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs';
import { obtenerContratoSimplificacion, verificarContratoSimplificacion } from '../../../scripts/ci/canecas/contrato-simplificacion.mjs';

// Ejecuta los archivos SQL de la instalación manual con el CLIENTE real de MariaDB (equivalente a pegarlos en phpMyAdmin): sin base por defecto
// o con una base distinta seleccionada, con finales de línea CRLF (navegador) y, en la etapa del trigger, con el delimitador `//`.
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const cliente = process.env.CANECAS_LAB_MARIADB ?? 'mariadb';
const ARCHIVOS = ['01-verificar-previo', '02-etapa1-crear-secuencias', '03-verificar-etapa1', '04-etapa2-sembrar-contadores', '05-verificar-etapa2', '06-etapa3-alterar-ventas', '07-verificar-etapa3', '08-etapa4-alterar-productos', '09-verificar-etapa4', '10-etapa5-alterar-compras', '11-verificar-etapa5', '12-etapa6-reemplazar-trigger', '13-verificar-etapa6', '14-verificar-final'];
const contenido = (n: string) => readFileSync(`${DIR_SALIDA}/${n}.sql`, 'utf8');
type Salida = { codigo: number; stdout: string; stderr: string; filas: { verificacion: string; resultado: string }[] };

function ejecutar(nombre: string, { baseDefecto = '', crlf = false, soloLectura = false }: { baseDefecto?: string; crlf?: boolean; soloLectura?: boolean } = {}): Salida {
  let sql = contenido(nombre);
  if (soloLectura) sql = `SET SESSION TRANSACTION READ ONLY;\n${sql}`;
  if (crlf) sql = sql.replace(/\n/g, '\r\n');
  const delimitador = nombre.startsWith('12-') ? ['--delimiter=//'] : [];
  const r = spawnSync(cliente, ['--no-defaults', '--protocol=SOCKET', `--socket=${socket}`, '-uroot', '--batch', ...delimitador, ...(baseDefecto ? [baseDefecto] : [])], { input: sql, encoding: 'utf8', timeout: 120000 });
  const filas: Salida['filas'] = [];
  let enFilas = false;
  for (const linea of r.stdout.split('\n')) {
    if (linea === 'verificacion\tresultado') { enFilas = true; continue; }
    const partes = linea.split('\t');
    if (enFilas && partes.length === 2) filas.push({ verificacion: partes[0], resultado: partes[1] });
    else enFilas = false;
  }
  return { codigo: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, filas };
}
const detener = (s: Salida) => s.filas.filter(f => f.resultado === 'DETENER').map(f => f.verificacion);
const fila = (s: Salida, parte: string) => s.filas.find(f => f.verificacion.includes(parte))?.resultado;
const consulta = async (pool: mysql.Pool, sql: string, p: unknown[] = []) => (await pool.query<Fila[]>(sql, p as never))[0];
const objetos = async (pool: mysql.Pool) => Object.values((await consulta(pool, `SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_secuencias') a,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME IN ('direccion_entrega','doc_auto')) b,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico') c,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto') d,
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='trg_can_venta_bu' AND ACTION_STATEMENT LIKE '%direccion_entrega%') e`))[0]).map(Number);

let historica = 0;
/** Documentos históricos mezclados (huecos, mayúsculas, espacios, formatos distintos) en las empresas 1 y 2. */
async function sembrar(pool: mysql.Pool) {
  await pool.query(`INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (2,2,'Prov B','PROV B');
    INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (2,2,'Bodega B');
    INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (2,2,'Z2','Caneca','Caneca',5,'litros','caneca');
    INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario,activo) VALUES (1,'CAN-000004','Vieja 1','Caneca',5,'litros','caneca',0),(1,'can-9','Vieja 2','Caneca',5,'litros','caneca',0)`);
  for (const [empresa, ref, producto] of [[1, 'COMP-000007', 1], [1, 'comp-12', 1], [1, ' COMP 000020 ', 1], [1, 'COMP000030', 1], [1, 'FAC-9999', 1], [2, 'COMP-000100', 2]] as const) {
    await pool.query("INSERT INTO canecas_compras (empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (?,?,?,?,1,1,?,10000,0,'GTQ')", [empresa, empresa, ref, producto, `hist-${++historica}`]);
  }
  const cli = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente', nit: null, telefono: null, direccion: null });
  let n = 0;
  for (const doc of ['VTA-000015', 'vta-20', 'VTA 000009', 'FAC-1', 'VTA-000002']) await registrarVenta(pool, 1, 1, { clienteId: cli, productoId: 1, ubicacionId: 1, fechaVenta: '2026-11-10', documento: doc, cantidad: 1, precio: '95.00', claveOperacion: k(++n) }, '2026-11-24');
  return cli;
}
const preparar = async (nombre: string) => { const pool = await crearBase(nombre, 8); await prepararBaseHastaVentas(pool, { historial: true, dosEmpresas: true }); const cli = await sembrar(pool); return { pool, cli }; };

describe.skipIf(!socket)('instalación manual por etapas (archivos SQL como en phpMyAdmin) en MariaDB 11.8.9 desechable', () => {
  it('las 14 etapas en orden, con distinta base seleccionada y CRLF: sin DETENER, idéntica a la instalación oficial y numeración intacta', async () => {
    const manual = await preparar(BASE);
    const oficial = await preparar('canecas_simp_phpm_ref');
    try {
      expect(await instaladorEn(oficial.pool, c => ejecutarSimplificacionControlado(c))).toEqual({ instalado: true, yaInstalado: false });
      const antes = Object.fromEntries(await Promise.all(['canecas_ventas', 'canecas_productos', 'canecas_compras', 'canecas_saldos', 'canecas_movimientos', 'canecas_capas_costo'].map(async t => [t, (await consulta(manual.pool, `SELECT COUNT(*) n FROM \`${t}\``))[0].n])));
      const contextos = ['', 'information_schema', 'mysql', ''];
      for (const [i, nombre] of ARCHIVOS.entries()) {
        const esVerificacion = nombre.includes('verificar');
        const s = ejecutar(nombre, { baseDefecto: contextos[i % contextos.length], crlf: i % 3 === 0, soloLectura: esVerificacion });
        expect(s.codigo, `${nombre}\n${s.stderr}`).toBe(0);
        expect(detener(s), nombre).toEqual([]);
        if (esVerificacion) expect(s.filas.length, nombre).toBeGreaterThan(0);
        // Estado del esquema tras cada etapa de escritura: avanza exactamente un paso.
        if (nombre === '02-etapa1-crear-secuencias') expect(await objetos(manual.pool)).toEqual([1, 0, 0, 0, 0]);
        if (nombre === '06-etapa3-alterar-ventas') expect(await objetos(manual.pool)).toEqual([1, 2, 0, 0, 0]);
        if (nombre === '08-etapa4-alterar-productos') expect(await objetos(manual.pool)).toEqual([1, 2, 1, 0, 0]);
        if (nombre === '10-etapa5-alterar-compras') expect(await objetos(manual.pool)).toEqual([1, 2, 1, 1, 0]);
        if (nombre === '12-etapa6-reemplazar-trigger') expect(await objetos(manual.pool)).toEqual([1, 2, 1, 1, 1]);
        if (nombre === '14-verificar-final') {
          expect(s.filas.filter(f => f.verificacion.startsWith('contrato ')).every(f => f.resultado === 'OK')).toBe(true);
          expect(s.filas.filter(f => f.verificacion.startsWith('contrato ')).length).toBe(20); // 4 tablas x 5 secciones
          expect(fila(s, 'empresas sin contador completo')).toBe('0');
          expect(fila(s, 'siguientes numeros ya en uso')).toBe('0');
        }
      }
      // Contadores sembrados con el máximo histórico por empresa (sin rellenar huecos).
      const contadores = Object.fromEntries((await consulta(manual.pool, 'SELECT empresa_id,tipo,ultimo FROM canecas_secuencias')).map(f => [`${f.empresa_id}:${f.tipo}`, Number(f.ultimo)]));
      expect(contadores).toEqual({ '1:COMPRA': 30, '1:PRODUCTO': 9, '1:VENTA': 20, '2:COMPRA': 100, '2:PRODUCTO': 0, '2:VENTA': 0 });
      // Misma estructura exacta que la instalación oficial y que el contrato versionado.
      const contratoManual = await instaladorEn(manual.pool, c => obtenerContratoSimplificacion(c)), contratoOficial = await instaladorEn(oficial.pool, c => obtenerContratoSimplificacion(c));
      expect(contratoManual).toEqual(contratoOficial);
      await expect(instaladorEn(manual.pool, c => verificarContratoSimplificacion(c))).resolves.toBeUndefined();
      expect(await consulta(manual.pool, 'SELECT empresa_id,tipo,ultimo FROM canecas_secuencias ORDER BY 1,2')).toEqual(await consulta(oficial.pool, 'SELECT empresa_id,tipo,ultimo FROM canecas_secuencias ORDER BY 1,2'));
      // Datos intactos y sin direcciones inventadas.
      const despues = Object.fromEntries(await Promise.all(['canecas_ventas', 'canecas_productos', 'canecas_compras', 'canecas_saldos', 'canecas_movimientos', 'canecas_capas_costo'].map(async t => [t, (await consulta(manual.pool, `SELECT COUNT(*) n FROM \`${t}\``))[0].n])));
      expect(despues).toEqual(antes);
      expect(Number((await consulta(manual.pool, 'SELECT COUNT(*) n FROM canecas_ventas WHERE direccion_entrega IS NOT NULL'))[0].n)).toBe(0);
      // La numeración automática y la venta POS funcionan sobre lo instalado a mano: continúan tras el máximo histórico.
      const prov = await crearCatalogo(manual.pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
      expect((await registrarCompraConIngreso(manual.pool, 1, 1, { proveedorId: prov, ubicacionId: 1, recibidoPorEmpleadoId: 1, cantidad: 2, precio: '50.00', claveOperacion: k(900) })).referencia).toBe('COMP-000031');
      expect((await registrarVenta(manual.pool, 1, 1, { clienteId: manual.cli, ubicacionId: 1, direccionEntrega: 'Zona 4', cantidad: 1, precio: '120.00', claveOperacion: k(901) })).documento).toBe('VTA-000021');
      await expect(manual.pool.query("UPDATE canecas_ventas SET direccion_entrega='x' WHERE direccion_entrega IS NOT NULL")).rejects.toThrow('CANECAS_VENTA_INMUTABLE'); // el trigger instalado a mano protege la dirección
    } finally { await manual.pool.end(); await oficial.pool.end(); }
  }, 300000);

  it('guardas: una etapa fuera de orden o repetida falla con el error 1242 y no cambia nada', async () => {
    const { pool } = await preparar(BASE);
    try {
      const base = await objetos(pool);
      for (const nombre of ['04-etapa2-sembrar-contadores', '06-etapa3-alterar-ventas', '08-etapa4-alterar-productos', '10-etapa5-alterar-compras', '12-etapa6-reemplazar-trigger']) {
        const s = ejecutar(nombre);
        expect(s.codigo, nombre).not.toBe(0);
        expect(s.stderr, nombre).toMatch(/1242/);
        expect(await objetos(pool), nombre).toEqual(base);
      }
      expect(ejecutar('02-etapa1-crear-secuencias').codigo).toBe(0);
      const repetida = ejecutar('02-etapa1-crear-secuencias'); // segunda vez: la guarda lo impide
      expect(repetida.codigo).not.toBe(0); expect(repetida.stderr).toMatch(/1242/);
      expect(await objetos(pool)).toEqual([1, 0, 0, 0, 0]);
      // Salto de etapa: con solo la 1 aplicada, la 3 (ventas) sigue bloqueada porque faltan los contadores sembrados.
      expect(ejecutar('06-etapa3-alterar-ventas').stderr).toMatch(/1242/);
      expect(await objetos(pool)).toEqual([1, 0, 0, 0, 0]);
      // Estado previo dañado: sin uno de los triggers de ventas, la etapa 1 no corre.
      await pool.query('DROP TABLE canecas_secuencias; DROP TRIGGER trg_can_venta_bd');
      expect(ejecutar('02-etapa1-crear-secuencias').stderr).toMatch(/1242/);
      expect((await objetos(pool))[0]).toBe(0);
    } finally { await pool.end(); }
  }, 240000);

  it('las verificaciones detectan alteraciones del esquema instalado (columna extra, trigger faltante o modificado) y el preflight detecta bloqueos', async () => {
    const { pool } = await preparar(BASE);
    try {
      expect(detener(ejecutar('01-verificar-previo'))).toEqual([]);
      await pool.query("INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,'B','Otra','Caneca',5,'litros','caneca')");
      expect(detener(ejecutar('01-verificar-previo'))).toContain('ninguna empresa con mas de una caneca activa');
      // Con dos canecas activas el ALTER de la etapa 4 falla por sí mismo (clave duplicada) sin dejar nada a medias.
      for (const n of ['02-etapa1-crear-secuencias', '04-etapa2-sembrar-contadores', '06-etapa3-alterar-ventas']) expect(ejecutar(n).codigo, n).toBe(0);
      const falla = ejecutar('08-etapa4-alterar-productos');
      expect(falla.codigo).not.toBe(0); expect(falla.stderr).toMatch(/1062|Duplicate/i);
      expect((await objetos(pool))[2]).toBe(0);
      await pool.query("UPDATE canecas_productos SET activo=0 WHERE codigo='B'");
      for (const n of ['08-etapa4-alterar-productos', '10-etapa5-alterar-compras', '12-etapa6-reemplazar-trigger']) expect(ejecutar(n).codigo, n).toBe(0);
      expect(detener(ejecutar('14-verificar-final', { soloLectura: true }))).toEqual([]);
      // Alteraciones posteriores: columna extra, trigger de borrado ausente y trigger de actualización modificado.
      await pool.query('ALTER TABLE canecas_ventas ADD COLUMN intruso INT NULL');
      expect(detener(ejecutar('14-verificar-final', { soloLectura: true }))).toEqual(expect.arrayContaining(['contrato columnas de canecas_ventas (huella exacta)']));
      await pool.query('ALTER TABLE canecas_ventas DROP COLUMN intruso; DROP TRIGGER trg_can_venta_bd');
      expect(detener(ejecutar('13-verificar-etapa6'))).toEqual(['trigger trg_can_venta_bd exacto (tiempo, evento, tabla y cuerpo normalizado)']);
      await pool.query("CREATE TRIGGER trg_can_venta_bd BEFORE DELETE ON canecas_ventas FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_NO_ELIMINABLE'; END");
      expect(detener(ejecutar('13-verificar-etapa6'))).toEqual([]);
      await pool.query("CREATE OR REPLACE TRIGGER trg_can_venta_bu BEFORE UPDATE ON canecas_ventas FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OTRO'; END");
      expect(detener(ejecutar('13-verificar-etapa6'))).toEqual(['trigger trg_can_venta_bu exacto (tiempo, evento, tabla y cuerpo normalizado)']);
    } finally { await pool.end(); }
  }, 240000);
});
