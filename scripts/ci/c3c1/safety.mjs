// Puro salvo las consultas explícitas del llamador. No importa db.ts, dotenv ni inicializa conexiones.
import path from 'node:path';
export const LAB_DB = /^c3c1_lab_[a-f0-9]{32}$/;
/** Opciones del inicializador Windows 11.8.9, distintas de mariadbd/Unix.
 * --config se copia al nuevo data/my.ini; el bootstrap usa --defaults-file=my.ini.
 * Fuente: MariaDB/server, tag mariadb-11.8.9, sql/mysql_install_db.cc.
 */
export function configuracionInicializador(m, tempRoot) {
  validarManifiesto(m, tempRoot);
  const archivo = path.join(m.runDir, 'init-template.ini');
  return { archivo, contenido: '[mysqld]\r\nskip-networking=ON\r\nnamed-pipe=ON\r\n',
    args: [`--datadir=${m.datadir}`, `--socket=${m.pipe}`, '--skip-networking', `--config=${archivo}`] };
}
export function validarManifiesto(m, tempRoot) {
  if (!m || !/^[a-f0-9]{32}$/.test(m.id) || m.database !== `c3c1_lab_${m.id}` ||
      m.pipe !== `c3c1-${m.id}` || !/^[a-f0-9]{64}$/.test(m.token) || !Number.isInteger(m.pid) || m.pid <= 0) throw Error('Manifiesto C3C-1 inválido');
  const esperado = path.resolve(tempRoot, `novalvion-c3c1-${m.id}`);
  if (path.resolve(m.runDir) !== esperado || path.resolve(m.datadir) !== path.join(esperado, 'data') ||
      path.resolve(m.pidFile) !== path.join(esperado, 'server.pid')) throw Error('Directorio fuera del laboratorio');
  return m;
}
export function opcionesPipe(m, database = true) {
  if (!LAB_DB.test(m.database) || m.pipe !== `c3c1-${m.id}`) throw Error('Destino no permitido');
  return { socketPath: `\\\\.\\pipe\\${m.pipe}`, user: 'root', password: '',
    ...(database ? { database: m.database } : {}), multipleStatements: false, connectTimeout: 5000 };
}
export function validarOpciones(o, m) {
  const esperado = opcionesPipe(m, Boolean(o.database));
  if (Object.keys(o).some((k) => !Object.hasOwn(esperado, k)) || Object.keys(esperado).some((k) => o[k] !== esperado[k])) throw Error('Se prohíbe TCP, overrides y fallback');
}
export function validarIdentidadServidor(r, m) {
  const normal = (v) => path.resolve(String(v)).replace(/[\\/]+$/, '').toLowerCase();
  if (!r || normal(r.datadir) !== normal(m.datadir) || normal(r.pidFile) !== normal(m.pidFile) ||
      String(r.socket).toLowerCase() !== m.pipe.toLowerCase() || Number(r.sinRed) !== 1 ||
      !/^11\.8\./.test(String(r.version)) || !String(r.version).includes('MariaDB') || Number(r.fk) !== 1 || Number(r.checks) !== 1) throw Error('Identidad/configuración del servidor no autorizada');
}
export async function verificarConexion(c, m, comprobarPid, base = true) {
  const [rows] = await c.query('SELECT @@datadir AS datadir, @@pid_file AS pidFile, @@socket AS socket, @@skip_networking AS sinRed, @@version AS version, @@foreign_key_checks AS fk, @@check_constraint_checks AS checks');
  validarIdentidadServidor(rows[0], m);
  await comprobarPid(m);
  if (base) {
    const [db] = await c.query('SELECT DATABASE() AS nombre');
    if (db[0]?.nombre !== m.database) throw Error('Base no autorizada');
    // No crear una vista consistente antes del lock de empresa del servicio.
    // La marca es inmutable: los locks S son compatibles entre conexiones.
    // Sintaxis común a MySQL 8 y MariaDB 11.8, sin cambiar el aislamiento.
    const [marca] = await c.query(`SELECT token FROM \`${m.database}\`._c3c1_identity LOCK IN SHARE MODE`);
    if (marca.length !== 1 || marca[0].token !== m.token) throw Error('Identidad de base no autorizada');
  }
}
export function sentencias(sql) {
  // Artefactos deliberadamente sin rutinas, strings con punto y coma ni DELIMITER.
  if (/\bDELIMITER\b/i.test(sql)) throw Error('No se permiten rutinas SQL');
  return sql.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
}
export function prepararMigracion(sql, database) {
  if (!LAB_DB.test(database)) throw Error('Base no autorizada');
  const partes = sentencias(sql).map((s) => s.replaceAll('{{C3C1_SCHEMA}}', database));
  if (partes.length !== 2 || partes.some((s, i) => !s.startsWith(`CREATE TABLE \`${database}\`.${['cont_ejercicios', 'cont_periodos'][i]} (`) || /\b(DROP|ALTER|TRUNCATE|CALL|PROCEDURE|INSERT|DELETE|UPDATE)\b/i.test(s.replace(/ON (DELETE|UPDATE) RESTRICT/g, '')))) throw Error('Migración fuera del contrato');
  return partes;
}
export function aprobarControles(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.control !== 'string' || !rows[0].control ||
      ![0, '0', 0n].includes(rows[0].errores)) throw Error(`Control rechazado: ${rows?.[0]?.control ?? 'sin resultado'}`);
}
