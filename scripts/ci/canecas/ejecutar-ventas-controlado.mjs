import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verificarContratoRedistribucion, verificarCriterioFifo } from './contrato-redistribucion.mjs';
import { verificarContratoCatalogos } from './contrato-catalogos.mjs';
import { verificarContratoVentas, triggersEsperadosVentas } from './contrato-ventas.mjs';
import { privilegiosDirectos } from './privilegios.mjs';
import { ejecutarOperacionesDDL } from './ejecutar-costos-controlado.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sql = name => readFileSync(path.join(root, 'sql', name), 'utf8');

// Instala migrate-2026-11-canecas-ventas-wip.sql (ventas y bitácora de mapeo de proveedores históricos). Solo crea objetos nuevos.
// Requisitos previos: fase 1, costos, salidas, redistribución y catálogos instalados y con su contrato exacto. El operador debe detener todas las escrituras y DDL de Canecas y verificar un respaldo restaurable.
// El DDL de MariaDB confirma implícitamente: ante error queda una instalación parcial que se diagnostica, no se reintenta.
export async function ejecutarVentasControlado(connection) {
  const [identity] = await connection.query('SELECT DATABASE() base, VERSION() version');
  const base = identity[0]?.base;
  if (!base || !String(identity[0]?.version).startsWith('11.8.9-MariaDB')) throw Error('DETENER: base o versión incompatible');
  const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
  const permisos = privilegiosDirectos(grants, base);
  if (['SELECT', 'CREATE', 'INDEX', 'REFERENCES', 'TRIGGER'].some(p => !permisos.has(p) && !permisos.has('ALL PRIVILEGES'))) throw Error('DETENER: privilegios directos insuficientes');
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

    // 1) Estado de ventas: ausente (instalar), completo (idempotente) o parcial (detener).
    const [presentes] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_compras_mapeo_proveedor')) AS tablas,
      (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd','trg_can_mapeo_bu','trg_can_mapeo_bd')) AS triggers`);
    const huella = presentes[0];
    if (!huella) throw Error('DETENER: no se pudo determinar el estado de ventas');
    if (Object.values(huella).some(n => Number(n) > 0)) {
      try { await verificarContratoVentas(connection); }
      catch (cause) { throw new Error('DETENER: ventas presentes o instalación parcial; diagnóstico supervisado (sql/recuperacion-canecas-ventas-solo-lectura.sql)', { cause }); }
      return { instalado: false, yaInstalado: true };
    }

    // 2) Estado previo exacto: toda la cadena instalada y verificada contra sus contratos.
    await verificarContratoRedistribucion(connection);
    await verificarCriterioFifo(connection);
    await verificarContratoCatalogos(connection);

    // 3) Migración: 2 CREATE TABLE y 4 triggers. Sin ALTER, sin UPDATE, sin DELETE sobre datos existentes.
    const migration = sql('migrate-2026-11-canecas-ventas-wip.sql');
    const [ddlSql, triggerSql, extra] = migration.split('DELIMITER //');
    if (!triggerSql || extra || !triggerSql.includes('DELIMITER ;')) throw Error('DETENER: formato de migración de ventas inesperado');
    const sinComentarios = ddlSql.split('\n').filter(linea => !/^\s*--/.test(linea)).join('\n'); // los comentarios del encabezado contienen ';'
    const statements = sinComentarios.split(';').map(x => x.trim()).filter(Boolean);
    const triggers = triggerSql.split('//').map(x => x.trim()).filter(x => /^CREATE (OR REPLACE )?TRIGGER /.test(x));
    if (statements.length !== 2 || !statements[0].startsWith('CREATE TABLE canecas_ventas (') || !statements[1].startsWith('CREATE TABLE canecas_compras_mapeo_proveedor (') || triggers.length !== 4 || triggersEsperadosVentas().length !== 4) throw Error('DETENER: DDL de ventas incompleto o inesperado');
    await ejecutarOperacionesDDL(connection, [...statements, ...triggers]);
    await verificarContratoVentas(connection);
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
      const resultado = await ejecutarVentasControlado(connection);
      console.log(resultado.yaInstalado ? 'Ventas ya instaladas y verificadas contra el contrato; sin cambios.' : 'Instalación y postcheck de ventas completos.');
    } catch (error) { console.error('DETENER: instalación no completada; conservar estado para recuperación supervisada.', error.message?.startsWith('DETENER:') ? error.message : (error.code || 'ERROR')); process.exitCode = 1; }
    finally { if (connection) await connection.end(); }
  }
}
