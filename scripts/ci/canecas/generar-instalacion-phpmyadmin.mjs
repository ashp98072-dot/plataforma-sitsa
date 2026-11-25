// Genera los archivos SQL de la instalación MANUAL por etapas (phpMyAdmin) de la simplificación de Canecas (#688) a partir de las fuentes
// auditadas: sql/migrate-2026-11-canecas-simplificacion-wip.sql (sentencias DDL/trigger), sql/preflight-… y sql/postcheck-… y el contrato
// versionado (scripts/ci/canecas/contrato-simplificacion-mariadb-11.8.9.json). No ejecuta nada ni se conecta a ninguna base.
//   node scripts/ci/canecas/generar-instalacion-phpmyadmin.mjs          -> escribe sql/instalacion-manual-phpmyadmin/*.sql
// Reglas de los archivos generados: esquema explícito `u611730801_Plataforma` en TODA referencia (sin USE ni DATABASE()), solo ASCII, sin
// DROP/TRUNCATE/DELETE y sin tocar foreign_key_checks. Cada etapa de escritura empieza con una guarda que FALLA (error 1242) si la etapa
// previa no está completa; cada verificación es de solo lectura y devuelve filas OK/DETENER.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { consultasContratoSimplificacion } from './contrato-simplificacion.mjs';

export const BASE = 'u611730801_Plataforma';
export const DIR_SALIDA = 'sql/instalacion-manual-phpmyadmin';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const leer = rel => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const Q = `\`${BASE}\``;
const SEP = '\x1f', NULO = '<NULL>';

