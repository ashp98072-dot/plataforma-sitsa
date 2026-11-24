import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verificarContratoRedistribucion, verificarCriterioFifo } from './contrato-redistribucion.mjs';
import { verificarContratoCatalogos } from './contrato-catalogos.mjs';
import { privilegiosDirectos } from './privilegios.mjs';
import { ejecutarOperacionesDDL } from './ejecutar-costos-controlado.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sql = name => readFileSync(path.join(root, 'sql', name), 'utf8');

// Instala migrate-2026-11-canecas-catalogos-wip.sql (proveedores y clientes exclusivos de Canecas). Es ADITIVA: no borra,
// reasigna ni reescribe ningún dato, y las compras históricas conservan su proveedor_id. Informa cuántas compras
// históricas quedan sin proveedor de Canecas (mapeo manual pendiente). El operador debe detener las escrituras de Canecas
// y verificar un respaldo restaurable. El DDL confirma implícitamente: ante error queda una instalación parcial.
export async function ejecutarCatalogosControlado(connection) {
  const [identity] = await connection.query('SELECT DATABASE() base, VERSION() version');
  const base = identity[0]?.base;
  if (!base || !String(identity[0]?.version).startsWith('11.8.9-MariaDB')) throw Error('DETENER: base o versión incompatible');
  const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
  const permisos = privilegiosDirectos(grants, base);
  if (['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES'].some(p => !permisos.has(p) && !permisos.has('ALL PRIVILEGES'))) throw Error('DETENER: privilegios directos insuficientes');
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

    // 1) Estado: ausente (instalar), completo (idempotente) o parcial (detener).
    const [presentes] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_proveedores','canecas_clientes')) AS tablas,
      (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='canecas_proveedor_id') AS columnas,
      (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_can_compra_proveedor') AS checks`);
    const huella = presentes[0];
    if (!huella) throw Error('DETENER: no se pudo determinar el estado de los catálogos');
    if (Object.values(huella).some(n => Number(n) > 0)) {
      try { await verificarContratoCatalogos(connection); }
      catch (cause) { throw new Error('DETENER: catálogos presentes o instalación parcial; diagnóstico supervisado (sql/recuperacion-canecas-catalogos-solo-lectura.sql)', { cause }); }
      return { instalado: false, yaInstalado: true, comprasSinMapear: await comprasSinMapear(connection) };
    }

    // 2) Estado previo: cadena instalada (redistribución verificada contra su contrato) y compras sin tocar.
    await verificarContratoRedistribucion(connection);
    await verificarCriterioFifo(connection);
    const [prev] = await connection.query("SELECT IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='proveedor_id'");
    if (prev.length !== 1 || prev[0].IS_NULLABLE !== 'NO' || prev[0].COLUMN_TYPE !== 'int(11)') throw Error('DETENER: canecas_compras.proveedor_id no coincide con el estado previo esperado');
    const historicas = await contarCompras(connection);

    // 3) Migración: 2 CREATE TABLE y 1 ALTER sobre canecas_compras. Sin triggers, sin UPDATE, sin DELETE.
    const migration = sql('migrate-2026-11-canecas-catalogos-wip.sql');
    const sinComentarios = migration.split('\n').filter(linea => !/^\s*--/.test(linea)).join('\n');
    const statements = sinComentarios.split(';').map(x => x.trim()).filter(Boolean);
    // Solo se admiten tres sentencias DDL aditivas (comprobadas una a una); no hay DML ni triggers en esta migración.
    if (statements.length !== 3 || !statements[0].startsWith('CREATE TABLE canecas_proveedores (') || !statements[1].startsWith('CREATE TABLE canecas_clientes (') || !statements[2].startsWith('ALTER TABLE canecas_compras')) throw Error('DETENER: DDL de catálogos incompleto o inesperado');
    await ejecutarOperacionesDDL(connection, statements);
    await verificarContratoCatalogos(connection);
    if (await contarCompras(connection) !== historicas) throw Error('DETENER: cambió el número de compras durante la instalación');
    return { instalado: true, yaInstalado: false, comprasSinMapear: await comprasSinMapear(connection) };
  } finally {
    try { try { if (innodb !== undefined) await connection.query('SET SESSION innodb_strict_mode=?', [innodb]); } finally { if (typeof original === 'string') await connection.query('SET SESSION sql_mode=?', [original]); } }
    finally { await connection.query('SELECT RELEASE_LOCK(?)', [lock]); }
  }
}
async function contarCompras(connection) {
  const [rows] = await connection.query('SELECT COUNT(*) AS n FROM canecas_compras');
  return Number(rows[0]?.n);
}
async function comprasSinMapear(connection) {
  const [rows] = await connection.query('SELECT COUNT(*) AS n FROM canecas_compras WHERE canecas_proveedor_id IS NULL');
  return Number(rows[0]?.n);
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
      const resultado = await ejecutarCatalogosControlado(connection);
      console.log(resultado.yaInstalado ? 'Catálogos ya instalados y verificados contra el contrato; sin cambios.' : 'Instalación y postcheck de catálogos completos.');
      if (resultado.comprasSinMapear > 0) console.log(`Compras históricas sin proveedor de Canecas: ${resultado.comprasSinMapear} (mapeo manual pendiente; no se modificó ningún dato).`);
    } catch (error) { console.error('DETENER: instalación no completada; conservar estado para recuperación supervisada.', error.message?.startsWith('DETENER:') ? error.message : (error.code || 'ERROR')); process.exitCode = 1; }
    finally { if (connection) await connection.end(); }
  }
}
