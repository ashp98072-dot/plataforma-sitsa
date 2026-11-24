import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verificarContrato } from './contrato-costos.mjs';
import { verificarContratoSalidas } from './contrato-salidas.mjs';
import { privilegiosDirectos } from './privilegios.mjs';
import { ejecutarOperacionesDDL, verificarTriggers, verificarClavesForaneas } from './ejecutar-costos-controlado.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sql = name => readFileSync(path.join(root, 'sql', name), 'utf8');

// El operador debe detener todas las escrituras y DDL de Canecas y verificar respaldo.
export async function ejecutarSalidasControlado(connection) {
  const [identity] = await connection.query('SELECT DATABASE() base, VERSION() version');
  const base = identity[0]?.base;
  if (!base || !String(identity[0]?.version).startsWith('11.8.9-MariaDB')) throw Error('DETENER: base o versión incompatible');
  const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
  const permisos = privilegiosDirectos(grants, base);
  if (['SELECT', 'CREATE', 'REFERENCES', 'TRIGGER'].some(p => !permisos.has(p) && !permisos.has('ALL PRIVILEGES'))) throw Error('DETENER: privilegios directos insuficientes');
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
    await verificarContrato(connection);
    const costos = sql('migrate-2026-11-canecas-costos-wip.sql');
    const [ddl, costoTriggerSql] = costos.split('DELIMITER //');
    const costoTriggers = costoTriggerSql?.split('//').map(x => x.trim()).filter(x => x.startsWith('CREATE TRIGGER')) || [];
    if (costoTriggers.length !== 7) throw Error('DETENER: triggers esperados incompletos');
    const [post] = await connection.query(sql('postcheck-2026-11-canecas-costos-wip.sql'));
    if (!Array.isArray(post) || post.length < 11 || post.flat().some(row => row?.resultado === 'DETENER') || post[5].length || post[3].some(row => Number(row.unidades_sin_capa) < 0)) throw Error('DETENER: postcheck de costos incompatible');
    verificarTriggers(post[8], costoTriggers);
    verificarClavesForaneas(post[9], ddl);
    const [existentes] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_salidas_fifo','canecas_salidas_fifo_capas')");
    if (!Array.isArray(existentes) || existentes.length) throw Error('DETENER: salidas presentes o instalación parcial; diagnóstico supervisado');
    const migration = sql('migrate-2026-11-canecas-salidas-fifo-wip.sql');
    const [tableSql, triggerSql, extra] = migration.split('DELIMITER //');
    if (!triggerSql || extra || !triggerSql.includes('DELIMITER ;')) throw Error('DETENER: formato de migración de salidas inesperado');
    const tables = tableSql.split(';').map(x => x.trim()).filter(Boolean);
    const triggers = triggerSql.split('//').map(x => x.trim()).filter(x => x.startsWith('CREATE TRIGGER'));
    if (tables.length !== 2 || !tables[0].includes('CREATE TABLE canecas_salidas_fifo (') || !tables[1].startsWith('CREATE TABLE canecas_salidas_fifo_capas (') || triggers.length !== 5) throw Error('DETENER: DDL de salidas incompleto o inesperado');
    await ejecutarOperacionesDDL(connection, [...tables, ...triggers]);
    await verificarContratoSalidas(connection);
    return { instalado: true };
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
      await ejecutarSalidasControlado(connection);
      console.log('Instalación y postcheck de salidas completos.');
    } catch (error) { console.error('DETENER: instalación no completada; conservar estado para recuperación supervisada.', error.message?.startsWith('DETENER:') ? error.message : (error.code || 'ERROR')); process.exitCode = 1; }
    finally { if (connection) await connection.end(); }
  }
}
