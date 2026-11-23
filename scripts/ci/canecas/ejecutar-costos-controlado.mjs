// Ruta controlada. El llamador debe mantener detenidas las escrituras y el DDL
// de Canecas durante toda la ejecución; GET_LOCK no bloquea clientes ajenos.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verificarContrato } from './contrato-costos.mjs';
import { obtenerContratoBase, compararContratoBase } from './contrato-base.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const sqlFile = name => readFileSync(path.join(root, 'sql', name), 'utf8');
const normalizar = value => value.replace(/\r\n/g, '\n').trim();

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

export function verificarClavesForaneas(rows, ddl) {
  const expected = [...ddl.matchAll(/CONSTRAINT\s+(fk_can_\w+)\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+(\w+)\s*\(([^)]+)\)/gi)];
  if (expected.length !== 9 || !Array.isArray(rows)) throw Error('DETENER: claves foráneas incompletas');
  for (const [, name, columns, refTable, refColumns] of expected) {
    const source = columns.split(',').map(x => x.trim());
    const target = refColumns.split(',').map(x => x.trim());
    const beforeConstraint = ddl.slice(0, ddl.indexOf(`CONSTRAINT ${name}`));
    const tables = [...beforeConstraint.matchAll(/CREATE TABLE\s+(\w+)/gi)];
    const table = tables.at(-1)?.[1];
    const actual = rows.filter(row => row.CONSTRAINT_NAME === name);
    if (!table || actual.length !== source.length || source.some((column, i) => !actual.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === column && row.REFERENCED_TABLE_NAME === refTable && row.REFERENCED_COLUMN_NAME === target[i]))) {
      throw Error(`DETENER: definición incompatible de clave foránea ${name}`);
    }
  }
}

// El archivo privado debe contener un contrato revisado para la base concreta.
// Su lectura no sustituye la revisión independiente de la evidencia de origen.
export async function verificarContratoBaseReal(connection) {
  let evidencia;
  try {
    const archivo = process.env.CANECAS_CONTRATO_VALIDADO || new URL('./contrato-base-hostinger-validado.json', import.meta.url);
    evidencia = JSON.parse(readFileSync(archivo, 'utf8'));
  } catch (cause) {
    throw new Error('DETENER: contrato real completo del esquema base pendiente o inválido; no se ejecutará DDL', { cause });
  }
  const [identity] = await connection.query('SELECT DATABASE() AS base');
  if (!evidencia || evidencia.formato !== 1 || typeof evidencia.base !== 'string' || !evidencia.base || evidencia.base !== identity[0]?.base || !evidencia.contrato) {
    throw Error('DETENER: contrato real incompleto o base distinta; no se ejecutará DDL');
  }
  const actual = await obtenerContratoBase(connection);
  compararContratoBase(evidencia.contrato, actual);
}

export async function ejecutarOperacionesDDL(connection, operations) {
  for (let i = 0; i < operations.length; i++) {
    const nombre = operations[i].match(/\b(?:ALTER TABLE|CREATE TABLE|CREATE TRIGGER)\s+\w+/i)?.[0] || 'operación desconocida';
    try {
      await connection.query(operations[i]);
      const [warnings] = await connection.query('SHOW WARNINGS');
      if (!Array.isArray(warnings)) throw Error('resultado SHOW WARNINGS incompleto');
      if (warnings.length) throw Error(`advertencias DDL: ${JSON.stringify(warnings)}`);
    } catch (cause) {
      const codigo = cause?.code ?? cause?.errno ?? 'no disponible';
      const estado = cause?.sqlState ?? cause?.sqlstate ?? 'no disponible';
      const error = new Error(`DETENER: DDL ${i + 1}/${operations.length} (${nombre}): código ${codigo}; SQLSTATE ${estado}; ${cause?.message ?? String(cause)}; instalación parcial, ejecutar diagnóstico de recuperación supervisada`, { cause });
      error.code = cause?.code;
      error.errno = cause?.errno;
      error.sqlState = cause?.sqlState ?? cause?.sqlstate;
      throw error;
    }
  }
}

