import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { registrarCompraConIngreso } from './compra-ingreso';
import { registrarVenta } from './ventas';
import { crearCatalogo } from './catalogos';
import { crearBase, instaladorEn, k, prepararBaseHastaVentas, type Fila } from './lab-simplificacion';
import { BASE, DIR_SALIDA, PROLOGO_MODOS } from '../../../scripts/ci/canecas/generar-instalacion-phpmyadmin.mjs';
import { ejecutarSimplificacionControlado } from '../../../scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs';
import { obtenerContratoSimplificacion, verificarContratoSimplificacion } from '../../../scripts/ci/canecas/contrato-simplificacion.mjs';

// Ejecuta los archivos SQL de la instalación manual con el CLIENTE real de MariaDB (equivalente a pegarlos en phpMyAdmin): sin base por defecto
// o con una base distinta seleccionada, con finales de línea CRLF (navegador) y, en la etapa del trigger, con el delimitador `//`.
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const cliente = process.env.CANECAS_LAB_MARIADB ?? 'mariadb';
// Hostinger/phpMyAdmin: sql_mode sin modo estricto e innodb_strict_mode=0 al abrir la sesion (lo observado en produccion).
const SESION_HOSTINGER = "SET SESSION sql_mode='NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', innodb_strict_mode=0";
const MODO_HOSTINGER = 'NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION';
const ARCHIVOS = ['01-verificar-previo', '02-etapa1-crear-secuencias', '03-verificar-etapa1', '04-etapa2-sembrar-contadores', '05-verificar-etapa2', '06-etapa3-alterar-ventas', '07-verificar-etapa3', '08-etapa4-alterar-productos', '09-verificar-etapa4', '10-etapa5-alterar-compras', '11-verificar-etapa5', '12-etapa6-reemplazar-trigger', '13-verificar-etapa6', '14-verificar-final'];
const contenido = (n: string) => readFileSync(`${DIR_SALIDA}/${n}.sql`, 'utf8');
type Salida = { codigo: number; stdout: string; stderr: string; filas: { verificacion: string; resultado: string }[] };
type Opc = { baseDefecto?: string; crlf?: boolean; soloLectura?: boolean; initCommand?: string; force?: boolean; showWarnings?: boolean; texto?: string; anexo?: string; archivoOriginal?: string };

