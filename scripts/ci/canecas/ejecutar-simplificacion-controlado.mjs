import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verificarContratoRedistribucion, verificarCriterioFifo } from './contrato-redistribucion.mjs';
import { verificarContratoCatalogos } from './contrato-catalogos.mjs';
import { verificarContratoVentas } from './contrato-ventas.mjs';
import { verificarContratoSimplificacion, triggersEsperadosSimplificacion } from './contrato-simplificacion.mjs';
import { privilegiosDirectos } from './privilegios.mjs';
import { ejecutarOperacionesDDL } from './ejecutar-costos-controlado.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sql = name => readFileSync(path.join(root, 'sql', name), 'utf8');

const filasDe = resultados => (Array.isArray(resultados) ? resultados : []).flat().filter(f => f && typeof f === 'object' && 'verificacion' in f);
const recuento = (filas, nombre) => { const f = filas.find(x => x.verificacion === nombre); const n = Number(f?.resultado); if (!f || !Number.isSafeInteger(n)) throw Error(`DETENER: falta el ${nombre}`); return n; };

/** Estado de la simplificación: una cuenta (0/1) por objeto que agrega la migración. Todo 0 = ausente; todo 1 = completa; otra cosa = parcial. */
export async function obtenerEstadoSimplificacion(connection) {
  const [presentes] = await connection.query(`SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_secuencias') AS secuencias,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega') AS direccion,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico') AS activo_unico,
    (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='trg_can_venta_bu' AND ACTION_STATEMENT LIKE '%direccion_entrega%') AS trigger_nuevo,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto') AS ref_auto,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto') AS doc_auto`);
  const estado = presentes[0] ? Object.values(presentes[0]).map(Number) : null;
  if (!estado || estado.some(n => !Number.isSafeInteger(n))) throw Error('DETENER: no se pudo determinar el estado de la simplificación');
  return estado;
}