export async function ejecutarCostosControlado(connection) {
  const preflight = sqlFile('preflight-2026-11-canecas-costos-wip.sql');
  const migration = sqlFile('migrate-2026-11-canecas-costos-wip.sql');
  const postcheck = sqlFile('postcheck-2026-11-canecas-costos-wip.sql');
  const [identity] = await connection.query('SELECT DATABASE() AS base');
  if (!identity[0]?.base) throw Error('DETENER: no hay base seleccionada');
  // Política conservadora: solo concesiones directas; no interpreta roles.
  const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
  const required = ['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER'];
  const base = String(identity[0].base).replace(/`/g, '``');
  const onDatabase = ` ON \`${base}\`.* TO `;
  const privileges = new Set();
  for (const row of grants) {
    const value = String(Object.values(row)[0]);
    const local = value.indexOf(onDatabase);
    const pos = local >= 0 ? local : value.indexOf(' ON *.* TO ');
    if (pos < 0 || !value.startsWith('GRANT ')) continue;
    for (const item of value.slice(6, pos).split(',')) privileges.add(item.trim().toUpperCase());
  }
  if (required.some(p => !privileges.has(p) && !privileges.has('ALL PRIVILEGES'))) throw Error('DETENER: privilegios directos insuficientes para la base');
  const [locks] = await connection.query('SELECT GET_LOCK(?, 0) AS adquirido', [`canecas-costos:${identity[0].base}`]);
  if (Number(locks[0]?.adquirido) !== 1) throw Error('DETENER: instalación concurrente');
  let modoOriginal;
  let innodbOriginal;
  try {
    const [modes] = await connection.query('SELECT @@SESSION.sql_mode AS modo, @@SESSION.innodb_strict_mode AS innodb');
    modoOriginal = modes[0]?.modo;
    innodbOriginal = modes[0]?.innodb;
    if (typeof modoOriginal !== 'string' || ![0, 1].includes(Number(innodbOriginal))) throw Error('DETENER: no se pudieron leer modos de sesión');
    const previos = modoOriginal.split(',').filter(Boolean);
    if (!previos.includes('STRICT_TRANS_TABLES') && !previos.includes('STRICT_ALL_TABLES')) {
      await connection.query("SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES')");
    }
    const [actual] = await connection.query('SELECT @@SESSION.sql_mode AS modo');
    const activos = String(actual[0]?.modo || '').split(',').filter(Boolean);
    if (!previos.every(mode => activos.includes(mode)) || (!activos.includes('STRICT_TRANS_TABLES') && !activos.includes('STRICT_ALL_TABLES'))) {
      throw Error('DETENER: no se pudo garantizar SQL estricto sin perder modos previos');
    }
    await connection.query('SET SESSION innodb_strict_mode = 1');
    const [strict] = await connection.query('SELECT @@SESSION.innodb_strict_mode AS activo');
    if (Number(strict[0]?.activo) !== 1) throw Error('DETENER: no se pudo activar InnoDB estricto en sesión');
    const [results] = await connection.query(preflight);
    if (!Array.isArray(results) || results.length < 8) throw Error('DETENER: preflight incompleto');
    const checks = results.flat().filter(row => row && typeof row === 'object' && 'resultado' in row);
    if (checks.length < 20 || checks.some(row => row.resultado === 'DETENER')) throw Error('DETENER: preflight incompatible');
    const [ddl, triggerSql, extra] = migration.split('DELIMITER //');
    if (!triggerSql || extra || !triggerSql.includes('DELIMITER ;')) throw Error('DETENER: formato de migración inesperado');
    const triggers = triggerSql.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'));
    if (triggers.length !== 7) throw Error('DETENER: triggers incompletos');
    const statements = ddl.split(';').map(s => s.trim()).filter(Boolean);
    if (statements.length !== 5) throw Error('DETENER: DDL inesperado');
    const operations = [...statements, ...triggers];
    await verificarContratoBaseReal(connection);
    await ejecutarOperacionesDDL(connection, operations);
    const [post] = await connection.query(postcheck);
    if (!Array.isArray(post) || post.length < 11) throw Error('DETENER: postcheck incompleto; instalación requiere revisión');
    const postChecks = post.flat().filter(row => row && typeof row === 'object' && 'resultado' in row);
    if (postChecks.length < 20 || postChecks.some(row => row.resultado === 'DETENER') || post[5].length || post[3].some(row => Number(row.unidades_sin_capa) < 0)) {
      throw Error('DETENER: postcheck incompatible; instalación requiere revisión');
    }
    verificarTriggers(post[8], triggers);
    verificarClavesForaneas(post[9], ddl);
    await verificarContrato(connection);
    return { modoSqlEstricto: true, pendienteConciliacion: post[3].length, recepcionesHistoricasSinCapa: post[4].length };
  } finally {
    try {
      try {
        if (innodbOriginal !== undefined) await connection.query('SET SESSION innodb_strict_mode = ?', [innodbOriginal]);
      } finally {
        if (typeof modoOriginal === 'string') await connection.query('SET SESSION sql_mode = ?', [modoOriginal]);
      }
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [`canecas-costos:${identity[0].base}`]);
    }
  }
}

// Esta entrada requiere variables explícitas; no lee .env ni imprime credenciales.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { CANECAS_SQL_HOST: host, CANECAS_SQL_PIPE: pipe, CANECAS_SQL_CA: ca, CANECAS_SQL_DATABASE: database, CANECAS_SQL_USER: user, CANECAS_SQL_PASSWORD: password, CANECAS_SQL_PORT: rawPort } = process.env;
  const port = rawPort === undefined ? 3306 : Number(rawPort);
  if (process.argv.slice(2).join(' ') !== '--ejecutar' || !database || !user || !password || Boolean(host) === Boolean(pipe) || (host && (!ca || !Number.isInteger(port) || port < 1 || port > 65535)) || (pipe && !/^fifo-[0-9a-f-]{36}$/.test(pipe))) {
    console.error('DETENER: configurar base, usuario y contraseña; usar host con CA TLS o pipe de laboratorio verificado.');
    process.exitCode = 1;
  } else {
    const mysql = await import('mysql2/promise');
    let connection;
    try {
      const transport = pipe ? { socketPath: `\\\\.\\pipe\\${pipe}` } : { host, port, ssl: { ca: readFileSync(ca), rejectUnauthorized: true } };
      connection = await mysql.createConnection({ ...transport, database, user, password, multipleStatements: true });
      const result = await ejecutarCostosControlado(connection);
      console.log('Preflight, migración y postcheck completos.', JSON.stringify(result));
    } catch (error) {
      console.error('DETENER: instalación no completada; conservar datos y ejecutar diagnóstico de recuperación.', error.message?.startsWith('DETENER:') ? error.message : (error.code || 'ERROR'));
      process.exitCode = 1;
    } finally { if (connection) await connection.end(); }
  }
}

