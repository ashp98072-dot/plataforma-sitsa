import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tablas = "'canecas_salidas_fifo','canecas_salidas_fifo_capas'";
const queries = {
  tablas: `SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION,CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME`,
  columnas: `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,ORDINAL_POSITION`,
  indices: `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,COLLATION,NULLABLE,IGNORED FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tablas}) ORDER BY BINARY TABLE_NAME,BINARY INDEX_NAME,SEQ_IN_INDEX`,
  foraneas: `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${tablas}) AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
  checks: `SELECT t.TABLE_NAME,t.CONSTRAINT_NAME,c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME IN (${tablas}) AND t.CONSTRAINT_TYPE='CHECK' ORDER BY BINARY t.TABLE_NAME,BINARY t.CONSTRAINT_NAME`,
  triggers: `SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (${tablas}) ORDER BY BINARY TRIGGER_NAME`,
};
export async function obtenerContratoSalidas(connection) {
  const resultado = {};
  for (const [nombre, sql] of Object.entries(queries)) {
    const [rows] = await connection.query(sql);
    resultado[nombre] = JSON.parse(JSON.stringify(rows));
  }
  return resultado;
}
export function normalizarSql(value) {
  const sql = String(value ?? '');
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    const resto = sql.slice(i);
    if (/\s/.test(sql[i])) { i++; continue; }
    if (resto.startsWith('--') || resto.startsWith('/*') || sql[i] === '#') throw Error('DETENER: comentario inesperado en trigger');
    if (sql[i] === "'") {
      const inicio = i++;
      let cerrado = false;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          cerrado = true;
          break;
        }
        i++;
      }
      if (!cerrado) throw Error('DETENER: literal incompleto en trigger');
      tokens.push({ tipo: 'literal', valor: sql.slice(inicio, i) });
      continue;
    }
    const palabra = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(resto);
    if (palabra) { tokens.push({ tipo: 'palabra', valor: palabra[0].toLowerCase() }); i += palabra[0].length; continue; }
    const numero = /^\d+(?:\.\d+)?/.exec(resto);
    if (numero) { tokens.push({ tipo: 'numero', valor: numero[0] }); i += numero[0].length; continue; }
    const signo = /^(?:<=>|<=|>=|<>|!=|[=<>+*/%(),.;])/.exec(resto);
    if (!signo) throw Error('DETENER: token inesperado en trigger');
    tokens.push({ tipo: 'signo', valor: signo[0] });
    i += signo[0].length;
  }
  return tokens.map((token, index) => {
    const anterior = tokens[index - 1];
    const palabraAdyacente = anterior && ['palabra', 'numero', 'literal'].includes(anterior.tipo) && ['palabra', 'numero', 'literal'].includes(token.tipo);
    return (palabraAdyacente ? ' ' : '') + token.valor;
  }).join('');
}

function triggersEsperados() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const migration = readFileSync(path.join(root, 'sql', 'migrate-2026-11-canecas-salidas-fifo-wip.sql'), 'utf8');
  const [, triggerSql, extra] = migration.split('DELIMITER //');
  if (!triggerSql || extra || !triggerSql.includes('DELIMITER ;')) throw Error('DETENER: definiciones de triggers de salidas incompletas');
  return triggerSql.split('//').map(x => x.trim()).filter(x => x.startsWith('CREATE TRIGGER')).map(ddl => {
    const match = ddl.match(/^CREATE TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+(\w+)\s+FOR EACH ROW\s+([\s\S]+)$/i);
    if (!match) throw Error('DETENER: definición de trigger de salidas inesperada');
    return { TRIGGER_NAME: match[1], ACTION_TIMING: match[2].toUpperCase(), EVENT_MANIPULATION: match[3].toUpperCase(), EVENT_OBJECT_TABLE: match[4], ACTION_STATEMENT: match[5] };
  });
}

export async function verificarContratoSalidas(connection) {
  const esperado = JSON.parse(readFileSync(new URL('./contrato-salidas-mariadb-11.8.9.json', import.meta.url), 'utf8'));
  const actual = await obtenerContratoSalidas(connection);
  for (const nombre of ['tablas', 'columnas', 'indices', 'foraneas', 'checks']) if (JSON.stringify(actual[nombre]) !== JSON.stringify(esperado[nombre])) throw Error(`DETENER: contrato de salidas incompatible en ${nombre}`);
  const expectedTriggers = triggersEsperados();
  if (expectedTriggers.length !== 5 || actual.triggers.length !== expectedTriggers.length) throw Error('DETENER: triggers de salidas incompletos');
  for (const expected of expectedTriggers) {
    const found = actual.triggers.find(row => row.TRIGGER_NAME === expected.TRIGGER_NAME);
    if (!found || found.ACTION_TIMING !== expected.ACTION_TIMING || found.EVENT_MANIPULATION !== expected.EVENT_MANIPULATION || found.EVENT_OBJECT_TABLE !== expected.EVENT_OBJECT_TABLE || normalizarSql(found.ACTION_STATEMENT) !== normalizarSql(expected.ACTION_STATEMENT)) {
      throw Error(`DETENER: definición incompatible del trigger ${expected.TRIGGER_NAME}`);
    }
  }
}
