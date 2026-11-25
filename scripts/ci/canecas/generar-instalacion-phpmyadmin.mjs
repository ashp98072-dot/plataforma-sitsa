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
const SEP = '\x1f', SEP_FILAS = '~~', NULO = '<NULL>'; // SEPARATOR de GROUP_CONCAT exige literal: '~~' no aparece en los metadatos hasheados

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

// ---- Guardas: fallan (error 1242 «Subquery returns more than 1 row») si no se cumple la condición; las ejecuciones de la etapa NO continúan. ----
const T = (tabla) => `(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${BASE}' AND TABLE_NAME='${tabla}')`;
const C = (tabla, col) => `(SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${BASE}' AND TABLE_NAME='${tabla}' AND COLUMN_NAME='${col}')`;
function guarda(etapa, condicion, previa) {
  return `-- GUARDA: si falla, MariaDB responde error 1242 en esta sentencia y NO se ejecuta nada de la etapa ${etapa}. Significa: ${previa}\n`
    + `SELECT CASE WHEN ${condicion} THEN 'GUARDA OK etapa ${etapa}' ELSE (SELECT 'DETENER: prerequisitos de la etapa ${etapa} incompletos' UNION ALL SELECT 'ver ${previa}') END AS guarda;`;
}
const prerequisitosBase = `${T('canecas_ventas')}=1 AND ${T('canecas_productos')}=1 AND ${T('canecas_compras')}=1 AND ${T('empresas')}=1`;
const GUARDAS = {
  1: guarda(1, `${prerequisitosBase} AND ${T('canecas_secuencias')}=0 AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${BASE}' AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd'))=2`, 'ejecute 01-verificar-previo.sql y revise cada fila'),
  2: guarda(2, `${T('canecas_secuencias')}=1 AND (SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias)=0`, 'ejecute 03-verificar-etapa1.sql'),
  3: guarda(3, `(SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias)=(SELECT COUNT(*)*3 FROM \`${BASE}\`.empresas) AND ${C('canecas_ventas', 'direccion_entrega')}=0 AND ${C('canecas_ventas', 'doc_auto')}=0`, 'ejecute 05-verificar-etapa2.sql'),
  4: guarda(4, `${C('canecas_ventas', 'direccion_entrega')}=1 AND ${C('canecas_ventas', 'doc_auto')}=1 AND ${C('canecas_productos', 'activo_unico')}=0`, 'ejecute 07-verificar-etapa3.sql'),
  5: guarda(5, `${C('canecas_productos', 'activo_unico')}=1 AND ${C('canecas_compras', 'ref_auto')}=0`, 'ejecute 09-verificar-etapa4.sql'),
  6: guarda(6, `${C('canecas_compras', 'ref_auto')}=1 AND ${C('canecas_ventas', 'doc_auto')}=1 AND ${C('canecas_productos', 'activo_unico')}=1`, 'ejecute 11-verificar-etapa5.sql'),
};

// ---- Verificación exacta contra el contrato versionado: huella MD5 por tabla y sección (misma consulta que usa el instalador). ----
const contrato = () => JSON.parse(readFileSync(path.join(root, 'scripts/ci/canecas/contrato-simplificacion-mariadb-11.8.9.json'), 'utf8'));
const huellaJs = filas => createHash('md5').update(filas.map(f => Object.values(f).map(v => (v === null || v === undefined ? NULO : String(v))).join(SEP)).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).join(SEP_FILAS)).digest('hex');
function consultaHuella(seccion, tabla) {
  const original = consultasContratoSimplificacion[seccion];
  const [, lista, resto] = original.match(/^SELECT (.+?) FROM (.+)$/);
  const columnas = lista.split(',').map(c => c.trim());
  const sinOrden = resto.replace(/ ORDER BY .*$/, '').replace(/DATABASE\(\)/g, `'${BASE}'`).replace(/TABLE_NAME IN \([^)]*\)/, `TABLE_NAME='${tabla}'`);
  const x = `CONCAT_WS(0x1f, ${columnas.map(c => `IFNULL(CAST(${c} AS CHAR),'${NULO}')`).join(', ')})`;
  return `(SELECT COALESCE(MD5(GROUP_CONCAT(x ORDER BY BINARY x SEPARATOR '${SEP_FILAS}')), MD5('')) FROM (SELECT ${x} AS x FROM ${sinOrden}) h)`;
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
const cuerpoTrigger = ddl => ddl.replace(/^CREATE OR REPLACE TRIGGER\s+\w+\s+BEFORE\s+\w+\s+ON\s+\w+\s+FOR EACH ROW\s+/, '');

