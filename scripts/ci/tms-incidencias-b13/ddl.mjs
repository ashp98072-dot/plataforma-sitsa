// TMS-INCIDENCIAS-ENTREGA B13 — DDL del laboratorio. PURO: no lee ni escribe archivos, no se conecta. Importar no tiene efectos.
// Reutiliza (sin modificar) los validadores del laboratorio B12 de API-06A. El SQL bajo prueba (sql/migrate-2026-11-tms-incidencias-resoluciones.sql, recuperado de PR #599
// SHA 92ec5123) se valida como lista CERRADA: exactamente 1 ALTER (índice único) + 2 CREATE TABLE, sin nada más.
import crypto from 'node:crypto';
import { fail } from '../pricesmart-api06a/safety.mjs';
import { splitStatements, tmsFixtureStatements, tmsMigrationStatements } from '../pricesmart-api06a/ddl.mjs';

export const B13_TABLES = Object.freeze(['tms_parada_incidencia_resoluciones', 'tms_parada_confirmacion_reintentos']);
/** SHA-256 (sobre LF) del SQL EXACTO de PR #599 (blob git d9c93225e21e9dd1deb427b1e537735eff72fb22). Cualquier cambio debe justificarse y actualizar este valor. */
export const SQL_B13_SHA256 = '89ff95b2aae8f080844e7f44c90c34f2f7193dc334ea6443912d125d384eae0e';
export const sha256Lf = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');

const FORBIDDEN = /\b(DROP|TRUNCATE|DELETE|GRANT|SIGNAL|UPDATE|INSERT|CREATE (DATABASE|USER))\b/i;

/** El SQL bajo prueba: 1 ALTER del índice único + 2 CREATE TABLE IF NOT EXISTS, en ese orden. */
export function b13MigrationStatements(text) {
  const st = splitStatements(text);
  if (st.length !== 3) fail('El SQL de incidencias debe tener exactamente 3 sentencias.');
  if (!/^ALTER TABLE tms_parada_confirmaciones\s+ADD UNIQUE KEY IF NOT EXISTS uq_tmspc_ref \(id, empresa_id, plan_id, parada_id\)$/.test(st[0])) fail('La primera sentencia debe ser el ALTER del índice único uq_tmspc_ref.');
  B13_TABLES.forEach((t, i) => { if (!st[i + 1].startsWith(`CREATE TABLE IF NOT EXISTS ${t} (`)) fail(`Orden/nombre de tabla inesperado: ${t}`); });
  if (st.some((s) => FORBIDDEN.test(s.replaceAll('ON DELETE RESTRICT', '')))) fail('El SQL de incidencias contiene sentencias no permitidas.');
  if ((st.join('\n').match(/ON DELETE RESTRICT/g) ?? []).length !== 5) fail('Se esperaban 5 claves foráneas RESTRICT.');
  return st;
}

/** `usuarios` mínima (solo laboratorio): mismos tipos que sql/schema.sql (id INT AUTO_INCREMENT PRIMARY KEY). */
export function usuariosFixtureStatements(text) {
  const st = splitStatements(text);
  if (st.length !== 1 || !st[0].startsWith('CREATE TABLE usuarios (') || /REFERENCES|DROP|DELETE|GRANT/i.test(st[0])) fail('La tabla de apoyo usuarios debe ser una única CREATE TABLE sin claves foráneas.');
  return st;
}