// Instala migrate-2026-11-canecas-simplificacion-wip.sql (#688): canecas_secuencias, canecas_ventas.direccion_entrega,
// índice de caneca activa única y trigger de inmutabilidad ampliado. Solo agrega objetos; no modifica ni borra filas.
// Requisitos: fase 1, costos, salidas, redistribución, catálogos y ventas instalados con su contrato exacto; escrituras y DDL de
// Canecas detenidos; respaldo restaurable verificado. El DDL de MariaDB confirma implícitamente: ante un error queda una
// instalación parcial que se diagnostica con sql/recuperacion-canecas-simplificacion-solo-lectura.sql, no se reintenta a ciegas.
export async function ejecutarSimplificacionControlado(connection) {
  const [identity] = await connection.query('SELECT DATABASE() base, VERSION() version');
  const base = identity[0]?.base;
  if (!base || !String(identity[0]?.version).startsWith('11.8.9-MariaDB')) throw Error('DETENER: base o versión incompatible');
  const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
  const permisos = privilegiosDirectos(grants, base);
  if (['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER'].some(p => !permisos.has(p) && !permisos.has('ALL PRIVILEGES'))) throw Error('DETENER: privilegios directos insuficientes');
  const lock = `canecas-costos:${base}`;
  const [locks] = await connection.query('SELECT GET_LOCK(?, 0) AS adquirido', [lock]);
  if (Number(locks[0]?.adquirido) !== 1) throw Error('DETENER: instalación concurrente');
  let original, innodb;
  try {
    const [modes] = await connection.query('SELECT @@SESSION.sql_mode modo, @@SESSION.innodb_strict_mode innodb, @@SESSION.foreign_key_checks fk, @@SESSION.check_constraint_checks checks_activos');
    original = modes[0]?.modo; innodb = modes[0]?.innodb;
    if (typeof original !== 'string' || ![0, 1].includes(Number(innodb)) || Number(modes[0]?.fk) !== 1 || Number(modes[0]?.checks_activos) !== 1) throw Error('DETENER: modos de sesión incompatibles');
    const previos = original.split(',').filter(Boolean);
    if (!previos.includes('STRICT_TRANS_TABLES') && !previos.includes('STRICT_ALL_TABLES')) await connection.query("SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES')");
    await connection.query('SET SESSION innodb_strict_mode=1');
    const [actual] = await connection.query('SELECT @@SESSION.sql_mode modo, @@SESSION.innodb_strict_mode innodb');
    const activos = String(actual[0]?.modo || '').split(',');
    if (Number(actual[0]?.innodb) !== 1 || !previos.every(x => activos.includes(x)) || !activos.some(x => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(x))) throw Error('DETENER: no se pudieron activar modos estrictos');

    // 1) Estado: ausente (instalar), completo (idempotente, verificado contra el contrato nuevo) o parcial (detener).
    const estado = await obtenerEstadoSimplificacion(connection);
    if (estado.some(n => n > 0)) {
      if (estado.some(n => n !== 1)) throw Error('DETENER: simplificación parcial; diagnóstico supervisado (sql/recuperacion-canecas-simplificacion-solo-lectura.sql)');
      try { await verificarContratoSimplificacion(connection); }
      catch (cause) { throw new Error('DETENER: simplificación presente con contrato incompatible; diagnóstico supervisado (sql/recuperacion-canecas-simplificacion-solo-lectura.sql)', { cause }); }
      return { instalado: false, yaInstalado: true };
    }

    // 2) Estado previo exacto: cadena completa instalada y verificada contra sus contratos (incluido el contrato de ventas ANTERIOR).
    await verificarContratoRedistribucion(connection);
    await verificarCriterioFifo(connection);
    await verificarContratoCatalogos(connection);
    await verificarContratoVentas(connection);

    // 3) Preflight de solo lectura.
    const [resultadosPre] = await connection.query(sql('preflight-2026-11-canecas-simplificacion-wip.sql'));
    const pre = filasDe(resultadosPre);
    if (pre.length !== 22 || pre.some(f => f.resultado === 'DETENER')) throw Error(`DETENER: preflight incompatible${pre.filter(f => f.resultado === 'DETENER').map(f => `: ${f.verificacion}`).join('')}`);
    const antes = { ventas: recuento(pre, 'recuento canecas_ventas'), productos: recuento(pre, 'recuento canecas_productos') };

    // 4) Migración: CREATE TABLE, siembra de contadores desde los máximos históricos (INSERT en la tabla NUEVA), 3 ALTER y 1 trigger
    //    (CREATE OR REPLACE, atómico). Sin UPDATE ni DELETE de filas existentes; ningún documento se renumera.
    const migration = sql('migrate-2026-11-canecas-simplificacion-wip.sql');
    const [ddlSql, triggerSql, extra] = migration.split('DELIMITER //');
    if (!triggerSql || extra || !triggerSql.includes('DELIMITER ;')) throw Error('DETENER: formato de migración de simplificación inesperado');
    const sinComentarios = ddlSql.split('\n').filter(linea => !/^\s*--/.test(linea)).join('\n');
    const statements = sinComentarios.split(';').map(x => x.trim()).filter(Boolean);
    const triggers = triggerSql.split('//').map(x => x.trim()).filter(x => /^CREATE OR REPLACE TRIGGER /.test(x));
    if (statements.length !== 5 || !statements[0].startsWith('CREATE TABLE canecas_secuencias (') || !statements[1].startsWith('INSERT INTO canecas_secuencias (empresa_id,tipo,ultimo)') || !statements[2].startsWith('ALTER TABLE canecas_ventas') || !statements[3].startsWith('ALTER TABLE canecas_productos') || !statements[4].startsWith('ALTER TABLE canecas_compras') || triggers.length !== 1 || triggersEsperadosSimplificacion().length !== 2) throw Error('DETENER: DDL de simplificación inesperado');
    await ejecutarOperacionesDDL(connection, [...statements, ...triggers]);

    // 5) Postcheck de solo lectura, datos intactos y contrato exacto.
    const [resultadosPost] = await connection.query(sql('postcheck-2026-11-canecas-simplificacion-wip.sql'));
    const post = filasDe(resultadosPost);
    if (post.length !== 15 || post.some(f => f.resultado === 'DETENER')) throw Error('DETENER: postcheck incompatible; instalación requiere revisión');
    if (recuento(post, 'empresas sin contador completo') !== 0 || recuento(post, 'siguientes números ya en uso por un documento') !== 0) throw Error('DETENER: numeración automática no conciliada con los documentos históricos; instalación requiere revisión');
    if (recuento(post, 'recuento canecas_ventas') !== antes.ventas || recuento(post, 'recuento canecas_productos') !== antes.productos || recuento(post, 'ventas con dirección de entrega') !== 0) throw Error('DETENER: los datos existentes cambiaron; instalación requiere revisión');
    await verificarContratoSimplificacion(connection);
    return { instalado: true, yaInstalado: false };
  } finally {
    try { try { if (innodb !== undefined) await connection.query('SET SESSION innodb_strict_mode=?', [innodb]); } finally { if (typeof original === 'string') await connection.query('SET SESSION sql_mode=?', [original]); } }
    finally { await connection.query('SELECT RELEASE_LOCK(?)', [lock]); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { CANECAS_SQL_HOST: host, CANECAS_SQL_CA: ca, CANECAS_SQL_DATABASE: database, CANECAS_SQL_USER: user, CANECAS_SQL_PASSWORD: password, CANECAS_SQL_PORT: rawPort } = process.env;
  const port = rawPort === undefined ? 3306 : Number(rawPort);
  if (process.argv.slice(2).join(' ') !== '--ejecutar' || !host || !ca || !database || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('DETENER: configurar host, CA TLS, base, usuario y contraseña.'); process.exitCode = 1;
  } else {
    let connection;
    try {
      const mysql = await import('mysql2/promise');
      connection = await mysql.createConnection({ host, port, database, user, password, ssl: { ca: readFileSync(ca), rejectUnauthorized: true }, multipleStatements: true });
      const resultado = await ejecutarSimplificacionControlado(connection);
      console.log(resultado.yaInstalado ? 'Simplificación ya instalada y verificada contra el contrato; sin cambios.' : 'Instalación y postcheck de la simplificación completos.');
    } catch (error) { console.error('DETENER: instalación no completada; conservar estado para recuperación supervisada.', error.message?.startsWith('DETENER:') ? error.message : (error.code || 'ERROR')); process.exitCode = 1; }
    finally { if (connection) await connection.end(); }
  }
}