function cabecera(titulo, lineas) {
  return ascii([`-- ${titulo}`, `-- Base de datos: ${BASE} (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).`, ...lineas.map(l => `-- ${l}`), '--'].join('\n'));
}
const AVISO_ESCRITURA = ['ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.',
  'No marque "Ignorar errores"; deje activada la casilla de claves foraneas. Si una sentencia da error, DETENGASE y use sql/recuperacion-canecas-simplificacion-solo-lectura.sql.'];
const AVISO_LECTURA = ['VERIFICACION DE SOLO LECTURA: no modifica nada. Cada fila debe decir OK (o ser informativa). Cualquier DETENER: no continuar.'];

/** Devuelve { nombreArchivo: contenido } de toda la instalación por etapas. */
export function generar() {
  const m = sentenciasMigracion();
  const trigger = calificar(m.trigger);
  const bd = leer('sql/migrate-2026-11-canecas-ventas-wip.sql').split('DELIMITER //')[1].split('//').map(x => x.trim()).find(x => /^CREATE TRIGGER trg_can_venta_bd/.test(x));
  const preflight = filasVerificacion('preflight', 'sql/preflight-2026-11-canecas-simplificacion-wip.sql');
  const postcheck = filasVerificacion('postcheck', 'sql/postcheck-2026-11-canecas-simplificacion-wip.sql');
  if (preflight.length !== 22 || postcheck.length !== 15) throw Error('preflight/postcheck de origen con un numero inesperado de comprobaciones');
  const unir = (...bloques) => `${bloques.flat().join('\n')}\n`;
  const etapa = (n, titulo, sentencia, extraCab = []) => unir(cabecera(`ETAPA ${n}: ${titulo}`, [...AVISO_ESCRITURA, ...extraCab]), '', GUARDAS[n], '', `${calificar(sentencia)};`);
  const verif = (titulo, filas, extra = []) => unir(cabecera(titulo, [...AVISO_LECTURA, ...extra]), '', filas);

  const contadoresIgualesMaximo = `SELECT 'contadores iguales al maximo historico por empresa y tipo (recien sembrados)' AS verificacion, IF((SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias s JOIN (SELECT e.id AS empresa_id, t.tipo, COALESCE(h.maximo,0) AS maximo FROM \`${BASE}\`.empresas e CROSS JOIN (SELECT 'COMPRA' AS tipo UNION ALL SELECT 'PRODUCTO' UNION ALL SELECT 'VENTA') t LEFT JOIN (SELECT empresa_id, 'COMPRA' AS tipo, MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(referencia)), '^COMP[ _-]?', '') AS UNSIGNED)) AS maximo FROM \`${BASE}\`.canecas_compras WHERE UPPER(TRIM(referencia)) REGEXP '^COMP[ _-]?[0-9]{1,15}$' GROUP BY empresa_id UNION ALL SELECT empresa_id, 'VENTA', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(documento)), '^VTA[ _-]?', '') AS UNSIGNED)) FROM \`${BASE}\`.canecas_ventas WHERE UPPER(TRIM(documento)) REGEXP '^VTA[ _-]?[0-9]{1,15}$' GROUP BY empresa_id UNION ALL SELECT empresa_id, 'PRODUCTO', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(codigo)), '^CAN[ _-]?', '') AS UNSIGNED)) FROM \`${BASE}\`.canecas_productos WHERE UPPER(TRIM(codigo)) REGEXP '^CAN[ _-]?[0-9]{1,15}$' GROUP BY empresa_id) h ON h.empresa_id=e.id AND h.tipo=t.tipo) esperado ON esperado.empresa_id=s.empresa_id AND esperado.tipo=s.tipo WHERE s.ultimo=esperado.maximo)=(SELECT COUNT(*)*3 FROM \`${BASE}\`.empresas) AND (SELECT COUNT(*) FROM \`${BASE}\`.canecas_secuencias)=(SELECT COUNT(*)*3 FROM \`${BASE}\`.empresas), 'OK', 'DETENER') AS resultado;`;
  const recuentos = [`SELECT 'recuento canecas_ventas (debe coincidir con el preflight)' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM \`${BASE}\`.canecas_ventas;`, `SELECT 'recuento canecas_productos (debe coincidir con el preflight)' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM \`${BASE}\`.canecas_productos;`, `SELECT 'recuento canecas_compras' AS verificacion, CAST(COUNT(*) AS CHAR) AS resultado FROM \`${BASE}\`.canecas_compras;`];

  return {
    '01-verificar-previo.sql': verif('PASO 0 - PREFLIGHT (22 comprobaciones, solo lectura): estado previo a la instalacion', preflight, ['Deben quedar solo OK e informativas. Ejecutelo de nuevo justo antes de la etapa 1.']),
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
    '12-etapa6-reemplazar-trigger.sql': unir(cabecera('ETAPA 6: reemplazar trg_can_venta_bu (CREATE OR REPLACE: atomico, la tabla nunca queda sin trigger)', [...AVISO_ESCRITURA, 'EN phpMyAdmin (pestana SQL) ponga el campo "Delimitador" en // antes de ejecutar. Cada sentencia de este archivo termina en //.']), '', GUARDAS[6].replace(/;$/, '//'), '', `${trigger}//`),
    '13-verificar-etapa6.sql': verif('VERIFICACION de la etapa 6 (triggers de ventas)', [verificacionTrigger('trg_can_venta_bu', 'canecas_ventas', 'UPDATE', cuerpoTrigger(trigger)), verificacionTrigger('trg_can_venta_bd', 'canecas_ventas', 'DELETE', cuerpoTrigger(calificar(bd)).replace(/^CREATE TRIGGER\s+\S+\s+BEFORE\s+\w+\s+ON\s+\S+\s+FOR EACH ROW\s+/, ''))]),
    '14-verificar-final.sql': verif('VERIFICACION FINAL (solo lectura): postcheck de 15 comprobaciones + contrato exacto de las 4 tablas y 2 triggers', [
      ...postcheck,
      ...['canecas_secuencias', 'canecas_ventas', 'canecas_productos', 'canecas_compras'].flatMap(t => verificacionTabla(t)),
      verificacionTrigger('trg_can_venta_bu', 'canecas_ventas', 'UPDATE', cuerpoTrigger(trigger)),
      verificacionTrigger('trg_can_venta_bd', 'canecas_ventas', 'DELETE', cuerpoTrigger(calificar(bd)).replace(/^CREATE TRIGGER\s+\S+\s+BEFORE\s+\w+\s+ON\s+\S+\s+FOR EACH ROW\s+/, '')),
    ], ['Resultado esperado: todo OK; las filas "empresas sin contador completo" y "siguientes numeros ya en uso" deben decir 0.']),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const salida = path.join(root, DIR_SALIDA);
  mkdirSync(salida, { recursive: true });
  for (const [nombre, contenido] of Object.entries(generar())) writeFileSync(path.join(salida, nombre), contenido);
  console.log(`Archivos escritos en ${DIR_SALIDA}`);
}