function ejecutar(nombre: string, { baseDefecto = '', crlf = false, soloLectura = false, initCommand = '', force = false, showWarnings = false, texto, anexo, archivoOriginal }: Opc = {}): Salida {
  let sql = texto ?? (archivoOriginal ? readFileSync(archivoOriginal, 'utf8') : contenido(nombre));
  const delimitador = nombre.startsWith('12-');
  if (anexo) sql = `${sql}\n${anexo}${delimitador ? '//' : ';'}\n`;
  if (soloLectura) sql = `SET SESSION TRANSACTION READ ONLY;\n${sql}`;
  if (crlf) sql = sql.replace(/\n/g, '\r\n');
  const args = ['--no-defaults', '--protocol=SOCKET', `--socket=${socket}`, '-uroot', '--batch', ...(delimitador ? ['--delimiter=//'] : []), ...(initCommand ? [`--init-command=${initCommand}`] : []), ...(force ? ['--force'] : []), ...(showWarnings ? ['--show-warnings'] : []), ...(baseDefecto ? [baseDefecto] : [])];
  const r = spawnSync(cliente, args, { input: sql, encoding: 'utf8', timeout: 120000 });
  const filas: Salida['filas'] = tabla(r.stdout, 'verificacion\tresultado').map(([verificacion, resultado]) => ({ verificacion, resultado }));
  return { codigo: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, filas };
}
/** Filas de la salida --batch cuyo encabezado es exactamente `cabecera` (columnas separadas por tab). */
function tabla(stdout: string, cabecera: string) {
  const n = cabecera.split('\t').length, filas: string[][] = [];
  let dentro = false;
  for (const linea of stdout.split('\n')) {
    if (linea === cabecera) { dentro = true; continue; }
    const partes = linea.split('\t');
    if (dentro && partes.length === n) filas.push(partes); else dentro = false;
  }
  return filas;
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

const esVerificacion = (n: string) => n.includes('verificar');
const esEscritura = (n: string) => /^\d+-etapa\d/.test(n);
const ANEXO_MODOS = 'SELECT @@SESSION.sql_mode AS modo, @@SESSION.innodb_strict_mode AS estricto';
const sinPrologo = (n: string) => PROLOGO_MODOS.reduce((t, linea) => t.replace(`${linea}${n.startsWith('12-') ? '//' : ';'}\n`, ''), contenido(n));

describe.skipIf(!socket)('instalación manual por etapas (archivos SQL como en phpMyAdmin) en MariaDB 11.8.9 desechable', () => {
  it('sesión estilo Hostinger (sin modo estricto): las 14 etapas en orden, con distinta base seleccionada y CRLF, sin DETENER ni advertencias; modos restaurados; idéntica a la instalación oficial', async () => {
    const manual = await preparar(BASE);
    const oficial = await preparar('canecas_simp_phpm_ref');
    try {
      expect(await instaladorEn(oficial.pool, c => ejecutarSimplificacionControlado(c))).toEqual({ instalado: true, yaInstalado: false });
      const tablasDatos = ['canecas_ventas', 'canecas_productos', 'canecas_compras', 'canecas_saldos', 'canecas_movimientos', 'canecas_capas_costo'];
      const conteos = async () => Object.fromEntries(await Promise.all(tablasDatos.map(async t => [t, (await consulta(manual.pool, `SELECT COUNT(*) n FROM \`${t}\``))[0].n])));
      const antes = await conteos();
      const contextos = ['', 'information_schema', 'mysql', ''];
      for (const [i, nombre] of ARCHIVOS.entries()) {
        const s = ejecutar(nombre, { baseDefecto: contextos[i % contextos.length], crlf: i % 3 === 0, soloLectura: esVerificacion(nombre), initCommand: SESION_HOSTINGER, showWarnings: true, anexo: esEscritura(nombre) ? ANEXO_MODOS : undefined });
        expect(s.codigo, `${nombre}\n${s.stderr}`).toBe(0);
        expect(detener(s), nombre).toEqual([]);
        expect(`${s.stdout}${s.stderr}`, `${nombre}: advertencias`).not.toMatch(/Level\tCode/); // cero advertencias (SHOW WARNINGS vacio y --show-warnings sin salida)
        if (esVerificacion(nombre)) expect(s.filas.length, nombre).toBeGreaterThan(0);
        // Modos de sesion restaurados al terminar (la sesion de Hostinger era no estricta).
        if (esEscritura(nombre)) expect(tabla(s.stdout, 'modo\testricto'), nombre).toEqual([[MODO_HOSTINGER, '0']]);
        if (nombre === '02-etapa1-crear-secuencias') expect(await objetos(manual.pool)).toEqual([1, 0, 0, 0, 0]);
        if (nombre === '06-etapa3-alterar-ventas') expect(await objetos(manual.pool)).toEqual([1, 2, 0, 0, 0]);
        if (nombre === '08-etapa4-alterar-productos') expect(await objetos(manual.pool)).toEqual([1, 2, 1, 0, 0]);
        if (nombre === '10-etapa5-alterar-compras') expect(await objetos(manual.pool)).toEqual([1, 2, 1, 1, 0]);
        if (nombre === '12-etapa6-reemplazar-trigger') expect(await objetos(manual.pool)).toEqual([1, 2, 1, 1, 1]);
        if (nombre === '14-verificar-final') {
          expect(s.filas.filter(f => f.verificacion.startsWith('contrato ')).length).toBe(20); // 4 tablas x 5 secciones
          expect(s.filas.filter(f => f.verificacion.startsWith('contrato ')).every(f => f.resultado === 'OK')).toBe(true);
          expect(fila(s, 'empresas sin contador completo')).toBe('0');
          expect(fila(s, 'siguientes numeros ya en uso')).toBe('0');
        }
      }
      const contadores = Object.fromEntries((await consulta(manual.pool, 'SELECT empresa_id,tipo,ultimo FROM canecas_secuencias')).map(f => [`${f.empresa_id}:${f.tipo}`, Number(f.ultimo)]));
      expect(contadores).toEqual({ '1:COMPRA': 30, '1:PRODUCTO': 9, '1:VENTA': 20, '2:COMPRA': 100, '2:PRODUCTO': 0, '2:VENTA': 0 });
      const contratoManual = await instaladorEn(manual.pool, c => obtenerContratoSimplificacion(c)), contratoOficial = await instaladorEn(oficial.pool, c => obtenerContratoSimplificacion(c));
      expect(contratoManual).toEqual(contratoOficial);
      await expect(instaladorEn(manual.pool, c => verificarContratoSimplificacion(c))).resolves.toBeUndefined();
      expect(await consulta(manual.pool, 'SELECT empresa_id,tipo,ultimo FROM canecas_secuencias ORDER BY 1,2')).toEqual(await consulta(oficial.pool, 'SELECT empresa_id,tipo,ultimo FROM canecas_secuencias ORDER BY 1,2'));
      expect(await conteos()).toEqual(antes);
      expect(Number((await consulta(manual.pool, 'SELECT COUNT(*) n FROM canecas_ventas WHERE direccion_entrega IS NOT NULL'))[0].n)).toBe(0);
      // El resultado final es el mismo que con sesion estricta por defecto: la numeracion y la venta POS funcionan sobre lo instalado a mano.
      const prov = await crearCatalogo(manual.pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
      expect((await registrarCompraConIngreso(manual.pool, 1, 1, { proveedorId: prov, ubicacionId: 1, recibidoPorEmpleadoId: 1, cantidad: 2, precio: '50.00', claveOperacion: k(900) })).referencia).toBe('COMP-000031');
      expect((await registrarVenta(manual.pool, 1, 1, { clienteId: manual.cli, ubicacionId: 1, direccionEntrega: 'Zona 4', cantidad: 1, precio: '120.00', claveOperacion: k(901) })).documento).toBe('VTA-000021');
      await expect(manual.pool.query("UPDATE canecas_ventas SET direccion_entrega='x' WHERE direccion_entrega IS NOT NULL")).rejects.toThrow('CANECAS_VENTA_INMUTABLE');
    } finally { await manual.pool.end(); await oficial.pool.end(); }
  }, 300000);

  it('modos estrictos: sin ellos (o con FK/CHECK desactivados en la sesión) la DDL no se ejecuta; con sesión estricta por defecto el resultado es el mismo', async () => {
    const { pool } = await preparar(BASE);
    try {
      const base = await objetos(pool);
      // (a) El prologo es lo que activa los modos: sin el, en una sesion no estricta la condicion falla y no hay DDL (error 1242).
      for (const n of ['02-etapa1-crear-secuencias']) { const s = ejecutar(n, { initCommand: SESION_HOSTINGER, texto: sinPrologo(n) }); expect(s.codigo, n).not.toBe(0); expect(s.stderr).toMatch(/1242/); expect(await objetos(pool)).toEqual(base); }
      // (b) Claves foraneas o CHECK desactivados en la sesion: el archivo NO los reactiva (no los toca) y no ejecuta la DDL.
      for (const init of ['SET SESSION foreign_key_checks=0', 'SET SESSION check_constraint_checks=0']) {
        const s = ejecutar('02-etapa1-crear-secuencias', { initCommand: init }); expect(s.codigo, init).not.toBe(0); expect(s.stderr, init).toMatch(/1242/);
        expect((await objetos(pool))[0], init).toBe(0);
      }
      // (c) Con ambos desactivados y un cliente que continua tras el error (--force) la DDL tampoco existe.
      ejecutar('02-etapa1-crear-secuencias', { initCommand: 'SET SESSION foreign_key_checks=0', force: true });
      expect((await objetos(pool))[0]).toBe(0);
      // (d) Sesion estricta por defecto: tambien funciona y deja los modos como estaban.
      const estricta = ejecutar('02-etapa1-crear-secuencias', { anexo: ANEXO_MODOS, showWarnings: true, initCommand: "SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', innodb_strict_mode=1" });
      expect(estricta.codigo, estricta.stderr).toBe(0);
      const [[modoDespues, innoDespues]] = tabla(estricta.stdout, 'modo\testricto');
      expect(modoDespues).toMatch(/STRICT_TRANS_TABLES/); expect(innoDespues).toBe('1');
      expect(await objetos(pool)).toEqual([1, 0, 0, 0, 0]);
    } finally { await pool.end(); }
  }, 240000);

  it('guardas intrínsecas: una etapa 1-5 fuera de orden o repetida no cambia NADA, ni siquiera con un cliente que continúa tras el error (--force)', async () => {
    const { pool } = await preparar(BASE);
    try {
      const base = await objetos(pool);
      for (const force of [false, true]) {
        for (const nombre of ['04-etapa2-sembrar-contadores', '06-etapa3-alterar-ventas', '08-etapa4-alterar-productos', '10-etapa5-alterar-compras']) {
          const s = ejecutar(nombre, { force, initCommand: SESION_HOSTINGER });
          if (!force) { expect(s.codigo, nombre).not.toBe(0); }
          expect(s.stderr, nombre).toMatch(/1242|1146/);
          expect(await objetos(pool), `${nombre} force=${force}`).toEqual(base);
        }
      }
      expect(ejecutar('02-etapa1-crear-secuencias').codigo).toBe(0);
      for (const force of [false, true]) {
        const repetida = ejecutar('02-etapa1-crear-secuencias', { force });
        expect(repetida.stderr).toMatch(/1242/);
        for (const nombre of ['06-etapa3-alterar-ventas', '08-etapa4-alterar-productos', '10-etapa5-alterar-compras']) { ejecutar(nombre, { force }); expect(await objetos(pool), `${nombre} force=${force}`).toEqual([1, 0, 0, 0, 0]); }
      }
      // Estado previo danado: sin uno de los triggers de ventas, la etapa 1 no corre (incluso con --force).
      await pool.query('DROP TABLE canecas_secuencias; DROP TRIGGER trg_can_venta_bd');
      ejecutar('02-etapa1-crear-secuencias', { force: true });
      expect((await objetos(pool))[0]).toBe(0);
      // La etapa 6 (trigger) tambien tiene guarda intrinseca: con el prerequisito incumplido no reemplaza el trigger, ni siquiera con --force.
      await pool.query("CREATE TRIGGER trg_can_venta_bd BEFORE DELETE ON canecas_ventas FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_NO_ELIMINABLE'; END");
      const antesTrigger = (await consulta(pool, "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='trg_can_venta_bu'"))[0].ACTION_STATEMENT;
      for (const force of [false, true]) {
        const seis = ejecutar('12-etapa6-reemplazar-trigger', { force, initCommand: SESION_HOSTINGER });
        if (!force) expect(seis.codigo).not.toBe(0);
        expect(seis.stderr).toMatch(/1242|1146/);
        expect((await consulta(pool, "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='trg_can_venta_bu'"))[0].ACTION_STATEMENT).toBe(antesTrigger);
      }
    } finally { await pool.end(); }
  }, 240000);

  it('MariaDB 11.8.9 admite CREATE TRIGGER dentro de PREPARE/EXECUTE (la etapa 6 tiene guarda intrínseca) y la prueba de errores distingue clientes que paran o continúan', async () => {
    const { pool } = await preparar(BASE);
    try {
      // Exploración: ¿acepta MariaDB 11.8.9 CREATE TRIGGER dentro de PREPARE/EXECUTE? (el resultado queda en el log de CI)
      const sondaPs: string[] = [];
      for (const sql of ["PREPARE p FROM 'CREATE OR REPLACE TRIGGER trg_sonda BEFORE UPDATE ON canecas_ventas FOR EACH ROW SET @x = 1'", 'EXECUTE p', 'DEALLOCATE PREPARE p']) {
        try { await pool.query(sql); sondaPs.push(`${sql.slice(0, 12)}: ok`); } catch (e) { sondaPs.push(`${sql.slice(0, 12)}: errno ${(e as { errno?: number }).errno}`); }
      }
      expect(sondaPs.every(x => x.endsWith(': ok')), sondaPs.join(' | ')).toBe(true);
      const para = ejecutar('00-prueba-comportamiento-errores-solo-lectura', { soloLectura: true });
      expect(para.codigo).not.toBe(0); expect(para.stderr).toMatch(/1242/);
      expect(para.stdout).toContain('ANTES DEL ERROR'); expect(para.stdout).not.toContain('DESPUES DEL ERROR');
      const continua = ejecutar('00-prueba-comportamiento-errores-solo-lectura', { soloLectura: true, force: true });
      expect(continua.stdout).toContain('DESPUES DEL ERROR');
    } finally { await pool.end(); }
  }, 120000);

  it('recuperación (hallazgo 1): funciona sin base por defecto y con information_schema/mysql seleccionadas, informa el estado por etapa y el archivo original falla en ese contexto', async () => {
    const { pool } = await preparar(BASE);
    try {
      const estados = (s: Salida) => Object.fromEntries(tabla(s.stdout, 'etapa\testado').map(([e, v]) => [e.split(':')[0], v]));
      const ausentes = { 'etapa 1': 'ausente', 'etapa 3': 'ausente', 'etapa 4': 'ausente', 'etapa 5': 'ausente', 'etapa 6': 'ausente' };
      for (const baseDefecto of ['', 'information_schema', 'mysql', BASE]) {
        const s = ejecutar('15-recuperacion-solo-lectura', { baseDefecto, soloLectura: true });
        expect(estados(s), `ctx=${baseDefecto}`).toEqual(ausentes);
        expect(s.stderr, `ctx=${baseDefecto}`).toMatch(/1146/); // la ultima consulta (contadores) falla A PROPOSITO si la etapa 1 no existe
        expect(s.stdout).toContain(BASE);
      }
      // Control negativo: el diagnostico ORIGINAL usa DATABASE() y tablas sin calificar; con information_schema seleccionada no sirve.
      const original = 'sql/recuperacion-canecas-simplificacion-solo-lectura.sql';
      const roto = ejecutar('15-original', { baseDefecto: 'information_schema', archivoOriginal: original });
      expect(roto.codigo).not.toBe(0); expect(roto.stderr).toMatch(/ERROR 11(09|46)|doesn't exist|Unknown table/i);
      // Avance por etapas: cada archivo de escritura cambia exactamente su fila.
      expect(ejecutar('02-etapa1-crear-secuencias').codigo).toBe(0);
      expect(estados(ejecutar('15-recuperacion-solo-lectura', { baseDefecto: 'information_schema', soloLectura: true }))).toEqual({ ...ausentes, 'etapa 1': 'presente' });
      for (const n of ['04-etapa2-sembrar-contadores', '06-etapa3-alterar-ventas', '08-etapa4-alterar-productos', '10-etapa5-alterar-compras', '12-etapa6-reemplazar-trigger']) expect(ejecutar(n).codigo, n).toBe(0);
      const final = ejecutar('15-recuperacion-solo-lectura', { baseDefecto: 'information_schema', soloLectura: true });
      expect(final.codigo, final.stderr).toBe(0);
      expect(Object.values(estados(final))).toEqual(['presente', 'presente', 'presente', 'presente', 'presente']);
      expect(tabla(final.stdout, 'etapa\tfilas\tesperado')).toEqual([['etapa 2: filas de canecas_secuencias (esperado: 3 por empresa)', '6', '6']]);
      expect(tabla(final.stdout, 'TRIGGER_NAME\tEVENT_OBJECT_TABLE\tACTION_TIMING\tEVENT_MANIPULATION').map(r => r[0])).toEqual(['trg_can_venta_bd', 'trg_can_venta_bu']);
    } finally { await pool.end(); }
  }, 240000);

  it('GROUP_CONCAT (hallazgo 3): con un límite bajo no hay huellas falsas ni truncamiento: el preflight fija el límite y las huellas no lo usan', async () => {
    const { pool } = await preparar(BASE);
    try {
      const LIMITE_BAJO = 'SET SESSION group_concat_max_len=1';
      // El preflight fija 1048576 en su sesion: sin advertencias de truncamiento y sin DETENER.
      const con = ejecutar('01-verificar-previo', { initCommand: LIMITE_BAJO, showWarnings: true, soloLectura: true });
      expect(con.codigo, con.stderr).toBe(0); expect(detener(con)).toEqual([]);
      expect(`${con.stdout}${con.stderr}`).not.toMatch(/Level\tCode|cut by group_concat/i);
      expect(fila(con, 'group_concat_max_len suficiente')).toBe('OK');
      expect(con.filas.find(f => f.verificacion.startsWith('maximo historico COMP'))!.resultado).toBe('1:30, 2:100'); // lista completa, no recortada
      // Sin el SET del archivo y con limite 1 el truncamiento SI ocurriria: la fila de comprobacion lo detecta (DETENER) y MariaDB avisa.
      const sin = ejecutar('01-verificar-previo', { initCommand: LIMITE_BAJO, showWarnings: true, soloLectura: true, texto: contenido('01-verificar-previo').replace('SET SESSION group_concat_max_len = 1048576;\n', '') });
      expect(fila(sin, 'group_concat_max_len suficiente')).toBe('DETENER');
      expect(`${sin.stdout}${sin.stderr}`).toMatch(/cut by group_concat/i);
      // Las huellas exactas del contrato no usan GROUP_CONCAT: con limite 1 siguen siendo OK una vez instalado todo.
      for (const n of ARCHIVOS.filter(esEscritura)) expect(ejecutar(n).codigo, n).toBe(0);
      const huellas = ejecutar('14-verificar-final', { initCommand: LIMITE_BAJO, showWarnings: true, soloLectura: true });
      expect(huellas.codigo, huellas.stderr).toBe(0); expect(detener(huellas)).toEqual([]);
      expect(`${huellas.stdout}${huellas.stderr}`).not.toMatch(/Level\tCode/);
    } finally { await pool.end(); }
  }, 240000);

  it('las verificaciones detectan alteraciones del esquema instalado (columna extra, trigger faltante o modificado) y el preflight detecta bloqueos', async () => {
    const { pool } = await preparar(BASE);
    try {
      expect(detener(ejecutar('01-verificar-previo'))).toEqual([]);
      await pool.query("INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,'B','Otra','Caneca',5,'litros','caneca')");
      expect(detener(ejecutar('01-verificar-previo'))).toContain('ninguna empresa con mas de una caneca activa');
      for (const n of ['02-etapa1-crear-secuencias', '04-etapa2-sembrar-contadores', '06-etapa3-alterar-ventas']) expect(ejecutar(n).codigo, n).toBe(0);
      const falla = ejecutar('08-etapa4-alterar-productos');
      expect(falla.codigo).not.toBe(0); expect(falla.stderr).toMatch(/ERROR (1062|1834)/);
      expect(falla.stderr).not.toMatch(/ERROR 1242/);
      expect((await objetos(pool))[2]).toBe(0);
      await pool.query("UPDATE canecas_productos SET activo=0 WHERE codigo='B'");
      for (const n of ['08-etapa4-alterar-productos', '10-etapa5-alterar-compras', '12-etapa6-reemplazar-trigger']) expect(ejecutar(n).codigo, n).toBe(0);
      expect(detener(ejecutar('14-verificar-final', { soloLectura: true }))).toEqual([]);
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
