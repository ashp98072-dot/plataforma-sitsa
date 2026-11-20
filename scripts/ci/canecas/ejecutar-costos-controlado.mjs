// Ruta controlada. El llamador debe mantener detenidas las escrituras y el DDL
// de Canecas durante toda la ejecución; GET_LOCK no bloquea clientes ajenos.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const sqlFile = name => readFileSync(path.join(root, 'sql', name), 'utf8');

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
    return { pendienteConciliacion: post[3].length, recepcionesHistoricasSinCapa: post[4].length };
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [`canecas-costos:${identity[0].base}`]);
  }
}

// Esta entrada requiere variables explícitas; no lee .env ni imprime credenciales.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') !== '--ejecutar' || !process.env.CANECAS_SQL_HOST || !process.env.CANECAS_SQL_DATABASE || !process.env.CANECAS_SQL_USER || !process.env.CANECAS_SQL_PASSWORD) {
    console.error('DETENER: indicar --ejecutar y CANECAS_SQL_HOST, CANECAS_SQL_DATABASE, CANECAS_SQL_USER y CANECAS_SQL_PASSWORD.');
    process.exitCode = 1;
  } else {
    const mysql = await import('mysql2/promise');
    let connection;
    try {
      connection = await mysql.createConnection({ host: process.env.CANECAS_SQL_HOST, database: process.env.CANECAS_SQL_DATABASE, user: process.env.CANECAS_SQL_USER, password: process.env.CANECAS_SQL_PASSWORD, multipleStatements: true });
      const result = await ejecutarCostosControlado(connection);
      console.log('Preflight, migración y postcheck completos.', JSON.stringify(result));
    } catch (error) {
      console.error('DETENER: instalación no completada; conservar datos y ejecutar diagnóstico de recuperación.', error.code || 'ERROR');
      process.exitCode = 1;
    } finally { if (connection) await connection.end(); }
  }
}