export const ascii = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, '?');
/** Califica con el esquema explícito toda referencia a tabla/trigger de las sentencias de la migración y de las verificaciones. */
export function calificar(sql) {
  return sql
    .replace(/\b(CREATE TABLE|ALTER TABLE|INSERT INTO)\s+(canecas_\w+)/g, `$1 ${Q}.$2`)
    .replace(/\b(FROM|JOIN)\s+(canecas_\w+|empresas)\b/g, `$1 ${Q}.$2`)
    .replace(/\bREFERENCES\s+(empresas)\(/g, `REFERENCES ${Q}.$1(`)
    .replace(/\b(CREATE OR REPLACE TRIGGER)\s+(trg_\w+)/g, `$1 ${Q}.$2`)
    .replace(/\bON\s+(canecas_ventas)\s+FOR EACH ROW/g, `ON ${Q}.$1 FOR EACH ROW`)
    .replace(/DATABASE\(\)/g, `'${BASE}'`);
}
/** Inverso exacto de `calificar` para sentencias de la migración (se usa en las pruebas de fidelidad). */
export const desCalificar = sql => sql.split(`${Q}.`).join('').replace(new RegExp(`'${BASE}'`, 'g'), 'DATABASE()');
const sinComentarios = sql => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

export function sentenciasMigracion() {
  const migracion = leer('sql/migrate-2026-11-canecas-simplificacion-wip.sql');
  const [ddl, triggerSql] = migracion.split('DELIMITER //');
  const sentencias = sinComentarios(ddl).split(';').map(x => x.trim()).filter(Boolean);
  const trigger = triggerSql.replace(/DELIMITER ;\s*$/, '').split('//').map(x => x.trim()).find(x => /^CREATE OR REPLACE TRIGGER /.test(x));
  if (sentencias.length !== 5 || !trigger) throw Error('formato de migración inesperado');
  const [secuencias, siembra, ventas, productos, compras] = sentencias;
  return { secuencias, siembra, ventas, productos, compras, trigger };
}

const filasVerificacion = (nombre, archivo) => {
  const texto = ascii(sinComentarios(leer(archivo)));
  const sentencias = texto.split(/;\s*\n/).map(x => x.trim()).filter(Boolean);
  return sentencias.map(calificar).map(x => `${x};`);
};

// ---- Condiciones de cada etapa (prerequisitos). En las etapas 1-5 la condición va DENTRO de la propia sentencia (PREPARE/EXECUTE): si no se cumple, lo que se
// ejecuta es una subconsulta que falla (error 1242) y la DDL no existe en ese momento. No depende de que el cliente se detenga tras un error. ----
const T = (tabla) => `(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${BASE}' AND TABLE_NAME='${tabla}')`;
const C = (tabla, col) => `(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${BASE}' AND TABLE_NAME='${tabla}' AND COLUMN_NAME='${col}')`;
const prerequisitosBase = `${T('canecas_ventas')}=1 AND ${T('canecas_productos')}=1 AND ${T('canecas_compras')}=1 AND ${T('empresas')}=1`;
// Modos que exige el instalador oficial, evaluados en la MISMA sesión que ejecuta la DDL: SQL estricto, InnoDB estricto y comprobaciones de FK y CHECK activas.
export const MODOS_OK = "@@SESSION.foreign_key_checks = 1 AND @@SESSION.check_constraint_checks = 1 AND @@SESSION.innodb_strict_mode = 1 AND (FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0)";
export const PROLOGO_MODOS = [
  'SET @sql_mode_previo = @@SESSION.sql_mode, @innodb_strict_previo = @@SESSION.innodb_strict_mode',
  "SET SESSION sql_mode = IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0 OR FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0, @@SESSION.sql_mode, CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES'))",
  'SET SESSION innodb_strict_mode = 1',
];
export const EPILOGO_MODOS = ['SET SESSION sql_mode = @sql_mode_previo', 'SET SESSION innodb_strict_mode = @innodb_strict_previo'];
const PREVIA = {
  1: ['01-verificar-previo.sql', `${prerequisitosBase} AND ${T('canecas_secuencias')}=0 AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${BASE}' AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd'))=2`],
  2: ['03-verificar-etapa1.sql', `${T('canecas_secuencias')}=1 AND (SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias)=0`],
  3: ['05-verificar-etapa2.sql', `(SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias)=(SELECT COUNT(*)*3 FROM \`${BASE}\`.empresas) AND ${C('canecas_ventas', 'direccion_entrega')}=0 AND ${C('canecas_ventas', 'doc_auto')}=0`],
  4: ['07-verificar-etapa3.sql', `${C('canecas_ventas', 'direccion_entrega')}=1 AND ${C('canecas_ventas', 'doc_auto')}=1 AND ${C('canecas_productos', 'activo_unico')}=0`],
  5: ['09-verificar-etapa4.sql', `${C('canecas_productos', 'activo_unico')}=1 AND ${C('canecas_compras', 'ref_auto')}=0`],
  6: ['11-verificar-etapa5.sql', `${C('canecas_compras', 'ref_auto')}=1 AND ${C('canecas_ventas', 'doc_auto')}=1 AND ${C('canecas_productos', 'activo_unico')}=1`],
};
const lit = t => { if (t.includes('\\')) throw Error('la sentencia contiene una barra invertida: no se puede incrustar sin escapes'); return `'${t.replace(/'/g, "''")}'`; };
/** Etapas 1-5: DDL incrustada en un PREPARE condicionado. Con condición falsa se ejecuta una subconsulta que falla y NO la DDL. */
function sentenciasEtapaPS(n, ddl) {
  const [verificacion, condicion] = PREVIA[n];
  const error = `SELECT (SELECT 'DETENER: prerequisitos o modos de sesion de la etapa ${n} incompletos' UNION ALL SELECT 'ejecute ${verificacion} y revise cada fila')`;
  return [
    ...PROLOGO_MODOS,
    `SET @etapa_sql = IF(\n${MODOS_OK} AND ${condicion},\n${lit(ddl)},\n${lit(error)})`,
    'PREPARE etapa_stmt FROM @etapa_sql',
    'EXECUTE etapa_stmt',
    'SHOW WARNINGS',
    'DEALLOCATE PREPARE etapa_stmt',
    ...EPILOGO_MODOS,
  ];
}
// ---- Verificación exacta contra el contrato versionado: huella MD5 por tabla y sección (misma consulta que usa el instalador). ----
const contrato = () => JSON.parse(readFileSync(path.join(root, 'scripts/ci/canecas/contrato-simplificacion-mariadb-11.8.9.json'), 'utf8'));
/** Huella de un conjunto de filas SIN GROUP_CONCAT (no depende de group_concat_max_len): "conteo:suma1:suma2", con dos sumas exactas de 64 bits del MD5 de cada fila. */
const huellaJs = filas => {
  let n = 0n, s1 = 0n, s2 = 0n;
  for (const f of filas) {
    const h = createHash('md5').update(Object.values(f).map(v => (v === null || v === undefined ? NULO : String(v))).join(SEP)).digest('hex');
    s1 += BigInt(`0x${h.slice(0, 16)}`); s2 += BigInt(`0x${h.slice(16)}`); n += 1n;
  }
  return `${n}:${s1}:${s2}`;
};
function consultaHuella(seccion, tabla) {
  const original = consultasContratoSimplificacion[seccion];
  const [, lista, resto] = original.match(/^SELECT (.+?) FROM (.+)$/);
  const columnas = lista.split(',').map(c => c.trim());
  const sinOrden = resto.replace(/ ORDER BY .*$/, '').replace(/DATABASE\(\)/g, `'${BASE}'`).replace(/TABLE_NAME IN \([^)]*\)/, `TABLE_NAME='${tabla}'`);
  const x = `CONCAT_WS(0x1f, ${columnas.map(c => `IFNULL(CAST(${c} AS CHAR),'${NULO}')`).join(', ')})`;
  const suma = (desde) => `COALESCE(SUM(CAST(CONV(SUBSTRING(MD5(x), ${desde}, 16), 16, 10) AS DECIMAL(65,0))), 0)`;
  return `(SELECT CONCAT(COUNT(*), ':', ${suma(1)}, ':', ${suma(17)}) FROM (SELECT ${x} AS x FROM ${sinOrden}) h)`;
}
export function verificacionTabla(tabla, etiqueta = tabla) {
  const c = contrato();
  const filas = [];
  for (const seccion of ['tablas', 'columnas', 'indices', 'foraneas', 'checks']) {
    const esperado = huellaJs(c[seccion].filter(f => f.TABLE_NAME === tabla));
    filas.push(`SELECT 'contrato ${seccion} de ${etiqueta} (huella exacta)' AS verificacion, IF(${consultaHuella(seccion, tabla)}='${esperado}', 'OK', 'DETENER') AS resultado;`);
  }
  return filas;
}
const normalizarTrigger = t => t.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
function verificacionTrigger(nombre, tabla, evento, cuerpo) {
  const esperado = normalizarTrigger(cuerpo).replace(/'/g, "''");
  return `SELECT 'trigger ${nombre} exacto (tiempo, evento, tabla y cuerpo normalizado)' AS verificacion, IF((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${BASE}' AND TRIGGER_NAME='${nombre}' AND EVENT_OBJECT_TABLE='${tabla}' AND ACTION_TIMING='BEFORE' AND EVENT_MANIPULATION='${evento}' AND BINARY TRIM(REGEXP_REPLACE(REPLACE(ACTION_STATEMENT, CHAR(13), ''), '[[:space:]]+', ' '))=BINARY '${esperado}')=1, 'OK', 'DETENER') AS resultado;`;
}
const cuerpoTrigger = ddl => ddl.replace(/^CREATE (?:OR REPLACE )?TRIGGER\s+\S+\s+BEFORE\s+\w+\s+ON\s+\S+\s+FOR EACH ROW\s+/, '');

function cabecera(titulo, lineas) {
  return ascii([`-- ${titulo}`, `-- Base de datos: ${BASE} (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).`, ...lineas.map(l => `-- ${l}`), '--'].join('\n'));
}
const AVISO_ESCRITURA = ['ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.',
  'Pegue y ejecute TODO el archivo en UNA sola peticion: fija y verifica en esa misma sesion SQL estricto e innodb_strict_mode y los restaura al final. No desactiva claves foraneas ni CHECK.',
  'Si cualquier sentencia da error, DETENGASE: no continue con otra etapa y use 15-recuperacion-solo-lectura.sql. Nunca avance tras un error.'];
const AVISO_LECTURA = ['VERIFICACION DE SOLO LECTURA: no modifica nada. Cada fila debe decir OK (o ser informativa). Cualquier DETENER: no continuar.'];
const GC_MIN = 1048576;
const PRELUDIO_GROUP_CONCAT = [`SET SESSION group_concat_max_len = ${GC_MIN};`, `SELECT 'group_concat_max_len suficiente (>= ${GC_MIN}) en esta sesion' AS verificacion, IF(@@SESSION.group_concat_max_len >= ${GC_MIN}, 'OK', 'DETENER') AS resultado;`];


/** Prueba SEGURA (sin DDL ni escrituras) del comportamiento del cliente ante un error: dice si, tras un error, el cliente sigue ejecutando las sentencias siguientes. */
function pruebaComportamientoErrores() {
  return `${cabecera('PRUEBA CONTROLADA (solo lectura, sin DDL): ¿este cliente continua despues de un error?'.replace('¿', '').replace('?', ''), [...AVISO_LECTURA,
    'Ejecutelo UNA vez en phpMyAdmin, antes de la etapa 1. La segunda sentencia falla A PROPOSITO (error 1242).',
    'Si en el resultado NO aparece la fila "DESPUES DEL ERROR", el cliente se detiene tras un error (esperado).',
    'Si SI aparece "DESPUES DEL ERROR", el cliente CONTINUA tras un error: no confie en que un error detenga el resto del archivo; aun asi todas las etapas de escritura llevan guarda intrinseca.'])}
SELECT 'ANTES DEL ERROR' AS marcador;
SELECT (SELECT 'error intencional' UNION ALL SELECT 'de la prueba') AS error_intencional;
SELECT 'DESPUES DEL ERROR: el cliente CONTINUA tras un error' AS marcador;
`;
}

/** Diagnostico de recuperacion de SOLO LECTURA con esquema explicito: funciona aunque phpMyAdmin tenga seleccionada information_schema u otra base. */
function recuperacion() {
  const E = (tabla, col) => `(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${BASE}' AND TABLE_NAME='${tabla}' AND COLUMN_NAME='${col}')`;
  const I = (tabla, indice) => `(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${BASE}' AND TABLE_NAME='${tabla}' AND INDEX_NAME='${indice}')`;
  const estado = (nombre, condicion) => `SELECT '${nombre}' AS etapa, IF(${condicion}, 'presente', 'ausente') AS estado`;
  const q = `\`${BASE}\``;
  return `${cabecera('RECUPERACION (solo lectura): estado por etapa de la instalacion manual', [...AVISO_LECTURA,
    'Usese tras CUALQUIER error en una etapa de escritura y antes de decidir. Todas las tablas y filtros llevan el esquema explicito: funciona con information_schema seleccionada.',
    'Un resultado vacio no prueba ausencia si la cuenta no tiene visibilidad.'])}
SELECT '${BASE}' AS base, VERSION() AS version, @@SESSION.sql_mode AS sql_mode, @@SESSION.innodb_strict_mode AS innodb_strict_mode;
-- 1) Estado por etapa (solo information_schema). Esperado al terminar la instalacion: las 6 filas en 'presente'.
${[
  estado('etapa 1: tabla canecas_secuencias', `${T('canecas_secuencias')}=1`),
  estado('etapa 3: canecas_ventas.direccion_entrega + chk_can_venta_direccion + doc_auto + uq_can_venta_doc_auto', `${E('canecas_ventas', 'direccion_entrega')}=1 AND ${E('canecas_ventas', 'doc_auto')}=1 AND ${I('canecas_ventas', 'uq_can_venta_doc_auto')}>0 AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='${BASE}' AND TABLE_NAME='canecas_ventas' AND CONSTRAINT_NAME='chk_can_venta_direccion')=1`),
  estado('etapa 4: canecas_productos.activo_unico + uq_can_producto_activo_unico', `${E('canecas_productos', 'activo_unico')}=1 AND ${I('canecas_productos', 'uq_can_producto_activo_unico')}>0`),
  estado('etapa 5: canecas_compras.ref_auto + uq_can_compra_ref_auto', `${E('canecas_compras', 'ref_auto')}=1 AND ${I('canecas_compras', 'uq_can_compra_ref_auto')}>0`),
  estado('etapa 6: trg_can_venta_bu protege direccion_entrega', `(SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${BASE}' AND TRIGGER_NAME='trg_can_venta_bu' AND ACTION_STATEMENT LIKE '%direccion_entrega%')=1`),
].join('\nUNION ALL ').replace(/\nUNION ALL SELECT/g, '\nUNION ALL SELECT')};
-- 2) Triggers de ventas: deben existir SIEMPRE los dos (bu y bd). CREATE OR REPLACE es atomico; si falta alguno, restaurar desde sql/migrate-2026-11-canecas-ventas-wip.sql.
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${BASE}' AND EVENT_OBJECT_TABLE='canecas_ventas' ORDER BY TRIGGER_NAME;
-- 3) Estructura de lo nuevo.
SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${BASE}' AND (TABLE_NAME='canecas_secuencias' OR (TABLE_NAME='canecas_ventas' AND COLUMN_NAME IN ('direccion_entrega','doc_auto')) OR (TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico') OR (TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto')) ORDER BY TABLE_NAME, ORDINAL_POSITION;
-- 4) Integridad de datos (no debe cambiar respecto del preflight): recuentos.
SELECT (SELECT COUNT(*) FROM ${q}.canecas_ventas) AS ventas, (SELECT COUNT(*) FROM ${q}.canecas_productos) AS productos, (SELECT COUNT(*) FROM ${q}.canecas_compras) AS compras;
-- 5) Etapa 2 (contadores): se consulta AL FINAL porque falla con 1146 si la etapa 1 no existe (es lo esperado en ese caso).
SELECT 'etapa 2: filas de canecas_secuencias (esperado: 3 por empresa)' AS etapa, (SELECT COUNT(*) FROM ${q}.canecas_secuencias) AS filas, (SELECT COUNT(*)*3 FROM ${q}.empresas) AS esperado;
--
-- RECUPERACION (SOLO con autorizacion expresa, respaldo verificado y escrituras de Canecas detenidas; MariaDB no revierte DDL). Mapa etapa -> reversion, en ORDEN INVERSO:
--   Etapa 6 (trigger): restaurar el trigger anterior con el CREATE OR REPLACE TRIGGER trg_can_venta_bu de sql/migrate-2026-11-canecas-ventas-wip.sql (con ${q}. en trigger y tabla y delimitador //).
--   Etapa 5: ALTER TABLE ${q}.canecas_compras DROP INDEX uq_can_compra_ref_auto, DROP COLUMN ref_auto;
--   Etapa 4: ALTER TABLE ${q}.canecas_productos DROP INDEX uq_can_producto_activo_unico, DROP COLUMN activo_unico;
--   Etapa 3: ALTER TABLE ${q}.canecas_ventas DROP INDEX uq_can_venta_doc_auto, DROP COLUMN doc_auto, DROP CONSTRAINT chk_can_venta_direccion, DROP COLUMN direccion_entrega;   (solo si ninguna venta nueva tiene direccion)
--   Etapa 2: no requiere reversion propia (solo inserta en la tabla nueva): se elimina junto con la etapa 1.
--   Etapa 1: DROP TABLE ${q}.canecas_secuencias;   (solo si esta vacia o sus numeros no se usan en registros)
-- Cada reversion es DDL y debe ejecutarse como una etapa de escritura: una sentencia por peticion, verificando el estado despues con este mismo archivo.
-- Si falla una etapa 4 o 5 con error 1062 o 1834 es porque hay mas de una caneca activa o documentos duplicados del formato generado: no hay nada que revertir, corrija los datos (decision del propietario) y reintente la etapa.
-- Caso instalacion completa con datos nuevos: NO revertir; el codigo antiguo de ventas sigue funcionando sin direccion.
`;
}

/** Devuelve { nombreArchivo: contenido } de toda la instalación por etapas. */
export function generar() {
  const m = sentenciasMigracion();
  const trigger = calificar(m.trigger);
  const bd = leer('sql/migrate-2026-11-canecas-ventas-wip.sql').split('DELIMITER //')[1].split('//').map(x => x.trim()).find(x => /^CREATE TRIGGER trg_can_venta_bd/.test(x));
  const preflight = filasVerificacion('preflight', 'sql/preflight-2026-11-canecas-simplificacion-wip.sql');
  const postcheck = filasVerificacion('postcheck', 'sql/postcheck-2026-11-canecas-simplificacion-wip.sql');
  if (preflight.length !== 22 || postcheck.length !== 15) throw Error('preflight/postcheck de origen con un numero inesperado de comprobaciones');
  const unir = (...bloques) => `${bloques.flat().join('\n')}\n`;
  const etapa = (n, titulo, sentencia, extraCab = []) => unir(cabecera(`ETAPA ${n}: ${titulo}`, [...AVISO_ESCRITURA, 'GUARDA INTRINSECA: la DDL va dentro de un PREPARE condicionado; si no se cumplen los prerequisitos o los modos, se ejecuta una subconsulta que falla (1242) y la DDL NO se ejecuta, aunque el cliente siguiera tras el error.', ...extraCab]), '', sentenciasEtapaPS(n, calificar(sentencia)).map(x => `${x};`));
  const verif = (titulo, filas, extra = []) => unir(cabecera(titulo, [...AVISO_LECTURA, ...extra]), '', filas);

  const contadoresIgualesMaximo = `SELECT 'contadores iguales al maximo historico por empresa y tipo (recien sembrados)' AS verificacion, IF((SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias s JOIN (SELECT e.id AS empresa_id, t.tipo, COALESCE(h.maximo,0) AS maximo FROM \`${BASE}\`.empresas e CROSS JOIN (SELECT 'COMPRA' AS tipo UNION ALL SELECT 'PRODUCTO' UNION ALL SELECT 'VENTA') t LEFT JOIN (SELECT empresa_id, 'COMPRA' AS tipo, MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(referencia)), '^COMP[ _-]?', '') AS UNSIGNED)) AS maximo FROM \`${BASE}\`.canecas_compras WHERE UPPER(TRIM(referencia)) REGEXP '^COMP[ _-]?[0-9]{1,15}$' GROUP BY empresa_id UNION ALL SELECT empresa_id, 'VENTA', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(documento)), '^VTA[ _-]?', '') AS UNSIGNED)) FROM \`${BASE}\`.canecas_ventas WHERE UPPER(TRIM(documento)) REGEXP '^VTA[ _-]?[0-9]{1,15}$' GROUP BY empresa_id UNION ALL SELECT empresa_id, 'PRODUCTO', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(codigo)), '^CAN[ _-]?', '') AS UNSIGNED)) FROM \`${BASE}\`.canecas_productos WHERE UPPER(TRIM(codigo)) REGEXP '^CAN[ _-]?[0-9]{1,15}$' GROUP BY empresa_id) h ON h.empresa_id=e.id AND h.tipo=t.tipo) esperado ON esperado.empresa_id=s.empresa_id AND esperado.tipo=s.tipo WHERE s.ultimo=esperado.maximo)=(SELECT COUNT(*)*3 FROM \`${BASE}\`.empresas) AND (SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias)=(SELECT COUNT(*)*3 FROM \`${BASE}\`.empresas), 'OK', 'DETENER') AS resultado;`;
  const recuentos = [`SELECT 'recuento canecas_ventas (debe coincidir con el preflight)' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM \`${BASE}\`.canecas_ventas;`, `SELECT 'recuento canecas_productos (debe coincidir con el preflight)' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM \`${BASE}\`.canecas_productos;`, `SELECT 'recuento canecas_compras' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM \`${BASE}\`.canecas_compras;`];

  return {
    '00-prueba-comportamiento-errores-solo-lectura.sql': pruebaComportamientoErrores(),
    '01-verificar-previo.sql': verif('PASO 0 - PREFLIGHT (22 comprobaciones, solo lectura): estado previo a la instalacion', [...PRELUDIO_GROUP_CONCAT, ...preflight], ['Deben quedar solo OK e informativas. Ejecutelo de nuevo justo antes de la etapa 1.']),
    '02-etapa1-crear-secuencias.sql': etapa(1, 'crear la tabla canecas_secuencias (vacia)', m.secuencias),
    '03-verificar-etapa1.sql': verif('VERIFICACION de la etapa 1 (y prerequisito de la etapa 2)', [...verificacionTabla('canecas_secuencias'), `SELECT 'canecas_secuencias vacia' AS verificacion, IF((SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias)=0, 'OK', 'DETENER') AS resultado;`]),
    '04-etapa2-sembrar-contadores.sql': etapa(2, 'sembrar los contadores con el maximo historico por empresa y tipo (INSERT solo en la tabla nueva)', m.siembra, ['No renumera ni modifica ningun documento existente; no rellena huecos.']),
    '05-verificar-etapa2.sql': verif('VERIFICACION de la etapa 2 (y prerequisito de la etapa 3)', [contadoresIgualesMaximo, ...recuentos]),
    '06-etapa3-alterar-ventas.sql': etapa(3, 'canecas_ventas: direccion_entrega, CHECK, doc_auto y UNIQUE (una sola sentencia ALTER)', m.ventas),
    '07-verificar-etapa3.sql': verif('VERIFICACION de la etapa 3 (y prerequisito de la etapa 4)', [...verificacionTabla('canecas_ventas'), `SELECT 'ventas historicas sin direccion (no se inventan datos)' AS verificacion, IF((SELECT COUNT(*) FROM \`${BASE}\`.canecas_ventas WHERE direccion_entrega IS NOT NULL)=0, 'OK', 'DETENER') AS resultado;`, ...recuentos]),
    '08-etapa4-alterar-productos.sql': etapa(4, 'canecas_productos: activo_unico (virtual) y UNIQUE (una caneca activa por empresa)', m.productos, ['Falla (clave duplicada) si alguna empresa tiene mas de una caneca activa: el preflight lo detecta antes.']),
    '09-verificar-etapa4.sql': verif('VERIFICACION de la etapa 4 (y prerequisito de la etapa 5)', [...verificacionTabla('canecas_productos'), ...recuentos]),
    '10-etapa5-alterar-compras.sql': etapa(5, 'canecas_compras: ref_auto (virtual) y UNIQUE de referencias con formato generado', m.compras, ['Falla (clave duplicada) si hay COMP-###### repetido dentro de una empresa: el preflight lo detecta antes.']),
    '11-verificar-etapa5.sql': verif('VERIFICACION de la etapa 5 (y prerequisito de la etapa 6)', [...verificacionTabla('canecas_compras'), ...recuentos]),
    '12-etapa6-reemplazar-trigger.sql': unir(cabecera('ETAPA 6: reemplazar trg_can_venta_bu (CREATE OR REPLACE: atomico, la tabla nunca queda sin trigger)', [...AVISO_ESCRITURA, 'EN phpMyAdmin (pestana SQL) ponga el campo "Delimitador" en // antes de ejecutar. Cada sentencia de este archivo termina en //.', 'GUARDA INTRINSECA: el CREATE OR REPLACE TRIGGER va dentro de un PREPARE condicionado (MariaDB 11.8.9 lo admite; probado); si no se cumplen los prerequisitos o los modos, se ejecuta una subconsulta que falla (1242) y el trigger NO se reemplaza, aunque el cliente siguiera tras el error.']), '', sentenciasEtapaPS(6, trigger).map(x => `${x}//`)),
    '13-verificar-etapa6.sql': verif('VERIFICACION de la etapa 6 (triggers de ventas)', [verificacionTrigger('trg_can_venta_bu', 'canecas_ventas', 'UPDATE', cuerpoTrigger(trigger)), verificacionTrigger('trg_can_venta_bd', 'canecas_ventas', 'DELETE', cuerpoTrigger(calificar(bd)))]),
    '14-verificar-final.sql': verif('VERIFICACION FINAL (solo lectura): postcheck de 15 comprobaciones + contrato exacto de las 4 tablas y 2 triggers', [
      ...postcheck,
      ...['canecas_secuencias', 'canecas_ventas', 'canecas_productos', 'canecas_compras'].flatMap(t => verificacionTabla(t)),
      verificacionTrigger('trg_can_venta_bu', 'canecas_ventas', 'UPDATE', cuerpoTrigger(trigger)),
      verificacionTrigger('trg_can_venta_bd', 'canecas_ventas', 'DELETE', cuerpoTrigger(calificar(bd))),
    ], ['Resultado esperado: todo OK; las filas "empresas sin contador completo" y "siguientes numeros ya en uso" deben decir 0.']),
    '15-recuperacion-solo-lectura.sql': recuperacion(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const salida = path.join(root, DIR_SALIDA);
  mkdirSync(salida, { recursive: true });
  for (const [nombre, contenido] of Object.entries(generar())) writeFileSync(path.join(salida, nombre), contenido);
  console.log(`Archivos escritos en ${DIR_SALIDA}`);
}