const T = (s) => s.trim();
/** Datos 100 % FICTICIOS (empresa 1 y 2). Sentencias EXACTAS: son la lista cerrada que el ejecutor y las pruebas de escenarios pueden usar. */
export const SEED = Object.freeze([
  T("INSERT INTO usuarios (id, username, nombre) VALUES (1, 'admin.ficticio', 'Admin Ficticio'), (2, 'ops.ficticio', 'Operaciones Ficticio'), (3, 'otro.ficticio', 'Otro Ficticio')"),
  T("INSERT INTO tms_planes_viaje (id, empresa_id, codigo, estado) VALUES (101, 1, 'E1-P1', 'En ruta'), (102, 1, 'E1-P2', 'En ruta'), (201, 2, 'E2-P1', 'En ruta')"),
  T("INSERT INTO tms_plan_paradas (id, plan_id, orden, lugar_nombre, tipo) VALUES (1011, 101, 1, 'E1 parada 1', 'Entrega'), (1012, 101, 2, 'E1 parada 2', 'Entrega'), (1021, 102, 1, 'E1 parada 3', 'Entrega'), (2011, 201, 1, 'E2 parada 1', 'Entrega')"),
  T("INSERT INTO flota_viajes (id, empresa_id, plan_id, estado) VALUES (11, 1, 101, 'abierto'), (12, 1, 102, 'abierto'), (21, 2, 201, 'abierto')"),
  T("INSERT INTO flota_viaje_evidencias (id, empresa_id, viaje_id, tipo, ruta_relativa, nombre_original, capturado_en, subido_por, creado_at, parada_id) VALUES "
    + "(501, 1, 11, 'producto', 'lab/e1-1.jpg', 'e1-1.jpg', '2026-11-11 10:00:00', 'portal:E1P1', '2026-11-11 10:00:00', 1011), "
    + "(502, 1, 11, 'producto', 'lab/e1-2.jpg', 'e1-2.jpg', '2026-11-11 10:05:00', 'portal:E1P1', '2026-11-11 10:05:00', 1012), "
    + "(503, 1, 12, 'producto', 'lab/e1-3.jpg', 'e1-3.jpg', '2026-11-11 10:10:00', 'portal:E1P1', '2026-11-11 10:10:00', 1021), "
    + "(601, 2, 21, 'producto', 'lab/e2-1.jpg', 'e2-1.jpg', '2026-11-11 10:20:00', 'portal:E2P1', '2026-11-11 10:20:00', 2011)"),
  T("INSERT INTO tms_parada_confirmaciones (id, empresa_id, plan_id, viaje_id, parada_id, parada_tipo, parada_orden, parada_lugar_nombre, resultado, revision, entrega_vigente, piloto_empleado_id, piloto_personal_id, piloto_usuario, evidencia_id, evidencia_ruta, evidencia_capturada_en, evidencia_subido_por, nota, confirmado_en) VALUES "
    + "(1, 1, 101, 11, 1011, 'Entrega', 1, 'E1 parada 1', 'PARCIAL', 'PENDIENTE', NULL, 1, 1, 'portal:E1P1', 501, 'lab/e1-1.jpg', '2026-11-11 10:00:00', 'portal:E1P1', 'faltaron cajas', '2026-11-11 10:01:00'), "
    + "(2, 1, 101, 11, 1012, 'Entrega', 2, 'E1 parada 2', 'ENTREGADA_POR_PILOTO', 'NO_REQUERIDA', 1, 1, 1, 'portal:E1P1', 502, 'lab/e1-2.jpg', '2026-11-11 10:05:00', 'portal:E1P1', NULL, '2026-11-11 10:06:00'), "
    + "(3, 2, 201, 21, 2011, 'Entrega', 1, 'E2 parada 1', 'INCIDENCIA', 'PENDIENTE', NULL, 2, 2, 'portal:E2P1', 601, 'lab/e2-1.jpg', '2026-11-11 10:20:00', 'portal:E2P1', 'cliente cerrado', '2026-11-11 10:21:00')"),
]);
/** Tablas existentes cuyo CONTENIDO se compara antes/después de aplicar el SQL (CHECKSUM TABLE). */
export const EXISTING_TABLES = Object.freeze(['usuarios', 'tms_planes_viaje', 'tms_plan_paradas', 'flota_viajes', 'flota_viaje_evidencias', 'tms_parada_confirmaciones']);
export const PRE_CHECKSUM = `CHECKSUM TABLE ${EXISTING_TABLES.join(', ')}`;
export const PRE_SHOW_CONFIRMACIONES = 'SHOW CREATE TABLE tms_parada_confirmaciones';
export const POST_CHECKSUM = PRE_CHECKSUM;
export const POST_SHOW_CONFIRMACIONES = PRE_SHOW_CONFIRMACIONES;

const q = (n) => `\`${n}\``;
/** Lista CERRADA de SQL administrativo del ejecutor B13. El orden importa: esquema → apoyo → migración B12 → datos → PRE-estado → SQL B13 → cuenta de aplicación. */
export function adminStatementsB13(m, { fixtureText, usuariosText, confirmacionesMigrationText, b13Text }) {
  if (!/^sandbox:[a-z0-9-]+:[a-f0-9]{64}$/.test(m.secrets.APP_PASSWORD)) fail('Forma de contraseña inválida.');
  const schema = q(m.schema); const app = `${q(m.appUser)}@${q('127.0.0.1')}`;
  const prerequisites = [...tmsFixtureStatements(fixtureText), ...usuariosFixtureStatements(usuariosText), ...tmsMigrationStatements(confirmacionesMigrationText)];
  const grants = [
    ...['usuarios', 'tms_planes_viaje', 'tms_plan_paradas', 'flota_viajes', 'flota_viaje_evidencias'].map((t) => `GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.${t} TO ${app}`),
    `GRANT SELECT, INSERT ON ${schema}.tms_parada_confirmaciones TO ${app}`,
    // Cuenta de aplicación ESTRICTA sobre lo nuevo: solo SELECT/INSERT (la aplicación futura nunca actualiza ni borra).
    ...B13_TABLES.map((t) => `GRANT SELECT, INSERT ON ${schema}.${t} TO ${app}`),
  ];
  return {
    setup: [`CREATE DATABASE ${schema} CHARACTER SET utf8mb4`, `USE ${schema}`, ...prerequisites, ...SEED, PRE_CHECKSUM, PRE_SHOW_CONFIRMACIONES],
    migration: b13MigrationStatements(b13Text),
    after: [POST_CHECKSUM, POST_SHOW_CONFIRMACIONES, `CREATE USER ${app} IDENTIFIED BY '${m.secrets.APP_PASSWORD}'`, ...grants],
  };
}
