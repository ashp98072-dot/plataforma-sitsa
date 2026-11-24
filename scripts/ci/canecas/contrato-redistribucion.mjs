import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizarSql } from './contrato-salidas.mjs';

// Contrato del estado POSTERIOR a migrate-2026-11-canecas-redistribucion-wip.sql, obtenido en MariaDB 11.8.9.
// Incluye canecas_capas_costo completa (la migración la modifica) y las dos tablas nuevas.
export const ORDEN_FIFO_SQL = 'creado_en,COALESCE(orden_fifo,id),id'; // debe coincidir con src/lib/canecas/orden-fifo.ts
const tablas = "'canecas_redistribuciones','canecas_redistribuciones_origen','canecas_capas_costo'";
const triggersNombres = "'trg_can_redis_bu','trg_can_redis_bd','trg_can_redis_origen_bu','trg_can_redis_origen_bd','can_capa_costo_inmutable'";
const nombres = ['tablas', 'columnas', 'indices', 'foraneas', 'checks'];
const queries = {
  tablas: `SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION,CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME`,
  columnas: `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,ORDINAL_POSITION`,
  indices: `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,COLLATION,NULLABLE,IGNORED FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,BINARY INDEX_NAME,SEQ_IN_INDEX`,
  foraneas: `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${tablas}) AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
  checks: `SELECT t.TABLE_NAME,t.CONSTRAINT_NAME,c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME IN (${tablas}) ORDER BY BINARY t.TABLE_NAME,BINARY t.CONSTRAINT_NAME`,
  triggers: `SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (${triggersNombres}) ORDER BY BINARY TRIGGER_NAME`,
};
export async function obtenerContratoRedistribucion(connection) {
  const resultado = {};
  for (const [nombre, sql] of Object.entries(queries)) {
    const [rows] = await connection.query(sql);
    resultado[nombre] = JSON.parse(JSON.stringify(rows));
  }
  return resultado;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
export function triggersEsperadosRedistribucion() {
  const migration = readFileSync(path.join(root, 'sql', 'migrate-2026-11-canecas-redistribucion-wip.sql'), 'utf8');
  const [, triggerSql, extra] = migration.split('DELIMITER //');
  if (!triggerSql || extra || !triggerSql.includes('DELIMITER ;')) throw Error('DETENER: definiciones de triggers de redistribución incompletas');
  const triggers = triggerSql.split('//').map(x => x.trim()).filter(x => /^CREATE (OR REPLACE )?TRIGGER /.test(x)).map(ddl => {
    const match = ddl.match(/^CREATE (?:OR REPLACE )?TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+(\w+)\s+FOR EACH ROW\s+([\s\S]+)$/i);
    if (!match) throw Error('DETENER: definición de trigger de redistribución inesperada');
    return { TRIGGER_NAME: match[1], ACTION_TIMING: match[2].toUpperCase(), EVENT_MANIPULATION: match[3].toUpperCase(), EVENT_OBJECT_TABLE: match[4], ACTION_STATEMENT: match[5] };
  });
  if (triggers.length !== 5) throw Error('DETENER: triggers de redistribución esperados incompletos');
  return triggers;
}

export function leerContratoRedistribucionEsperado() {
  return JSON.parse(readFileSync(new URL('./contrato-redistribucion-mariadb-11.8.9.json', import.meta.url), 'utf8'));
}

export async function verificarContratoRedistribucion(connection) {
  const esperado = leerContratoRedistribucionEsperado();
  const actual = await obtenerContratoRedistribucion(connection);
  for (const nombre of nombres) if (JSON.stringify(actual[nombre]) !== JSON.stringify(esperado[nombre])) throw Error(`DETENER: contrato de redistribución incompatible en ${nombre}`);
  const triggers = triggersEsperadosRedistribucion();
  if (actual.triggers.length !== triggers.length) throw Error('DETENER: triggers de redistribución incompletos');
  for (const expected of triggers) {
    const found = actual.triggers.find(row => row.TRIGGER_NAME === expected.TRIGGER_NAME);
    if (!found || found.ACTION_TIMING !== expected.ACTION_TIMING || found.EVENT_MANIPULATION !== expected.EVENT_MANIPULATION || found.EVENT_OBJECT_TABLE !== expected.EVENT_OBJECT_TABLE || normalizarSql(found.ACTION_STATEMENT) !== normalizarSql(expected.ACTION_STATEMENT)) {
      throw Error(`DETENER: definición incompatible del trigger ${expected.TRIGGER_NAME}`);
    }
  }
}

// El criterio FIFO que usa el código debe ser ejecutable en el esquema instalado y la columna de prioridad
// debe ser BIGINT NULL (el contrato la cubre); además se comprueba que la consulta se analiza sin error.
export async function verificarCriterioFifo(connection) {
  try {
    await connection.query(`SELECT id,${'COALESCE(orden_fifo,id)'} AS prioridad FROM canecas_capas_costo WHERE 1=0 ORDER BY ${ORDEN_FIFO_SQL}`);
  } catch (cause) {
    throw new Error('DETENER: el criterio FIFO con orden_fifo no es ejecutable en el esquema instalado', { cause });
  }
}
