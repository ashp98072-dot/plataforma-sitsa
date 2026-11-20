// Ruta controlada. El llamador debe mantener detenidas las escrituras y el DDL
// de Canecas durante toda la ejecución; GET_LOCK no bloquea clientes ajenos.
import { readFileSync } from 'node:fs';

export async function ejecutarCostosControlado(connection) {
  const preflight = readFileSync('sql/preflight-2026-11-canecas-costos-wip.sql', 'utf8');
  const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
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
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [`canecas-costos:${identity[0].base}`]);
  }
}
