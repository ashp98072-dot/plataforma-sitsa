// Ruta controlada. El llamador debe mantener detenidas las escrituras y el DDL
// de Canecas durante toda la ejecución; GET_LOCK no bloquea clientes ajenos.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const sqlFile = name => readFileSync(path.join(root, 'sql', name), 'utf8');
const normalizar = value => value.replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function verificarTriggers(rows, triggers) {
  if (!Array.isArray(rows) || rows.length !== triggers.length) throw Error('DETENER: triggers incompletos');
  for (const ddl of triggers) {
    const parts = ddl.match(/^CREATE TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+(\w+)\s+FOR EACH ROW\s+([\s\S]+)$/i);
    if (!parts) throw Error('DETENER: definición esperada inválida');
    const [, name, timing, event, table, body] = parts;
    const row = rows.find(item => item.TRIGGER_NAME === name);
    if (!row || row.EVENT_OBJECT_TABLE !== table || row.ACTION_TIMING !== timing || row.EVENT_MANIPULATION !== event || normalizar(row.ACTION_STATEMENT) !== normalizar(body)) {
      throw Error(`DETENER: definición incompatible del trigger ${name}`);
    }
  }
}

export async function ejecutarCostosControlado(connection) {
  const preflight = sqlFile('preflight-2026-11-canecas-costos-wip.sql');
  const migration = sqlFile('migrate-2026-11-canecas-costos-wip.sql');
  const postcheck = sqlFile('postcheck-2026-11-canecas-costos-wip.sql');
  const [identity] = await connection.query('SELECT DATABASE() AS base');
  if (!identity[0]?.base) throw Error('DETENER: no hay base seleccionada');
  const [locks] = await connection.query('SELECT GET_LOCK(?, 0) AS adquirido', [`canecas-costos:${identity[0].base}`]);
  if (Number(locks[0]?.adquirido) !== 1) throw Error('DETENER: instalación concurrente');
  try {
    const [results] = await connection.query(preflight);
    if (!Array.isArray(results) || results.length < 8) throw Error('DETENER: preflight incompleto');
    const checks = results.flat().filter(row => row && typeof row === 'object' && 'resultado' in row);
    if (checks.length < 20 || checks.some(row => row.resultado === 'DETENER')) throw Error('DETENER: preflight incompatible');
    const [ddl, triggerSql, extra] = migration.split('DELIMITER //');
    if (!triggerSql || extra || !triggerSql.includes('DELIMITER ;')) throw Error('DETENER: formato de migración inesperado');
    const triggers = triggerSql.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'));
    if (triggers.length !== 7) throw Error('DETENER: triggers incompletos');
    await connection.query(ddl);
    for (const trigger of triggers) await connection.query(trigger);
    const [post] = await connection.query(postcheck);
    if (!Array.isArray(post) || post.length < 11) throw Error('DETENER: postcheck incompleto; instalación requiere revisión');
    const postChecks = post.flat().filter(row => row && typeof row === 'object' && 'resultado' in row);
    if (postChecks.length < 20 || postChecks.some(row => row.resultado === 'DETENER') || post[5].length || post[3].some(row => Number(row.unidades_sin_capa) < 0)) {
      throw Error('DETENER: postcheck incompatible; instalación requiere revisión');
    }
    verificarTriggers(post[8], triggers);
    return { pendienteConciliacion: post[3].length, recepcionesHistoricasSinCapa: post[4].length };
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [`canecas-costos:${identity[0].base}`]);
  }
}

// Esta entrada requiere variables explícitas; no lee .env ni imprime credenciales.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { CANECAS_SQL_HOST: host, CANECAS_SQL_PIPE: pipe, CANECAS_SQL_CA: ca, CANECAS_SQL_DATABASE: database, CANECAS_SQL_USER: user, CANECAS_SQL_PASSWORD: password } = process.env;
  if (process.argv.slice(2).join(' ') !== '--ejecutar' || !database || !user || !password || Boolean(host) === Boolean(pipe) || (host && !ca) || (pipe && !/^fifo-[0-9a-f-]{36}$/.test(pipe))) {
    console.error('DETENER: configurar base, usuario y contraseña; usar host con CA TLS o pipe de laboratorio verificado.');
    process.exitCode = 1;
  } else {
    const mysql = await import('mysql2/promise');
    let connection;
    try {
      const transport = pipe ? { socketPath: `\\\\.\\pipe\\${pipe}` } : { host, ssl: { ca: readFileSync(ca), rejectUnauthorized: true } };
      connection = await mysql.createConnection({ ...transport, database, user, password, multipleStatements: true });
      const result = await ejecutarCostosControlado(connection);
      console.log('Preflight, migración y postcheck completos.', JSON.stringify(result));
    } catch (error) {
      console.error('DETENER: instalación no completada; conservar datos y ejecutar diagnóstico de recuperación.', error.code || 'ERROR');
      process.exitCode = 1;
    } finally { if (connection) await connection.end(); }
  }
}
