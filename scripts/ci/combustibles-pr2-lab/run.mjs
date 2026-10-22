// Laboratorio aislado: Actions/Docker o backend portable Windows explicitamente autorizado.
// No importa codigo de aplicacion ni .env.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImport, compoundBody } from './build-phpmyadmin-import.mjs';
import { buildPostcheck } from './build-phpmyadmin-postcheck.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, '../../..');
const files = Object.fromEntries(['preflight', 'migrate', 'postcheck'].map(name => [
  name, path.join(repo, `sql/${name}-2026-10-combustibles-pr2-consumos-facturas.sql`),
]));
const sql = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')]));
const fixture = name => fs.readFileSync(path.join(dir, `${name}.sql`), 'utf8');
const names = ['flota_cb2_importaciones', 'flota_cb2_facturas', 'flota_cb2_consumos', 'flota_cb2_filas'];
const list = names.map(n => `'${n}'`).join(',');
const tests = [];
let evidence, registryPath, registry, dockerConfig, image;
let serial = 0;
let nativeLab;

function rows(output) {
  return output.trim().split(/\r?\n/).filter(Boolean).map(line => line.split('\t'));
}
function state(output, scope, key, expected) {
  const matches = rows(output).filter(r => r[0] === scope && r[1] === key);
  assert.equal(matches.length, 1, `Debe existir un unico ${scope}/${key}`);
  assert.equal(matches[0][2], expected, `${scope}/${key}`);
}
function preState(output, expected) {
  const matches = rows(output).filter(r => r[0] === 'RESUMEN' && r[1] === expected);
  assert.equal(matches.length, 1, `preflight no certifica ${expected}`);
  assert.equal(rows(output).filter(r => r[0] === 'RESUMEN' && ['CLEAN', 'FINAL', 'DIVERGENTE'].includes(r[1])).length, 1);
  if (expected !== 'DIVERGENTE') state(output, 'RESUMEN', 'base_compatible', '1');
  if (expected === 'FINAL') assert.equal(matches[0][2], '1', 'FINAL exige nuevas_ok=1');
  if (expected === 'CLEAN') assert.equal(matches[0][2], '0', 'CLEAN no contiene tablas nuevas');
}
function postFinal(output) {
  state(output, 'METADATA', 'estado_esquema_cb2', 'FINAL');
  state(output, 'RESULTADO', 'estado_postcheck', 'FINAL');
  const checks = rows(output).filter(r => r[0] === 'DATO');
  assert.equal(checks.length, 15, 'Se requieren las 15 comprobaciones');
  assert.equal(new Set(checks.map(r => r[1])).size, 15, 'Controles repetidos');
  for (const check of checks) assert.equal(check[2], '0', check[1]);
}
function rejected(result, code, detail = '') {
  assert.equal(result.status, 1, 'Se requiere error SQL, no timeout/senal');
  assert(!result.error && !result.signal, 'Fallo del proceso');
  const errors = [...result.stderr.matchAll(/^ERROR (\d+) \(([0-9A-Z]{5})\)(?: at line \d+)?: (.+)$/gm)];
  assert.equal(errors.length, 1, 'Se requiere exactamente un diagnostico SQL');
  assert.equal((result.stderr.match(/^ERROR\b/gm) ?? []).length, 1, 'Diagnosticos adicionales/no reconocidos');
  assert.equal(Number(errors[0][1]), code, 'Codigo SQL inesperado');
  assert.equal(errors[0][2], code === 1644 ? '45000' : '23000', 'SQLSTATE inesperado');
  const message = errors[0][3];
  if (detail && code === 1452) assert(message.includes(`CONSTRAINT \`${detail}\` FOREIGN KEY`), `FK ajena a ${detail}`);
  else if (detail && code === 4025) assert(message.startsWith(`CONSTRAINT \`${detail}\` failed for `), `CHECK ajeno a ${detail}`);
  else if (detail && code === 1062) assert(message.endsWith(`for key '${detail}'`), `Indice ajeno a ${detail}`);
  else if (detail) assert.equal(message, detail, 'SIGNAL inesperado');
}
function ciGuard() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REPOSITORY, 'ashp98072-dot/plataforma-sitsa');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.match(process.env.CB2_AUDITED_SHA ?? '', /^[0-9a-f]{40}$/);
  assert.notEqual(process.env.CB2_AUDITED_SHA, '0'.repeat(40), 'Falta fijar SHA auditado');
  assert.match(process.env.GITHUB_SHA ?? '', /^[0-9a-f]{40}$/);
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/);
  assert.match(process.env.GITHUB_RUN_ATTEMPT ?? '', /^\d+$/);
  assert(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP));
  assert(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'No se admiten endpoints Docker externos');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(String(event.inputs?.auditoria_aprobada), 'true', 'Requiere confirmacion manual posterior a auditoria');
}
function save(name, value) {
  assert.match(name, /^[a-zA-Z0-9_.-]+$/);
  fs.writeFileSync(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function docker(args, input = '', allowFailure = false) {
  // Sin shell, configuracion de registry vacia y sin heredar tokens/credenciales del runner.
  const result = spawnSync('docker', ['--config', dockerConfig, '--host', 'unix:///var/run/docker.sock', ...args], {
    input, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: path.dirname(dockerConfig), LANG: 'C.UTF-8' },
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new Error(`Docker ${args[0]} fallo: ${result.error?.message ?? ''}\n${result.stderr}`);
  }
  return result;
}
function inspect(container) {
  const objects = JSON.parse(docker(['inspect', container]).stdout);
  assert.equal(objects.length, 1);
  const obj = objects[0];
  assert.equal(obj.Config.Labels['sitsa.cb2.run'], registry.run);
  assert.equal(obj.HostConfig.NetworkMode, 'none');
  assert.equal(Object.keys(obj.HostConfig.PortBindings ?? {}).length, 0);
  assert(obj.Mounts.every(m => m.Type === 'tmpfs'), 'Prohibido volumen/bind mount persistente');
  assert(obj.Mounts.some(m => m.Type === 'tmpfs' && m.Destination === '/var/lib/mysql'));
  assert(obj.Args.includes('--skip-networking'));
  return obj;
}
function record(test, action) {
  const began = new Date().toISOString();
  try {
    const value = action();
    tests.push({ test, began, status: 'PASS' });
    return value;
  } catch (error) {
    tests.push({ test, began, status: 'FAIL', error: error.message });
    throw error;
  } finally { save('results.json', tests); }
}
function query(container, label, input, expectedCode = 0, detail = '', db = true) {
  if (db) input = "SET @cb2_schema = _utf8mb4'cb2_lab';\n" + input;
  const id = `${String(++serial).padStart(3, '0')}-${label}`;
  save(`${id}.sql`, input);
  const result = nativeLab ? nativeLab.execute(container, input, db) : docker(['exec', '-i', container, 'mariadb', '--no-defaults', '--protocol=socket', '-uroot',
    '--batch', '--raw', '--skip-column-names', ...(db ? ['--database=cb2_lab'] : [])], input, true);
  save(`${id}.json`, { status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  assert(!result.error, result.error?.message);
  if (expectedCode) rejected(result, expectedCode, detail);
  else assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function cleanupOne(container) {
  assert.match(container, /^sitsa-cb2-[0-9a-f-]{36}$/);
  assert(registry.containers.includes(container));
  const probe = docker(['container', 'ls', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}']).stdout.trim();
  if (!probe) return;
  assert.equal(probe, container);
  // No eliminar un recurso si su identidad/aislamiento ya no coincide.
  save(`${container}-inspect.json`, inspect(container));
  const logs = docker(['logs', container], '', true);
  save(`${container}.log`, (logs.stdout ?? '') + (logs.stderr ?? ''));
  docker(['rm', '--force', container]);
}
function laboratory(label, action) {
  if (nativeLab) return nativeLab.laboratory(label, action, fixture, query);
  const container = `sitsa-cb2-${randomUUID()}`;
  registry.containers.push(container);
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  docker(['run', '--detach', '--name', container, '--label', `sitsa.cb2.run=${registry.run}`,
    '--network', 'none', '--tmpfs', '/var/lib/mysql:rw,size=1073741824',
    '--tmpfs', '/run/mysqld:rw,size=67108864', '--memory', '2g', '--cpus', '2',
    '-e', 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1', '-e', 'MARIADB_ROOT_HOST=localhost',
    image, '--skip-networking', '--sql-mode=STRICT_ALL_TABLES', '--group-concat-max-len=8192', '--innodb-strict-mode=ON']);
  try {
    save(`${label}-isolation.json`, inspect(container));
    let ready = false;
    for (let n = 0; n < 90; n++) {
      const result = docker(['exec', container, 'mariadb', '--no-defaults', '--protocol=socket', '-uroot',
        '--batch', '--skip-column-names', '-e', 'SELECT VERSION();'], '', true);
      if (result.status === 0) { assert.match(result.stdout.trim(), /^11\.8\..*MariaDB/); ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    assert(ready, 'MariaDB 11.8 no inicializada');
    query(container, `${label}-crear`, 'CREATE DATABASE cb2_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;', 0, '', false);
    query(container, `${label}-base`, fixture('base'));
    query(container, `${label}-version`, 'SELECT VERSION(),@@sql_mode,@@innodb_page_size,@@foreign_key_checks,@@check_constraint_checks,@@group_concat_max_len,@@skip_networking;');
    action(container);
  } finally { cleanupOne(container); }
}
function migrate(container) {
  preState(query(container, 'preflight-clean', sql.preflight), 'CLEAN');
  preState(query(container, 'preflight-contexto-information-schema', 'USE information_schema;\n' + sql.preflight), 'CLEAN');
  preState(query(container, 'preflight-sin-objetivo', 'SET @cb2_schema = NULL;\n' + sql.preflight), 'DIVERGENTE');
  preState(query(container, 'preflight-innodb-no-estricto', 'SET SESSION innodb_strict_mode = OFF;\n' + sql.preflight), 'DIVERGENTE');
  query(container, 'crear-otro-esquema-sintetico', 'CREATE DATABASE cb2_other;');
  query(container, 'migracion-contexto-incorrecto', 'USE cb2_other;\n' + sql.migrate, 1644, 'CB2: se requiere CLEAN y base compatible');
  assert.equal(query(container, 'otro-esquema-sin-tablas', "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='cb2_other';").trim(), '0');
  const before = query(container, 'postcheck-clean', sql.postcheck);
  state(before, 'METADATA', 'estado_esquema_cb2', 'CLEAN');
  state(before, 'RESULTADO', 'estado_postcheck', 'DIVERGENTE');
  assert(!rows(before).some(r => r[0] === 'DATO'));
  assert.equal(query(container, 'migrar', sql.migrate).trim(), 'APLICADA_PENDIENTE_POSTCHECK\tFINAL');
  preState(query(container, 'preflight-final', sql.preflight), 'FINAL');
  postFinal(query(container, 'postcheck-vacio', sql.postcheck));
  const wrongContext = query(container, 'postcheck-contexto-incorrecto', 'USE information_schema;\n' + sql.postcheck);
  state(wrongContext, 'METADATA', 'estado_esquema_cb2', 'FINAL');
  state(wrongContext, 'RESULTADO', 'estado_postcheck', 'DIVERGENTE');
  assert(!rows(wrongContext).some(row => row[0] === 'DATO'));

}
const snapshotTables = [...names, 'empresas', 'usuarios', 'compras_proveedores', 'flota_vehiculos',
  'flota_vehiculo_acceso', 'flota_combustible_cargas', 'flota_combustible_conciliaciones',
  'flota_combustible_conciliacion_filas', 'auditoria'].sort();
const scalarTypes = new Set(['tinyint', 'smallint', 'int', 'bigint', 'decimal', 'date', 'datetime']);
const stringTypes = new Set(['char', 'varchar', 'text', 'longtext']);
function snapshotSelect(table, fields) {
  assert(snapshotTables.includes(table));
  assert(fields.length > 0);
  const expressions = fields.flatMap(field => {
    assert.match(field.name, /^[a-z0-9_]+$/);
    assert(scalarTypes.has(field.type) || stringTypes.has(field.type), `Tipo sin codificacion auditada: ${table}.${field.name} (${field.type})`);
    const column = '\x60' + field.name + '\x60';
    // HEX(numero) redondea/convierte como BIGINT. Primero texto exacto para escalares;
    // strings conservan bytes originales, sin conversion de charset ni longitud limitada.
    const bytes = scalarTypes.has(field.type)
      ? 'CAST(CAST(' + column + ' AS CHAR CHARACTER SET utf8mb4) AS BINARY)'
      : 'CAST(' + column + ' AS BINARY)';
    return ['IF(' + column + " IS NULL,'N','V')",
      'IFNULL(OCTET_LENGTH(' + bytes + '),0)', 'IFNULL(HEX(' + bytes + "),'')"];
  });
  return "SET time_zone='+00:00'; SET NAMES utf8mb4; START TRANSACTION WITH CONSISTENT SNAPSHOT;\n"
    + 'SELECT COUNT(*) FROM \x60' + table + '\x60;\n'
    + 'SELECT ' + expressions.join(',') + ' FROM \x60' + table + '\x60;\n'
    + 'SELECT @@warning_count;\nSELECT COUNT(*) FROM \x60' + table + '\x60;\n'
    + "COMMIT; SELECT 'CB2_SNAPSHOT_END';\n";
}
function parseTableSnapshot(table, fields, output) {
  // No trim/filter: una columna vacia final o una linea perdida nunca se descartan.
  assert(output.endsWith('\n'), 'Salida sin terminador de linea');
  const lines = output.slice(0, -1).split('\n');
  assert.equal(lines.pop(), 'CB2_SNAPSHOT_END', 'Salida incompleta');
  const afterCount = lines.pop();
  assert.equal(lines.pop(), '0', 'Warnings al serializar datos');
  const count = lines.shift();
  assert.match(count ?? '', /^(0|[1-9][0-9]*)$/);
  assert.equal(afterCount, count, 'Conteos inconsistentes');
  assert.equal(BigInt(lines.length), BigInt(count), 'Filas perdidas/truncadas');
  const data = lines.map(line => {
    const cells = line.split('\t');
    assert.equal(cells.length, fields.length * 3, 'Limites de columna incorrectos');
    return fields.map((field, i) => {
      const [tag, length, hex] = cells.slice(i * 3, i * 3 + 3);
      assert(tag === 'N' || tag === 'V', 'Indicador NULL invalido');
      assert.match(length, /^(0|[1-9][0-9]*)$/);
      assert.match(hex, /^(?:[0-9A-F]{2})*$/);
      assert.equal(BigInt(hex.length / 2), BigInt(length), 'Bytes perdidos/truncados');
      if (tag === 'N') { assert.equal(length, '0'); assert.equal(hex, ''); }
      return [tag, length, hex];
    });
  }).map(row => JSON.stringify(row)).sort(); // Orden binario JS, sin collation SQL; duplicados conservados.
  return { table, fields, count, data };
}
function compareSnapshots(before, after) {
  assert.deepEqual(after, before, 'Cambios persistentes en datos/conteos/tipos/columnas');
}
function dataSnapshot(c, label, read = query) {
  const columns = rows(read(c, label + '-columnas', 'SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,'
    + "COALESCE(CHARACTER_SET_NAME,'-'),COALESCE(COLLATION_NAME,'-'),IS_NULLABLE,EXTRA,ORDINAL_POSITION "
    + 'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;'));
  const tables = new Map();
  for (const row of columns) {
    assert.equal(row.length, 9);
    const [table, name, type, columnType, charset, collation, nullable, extra, ordinal] = row;
    assert(snapshotTables.includes(table), 'Tabla inesperada');
    if (!tables.has(table)) tables.set(table, []);
    assert.equal(ordinal, String(tables.get(table).length + 1), 'Columna omitida/reordenada');
    tables.get(table).push({ name, type, columnType, charset, collation, nullable, extra, ordinal });
  }
  assert.deepEqual([...tables.keys()].sort(), snapshotTables, 'Se requieren las 13 tablas exactas');
  return snapshotTables.map(table => {
    const fields = tables.get(table);
    return parseTableSnapshot(table, fields, read(c, label + '-' + table, snapshotSelect(table, fields)));
  });
}
function rejectTransaction(c, label, statement, code, detail) {
  assert(detail, 'Cada rechazo DML exige una restriccion concreta');
  record(label, () => {
    const before = dataSnapshot(c, `${label}-antes`);
    try {
      // Proceso/conexion nuevos; query espera su terminacion. Sin COMMIT.
      // InnoDB revierte al cerrar la conexion, no dependemos de un ROLLBACK posterior.
      query(c, label, `START TRANSACTION; ${statement};`, code, detail);
    } finally {
      compareSnapshots(before, dataSnapshot(c, `${label}-despues`));
      postFinal(query(c, `${label}-postcheck`, sql.postcheck));
    }
  });
}
function structureSnapshot(c, label) {
  return snapshotTables.map(table => query(c, label + '-' + table, `SHOW CREATE TABLE ${table};`));
}
function suite() {
  if (nativeLab?.postcheckFlow) record('postcheck-phpmyadmin-solo-lectura', () => laboratory('postcheck-lectura', c => {
    nativeLab.postcheckFlow(c, 'sin-tablas', buildPostcheck('cb2_lab'), ['DIVERGENTE','CLEAN',null,null]);
    assert.equal(query(c, 'postcheck-sin-tablas-conservado', `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='cb2_lab' AND TABLE_NAME IN (${list});`).trim(), '0');
    migrate(c);
    query(c, 'postcheck-semilla', fixture('seed'));
    query(c, 'postcheck-asociacion', fixture('associate'));
    let before = dataSnapshot(c, 'pc-final-antes');
    let ddlBefore = structureSnapshot(c, 'pc-estructura-antes');
    nativeLab.postcheckFlow(c, 'final', buildPostcheck('cb2_lab'), ['CB2_POSTCHECK_FINAL','FINAL','15','0']);
    compareSnapshots(before, dataSnapshot(c, 'pc-final-despues'));
    const output = rows(query(c, 'pc-cli-independiente', buildPostcheck('cb2_lab')));
    assert.equal(output.length, 1); assert.equal(output[0][0], 'CB2_POSTCHECK_FINAL');
    compareSnapshots(before, dataSnapshot(c, 'pc-cli-despues'));
    assert.deepEqual(structureSnapshot(c, 'pc-estructura-despues'), ddlBefore, 'Postcheck modifico DDL');
    query(c, 'pc-defecto-sintetico', "UPDATE flota_cb2_filas SET operacion_total=3 WHERE operacion_tipo='REANUDAR';");
    before = dataSnapshot(c, 'pc-datos-mal-antes');
    nativeLab.postcheckFlow(c, 'datos-divergentes', buildPostcheck('cb2_lab'), ['DIVERGENTE','FINAL','15','1']);
    compareSnapshots(before, dataSnapshot(c, 'pc-datos-mal-despues'));
    assert.deepEqual(structureSnapshot(c, 'pc-datos-estructura-despues'), ddlBefore);
    query(c, 'pc-metadata-sintetica', 'ALTER TABLE flota_cb2_facturas MODIFY serie VARCHAR(127) NOT NULL;');
    before = dataSnapshot(c, 'pc-metadata-mal-antes');
    ddlBefore = structureSnapshot(c, 'pc-meta-estructura-antes');
    nativeLab.postcheckFlow(c, 'metadata-divergente', buildPostcheck('cb2_lab'), ['DIVERGENTE','DIVERGENTE',null,null]);
    compareSnapshots(before, dataSnapshot(c, 'pc-metadata-mal-despues'));
    assert.deepEqual(structureSnapshot(c, 'pc-meta-estructura-despues'), ddlBefore);
  }));
  if (nativeLab?.importFlow) record('phpmyadmin-mysqli-sin-drenaje', () => laboratory('mysqli', c => {
    nativeLab.importFlow(c, buildImport('cb2_lab'));
    preState(query(c, 'mysqli-preflight-final', sql.preflight), 'FINAL');
    postFinal(query(c, 'mysqli-postcheck-final', sql.postcheck));
  }));
  record('import-phpmyadmin-sesion-nueva', () => laboratory('import-sesion', c => {
    const baseline = "SET SESSION sql_mode='NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'; SET SESSION innodb_strict_mode=OFF; SET @cb2_schema=NULL; USE information_schema;\n";
    const output = query(c, 'import-autocontenido', baseline + buildImport('cb2_lab'));
    const result = rows(output);
    assert.equal(result.length, 1, 'Solo una fila de un SELECT superior, sin salidas desde el bloque');
    assert.deepEqual(result[0].slice(0, 4), ['CB2_IMPORT_FINAL', 'FINAL', '15', '0']);
    const data = JSON.parse(result[0][4]);
    assert.equal(Object.keys(data).length, 15);
    assert(Object.values(data).every(n => n === 0));
    assert.deepEqual(result[0].slice(5), ['cb2_lab', '1', 'NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', '0']);
    assert.deepEqual(rows(query(c, 'import-conteos', `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='cb2_lab' AND TABLE_NAME IN (${list});`)), [['4']]);
  }));
  record('import-phpmyadmin-fallo-cerrado', () => laboratory('import-fallo', c => {
    query(c, 'base-incompatible-import', 'ALTER TABLE auditoria MODIFY usuario VARCHAR(99) NULL;');
    query(c, 'import-base-incompatible', buildImport('cb2_lab'), 1644, 'CB2: se requiere CLEAN y base compatible');
    const nested = compoundBody(buildImport('cb2_lab')).replace(/^USE `cb2_lab`;\n/, '').replace(/\nSELECT CASE[\s\S]*$/, '');
    const handled = query(c, 'import-handler-restaura', `DELIMITER $
BEGIN NOT ATOMIC
 DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 @cb2_caught = MYSQL_ERRNO;
 SET SESSION sql_mode='NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION';
 SET SESSION innodb_strict_mode=OFF;
 SET @cb2_caught=NULL;
 ${nested}
 SELECT 'ERROR_RESTAURADO', @cb2_caught, @@SESSION.sql_mode, @@SESSION.innodb_strict_mode;
END$
DELIMITER ;`);
    assert.deepEqual(rows(handled).find(r => r[0] === 'ERROR_RESTAURADO')?.slice(1), ['1644', 'NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', '0']);
    assert.equal(query(c, 'import-fallo-sin-tablas', `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='cb2_lab' AND TABLE_NAME IN (${list});`).trim(), '0');
  }));
  record('positivo-y-restricciones', () => laboratory('positivo', c => {
    migrate(c);
    const expected = ['4', '86', '34', '18', '26'];
    const metadata = query(c, 'conteos-independientes', `
SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${list});
SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${list});
SELECT COUNT(DISTINCT TABLE_NAME,INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${list});
SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN (${list});
SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN (${list});`);
    assert.deepEqual(rows(metadata).flat(), expected);
    for (const table of names) query(c, `ddl-${table}`, `SHOW CREATE TABLE ${table};`);
    assert.equal(query(c, 'json-table', `SELECT SUM(j.n) FROM JSON_TABLE('[1,2]', '$[*]' COLUMNS(n INT PATH '$')) AS j;`).trim(), '3');
    assert.equal(query(c, 'semilla-pendiente', fixture('seed')).trim(), 'PENDIENTE_FACTURA');
    postFinal(query(c, 'postcheck-pendiente', sql.postcheck));
    assert.deepEqual(rows(query(c, 'asociacion-eventos', fixture('associate'))), [['FACTURADO', '1'], ['2'], ['1'], ['3', '1']]);
    postFinal(query(c, 'postcheck-eventos', sql.postcheck));
    // INSERT sobre un nuevo consumo: UPDATE de una clave ya referenciada activa
    // primero RESTRICT del diario (1451), ocultando la FK de ambito que queremos probar.
    const consumptionColumns = 'empresa_id,proveedor_id,importacion_origen_id,vehiculo_id,factura_id,fecha_consumo,numero_vale,vale_norm,placa_original,placa_normalizada,version_clave,clave_candidata,version_huella,huella_operacion,payload_operacion,piloto_informado,producto,galones,precio,monto,kilometraje,kilometraje_texto,galones_calculados,moneda,creado_por,creado_en,factura_asociada_por,factura_asociada_en';
    const clonedConsumption = (empresa, proveedor) => 'INSERT INTO flota_cb2_consumos (' + consumptionColumns + ') SELECT '
      + consumptionColumns.split(',').map(n => n === 'empresa_id' ? String(empresa) : n === 'proveedor_id' ? String(proveedor)
        : ['factura_id', 'factura_asociada_por', 'factura_asociada_en'].includes(n) ? 'NULL' : n).join(',')
      + ' FROM flota_cb2_consumos WHERE id=1';
    rejectTransaction(c, 'empresa-cruzada', clonedConsumption(2, 3), 1452, 'fk_cb2c_importacion');
    rejectTransaction(c, 'proveedor-cruzado', clonedConsumption(1, 2), 1452, 'fk_cb2c_importacion');
    rejectTransaction(c, 'factura-otro-proveedor', 'UPDATE flota_cb2_consumos SET factura_id=2 WHERE id=1', 1452, 'fk_cb2c_factura');
    rejectTransaction(c, 'factura-otra-empresa', 'UPDATE flota_cb2_consumos SET factura_id=3 WHERE id=1', 1452, 'fk_cb2c_factura');
    rejectTransaction(c, 'vehiculo-inexistente', 'UPDATE flota_cb2_consumos SET vehiculo_id=999 WHERE id=1', 1452, 'fk_cb2c_vehiculo');
    rejectTransaction(c, 'factura-sin-actor', 'UPDATE flota_cb2_consumos SET factura_asociada_por=NULL WHERE id=1', 4025, 'ck_cb2c_asociacion');
    rejectTransaction(c, 'factura-null-con-metadata', 'UPDATE flota_cb2_consumos SET factura_id=NULL WHERE id=1', 4025, 'ck_cb2c_asociacion');
    rejectTransaction(c, 'json-invalido', "UPDATE flota_cb2_filas SET decision='no-json' WHERE id=1", 4025, 'ck_filas_decision');
    rejectTransaction(c, 'marca-origen-null', 'UPDATE flota_cb2_filas SET marca_origen=NULL WHERE id=1', 4025, 'ck_cb2l_marca_origen');
    rejectTransaction(c, 'ordinal-duplicado', 'UPDATE flota_cb2_filas SET operacion_ordinal=1 WHERE id=3', 1062, 'uq_cb2l_operacion');
    const rowColumns = `empresa_id,proveedor_id,importacion_id,revision,origen_fila_id,tipo,marca_origen,consumo_id,
factura_anterior_id,factura_nueva_id,operacion_tipo,operacion_clave,solicitud_sha256,operacion_ordinal,operacion_total,
hoja_indice,hoja_nombre,fila_excel,resultado,datos_origen,decision,motivo,usuario_id,creado_en`;
    const copied = rowColumns.split(',').map(s => s.trim()).map(n => n === 'operacion_clave' ? "'LAB_CONFIRMAR_0002'" : n).join(',');
    rejectTransaction(c, 'original-duplicado', `INSERT INTO flota_cb2_filas (${rowColumns}) SELECT ${copied} FROM flota_cb2_filas WHERE id=1`, 1062, 'uq_cb2l_original_posicion');
    query(c, 'migracion-repetida', sql.migrate, 1644, 'CB2: se requiere CLEAN y base compatible');
    postFinal(query(c, 'postcheck-tras-rechazos', sql.postcheck));
    // Simular grupo incompleto sin deshabilitar CHECK/FK: metadata permanece FINAL, datos NO.
    query(c, 'inyectar-grupo-incompleto', "UPDATE flota_cb2_filas SET operacion_total=3 WHERE operacion_tipo='REANUDAR';");
    preState(query(c, 'metadata-grupo-incompleto', sql.preflight), 'FINAL');
    const incomplete = query(c, 'postcheck-grupo-incompleto', sql.postcheck);
    state(incomplete, 'DATO', 'operacion_con_payload_o_actor_discordante', '1');
    state(incomplete, 'RESULTADO', 'estado_postcheck', 'DIVERGENTE');
  }));
  record('esquema-parcial', () => laboratory('parcial', c => {
    preState(query(c, 'parcial-inicial', sql.preflight), 'CLEAN');
    const first = sql.migrate.match(/CREATE TABLE flota_cb2_importaciones \([\s\S]*?COLLATE=utf8mb4_bin;/)?.[0];
    assert(first); query(c, 'inyectar-parcial', first);
    preState(query(c, 'parcial-divergente', sql.preflight), 'DIVERGENTE');
    query(c, 'parcial-guard', sql.migrate, 1644, 'CB2: se requiere CLEAN y base compatible');
    const result = query(c, 'parcial-postcheck', sql.postcheck);
    state(result, 'RESULTADO', 'estado_postcheck', 'DIVERGENTE');
    assert(!rows(result).some(r => r[0] === 'DATO'));
    assert.equal(query(c, 'parcial-no-continuado', `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${list});`).trim(), '1');
  }));
  const alterations = [
    ['longitud', 'ALTER TABLE flota_cb2_facturas MODIFY serie VARCHAR(127) NOT NULL;'],
    ['check', 'ALTER TABLE flota_cb2_facturas DROP CONSTRAINT ck_cb2f_total, ADD CONSTRAINT ck_cb2f_total CHECK (total_documental IS NULL OR total_documental > 0);'],
    ['check-asociacion', 'ALTER TABLE flota_cb2_consumos DROP CONSTRAINT ck_cb2c_asociacion, ADD CONSTRAINT ck_cb2c_asociacion CHECK (factura_id IS NULL OR factura_asociada_por IS NULL OR factura_asociada_en IS NULL);'],
    ['indice', 'ALTER TABLE flota_cb2_filas DROP INDEX idx_cb2l_hoja_revision, ADD UNIQUE KEY idx_cb2l_hoja_revision (empresa_id,proveedor_id,importacion_id,revision,hoja_indice,fila_excel,id);'],
  ];
  for (const [label, alteration] of alterations) record(`esquema-alterado-${label}`, () => laboratory(label, c => {
    migrate(c); query(c, `alterar-${label}`, alteration);
    preState(query(c, `preflight-${label}`, sql.preflight), 'DIVERGENTE');
    const result = query(c, `postcheck-${label}`, sql.postcheck);
    state(result, 'RESULTADO', 'estado_postcheck', 'DIVERGENTE');
    assert(!rows(result).some(r => r[0] === 'DATO'));
    query(c, `guard-${label}`, sql.migrate, 1644, 'CB2: se requiere CLEAN y base compatible');
  }));
  // Solo fixtures aislados: demostrar que equivalencia estructural no permite otro nombre.
  for (const [label, replacement] of [
    ['nombre-anterior', 'UNIQUE KEY uq_flota_vehiculos_empresa_id (empresa_id,id)'],
    ['nombre-arbitrario', 'UNIQUE KEY otro_indice_equivalente (empresa_id,id)'],
    ['orden-invertido', 'UNIQUE KEY uq_multas_vehiculo_empresa_id (id,empresa_id)'],
    ['no-unico', 'KEY uq_multas_vehiculo_empresa_id (empresa_id,id)'],
  ]) record(`indice-base-vehiculos-${label}`, () => laboratory(`vehiculos-${label}`, c => {
    query(c, 'alterar-indice-base', `ALTER TABLE flota_vehiculos DROP INDEX uq_multas_vehiculo_empresa_id, ADD ${replacement};`);
    const result = query(c, 'preflight-indice-base', sql.preflight);
    state(result, 'BASE', 'indice:flota_vehiculos.uq_multas_vehiculo_empresa_id', '0');
    preState(result, 'DIVERGENTE');
    query(c, 'guard-indice-base', sql.migrate, 1644, 'CB2: se requiere CLEAN y base compatible');
  }));
  record('base-incompatible', () => laboratory('base-incompatible', c => {
    query(c, 'alterar-base-sintetica', 'ALTER TABLE auditoria MODIFY usuario VARCHAR(99) NULL;');
    preState(query(c, 'preflight-base-incompatible', sql.preflight), 'DIVERGENTE');
    query(c, 'base-incompatible-guard', sql.migrate, 1644, 'CB2: se requiere CLEAN y base compatible');
    assert.equal(query(c, 'base-incompatible-sin-cb2', `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${list});`).trim(), '0');
  }));
}
function setup() {
  ciGuard();
  const temp = path.join(process.env.RUNNER_TEMP, 'cb2-sql-lab');
  evidence = path.join(temp, 'evidence');
  dockerConfig = path.join(temp, 'docker-config');
  fs.mkdirSync(evidence, { recursive: true });
  fs.mkdirSync(dockerConfig, { recursive: true });
  registryPath = path.join(temp, 'containers.json');
  const run = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  registry = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')) : { run, containers: [] };
  assert.equal(registry.run, run);
  assert(Array.isArray(registry.containers));
}
function snapshotSelfTest() {
  assert(snapshotSelect('flota_cb2_importaciones', [{ name: 'version_contrato', type: 'smallint' }]).includes('CAST(CAST(`version_contrato` AS CHAR CHARACTER SET utf8mb4) AS BINARY)'));

  // Datos reales del fixture base, interpretados solo para estas pruebas en memoria.
  const insert = fixture('base').match(/INSERT INTO compras_proveedores VALUES ([^;]+);/);
  assert(insert);
  const providers = [...insert[1].matchAll(/\((\d+),(\d+),'([A-Z_]+)',(\d+)\)/g)]
    .map(m => [m[1], m[2], m[3], m[4]]);
  assert.equal(providers.length, 3);
  const fields = ['id', 'empresa_id', 'nombre_comercial', 'activo'].map((name, i) => ({
    name, type: i === 2 ? 'varchar' : 'int', columnType: i === 2 ? 'varchar(200)' : 'int(11)',
    charset: i === 2 ? 'utf8mb4' : '-', collation: i === 2 ? 'utf8mb4_bin' : '-',
    nullable: 'NO', extra: '', ordinal: String(i + 1),
  }));
  // Modelo independiente del wire: tres campos ASCII por celda, no SQL ni Docker.
  const wire = data => [String(data.length), ...data.map(row => row.flatMap(value => {
    if (value === null) return ['N', '0', ''];
    const bytes = Buffer.from(value, 'utf8');
    return ['V', String(bytes.length), bytes.toString('hex').toUpperCase()];
  }).join('\t')), '0', String(data.length), 'CB2_SNAPSHOT_END', ''].join('\n');
  const parsed = (data, schema = fields) => parseTableSnapshot('compras_proveedores', schema, wire(data));
  const original = parsed(providers);
  compareSnapshots(original, parsed([...providers].reverse()));
  for (const change of [
    data => { data[0][2] += '_CAMBIO'; }, // mismo conteo, texto distinto
    data => { data[0][1] = '2'; }, // cambio de empresa del fixture
    data => { data[0][3] = '0'; }, // flag persistente
    data => { data[0][2] = ''; }, data => { data[0][2] = null; },
    data => { data.pop(); }, data => { data.push([...data[0]]); },
    data => { [data[0][0], data[0][3]] = ['11', '']; }, // limites de columna
  ]) {
    const changed = structuredClone(providers); change(changed);
    assert.throws(() => compareSnapshots(original, parsed(changed)));
  }
  const changedType = structuredClone(fields); changedType[0].type = 'varchar';
  assert.throws(() => compareSnapshots(original, parsed(providers, changedType)));
  const textField = [fields[2]];
  const edgeValues = [null, '', 'NULL', 'N', 'V', '|', ':', '\t', '\n', '\r', '\0',
    'a|b', 'a:b', ' a ', '\u00e9', 'e\u0301', '\u{1F6E2}', 'x'.repeat(100000)];
  const edgeSnapshots = edgeValues.map(v => parseTableSnapshot('auditoria', textField, wire([[v]])));
  assert.equal(new Set(edgeSnapshots.map(v => JSON.stringify(v))).size, edgeValues.length);
  const decimals = ['1.000001', '1.000002', '-1.000001', '999999999999.999999'];
  const decimalField = [{ ...fields[0], type: 'decimal', columnType: 'decimal(18,6)' }];
  assert.equal(new Set(decimals.map(v => JSON.stringify(parseTableSnapshot('flota_cb2_consumos', decimalField, wire([[v]]))))).size, decimals.length);
  const temporalField = [{ ...fields[0], type: 'datetime', columnType: 'datetime(6)' }];
  const dates = ['2026-01-01 00:00:00.000001', '2026-01-01 00:00:00.000002'];
  assert.throws(() => compareSnapshots(
    parseTableSnapshot('flota_cb2_consumos', temporalField, wire([[dates[0]]])),
    parseTableSnapshot('flota_cb2_consumos', temporalField, wire([[dates[1]]]))));
  const pair = [fields[2], { ...fields[2], name: 'segundo', ordinal: '2' }];
  assert.throws(() => compareSnapshots(
    parseTableSnapshot('auditoria', pair, wire([['a|b', 'c']])),
    parseTableSnapshot('auditoria', pair, wire([['a', 'b|c']]))));
  const transport = wire(providers);
  for (const broken of [
    transport.slice(0, -1), transport.replace('CB2_SNAPSHOT_END', ''),
    transport.replace(/^[^\n]*\n/, '4\n'), // conteo/filas no coincide
    transport.replace('V\t1\t31', 'V\t2\t31'), // HEX truncado
    transport.replace('V\t1\t31', 'V\t1\t3Z'), // HEX corrupto
    transport.replace('V\t1\t31', 'N\t1\t31'), // NULL con payload
    transport.replace('V\t1\t31', 'V\t1'), // columna perdida
    transport.replace('\n0\n3\nCB2_SNAPSHOT_END', '\n1\n3\nCB2_SNAPSHOT_END'), // warning
  ]) assert.throws(() => parseTableSnapshot('compras_proveedores', fields, broken));
  assert.equal(parsed([]).count, '0');
  const statement = snapshotSelect('compras_proveedores', fields);
  assert(!/CONCAT|GROUP_CONCAT|LIMIT|SHA2|MD5/.test(statement));
  assert(statement.includes('OCTET_LENGTH(') && statement.includes('AS CHAR CHARACTER SET utf8mb4'));
  assert(statement.includes('WITH CONSISTENT SNAPSHOT') && statement.includes('@@warning_count'));
  assert.throws(() => snapshotSelect('auditoria', [{ name: 'valor', type: 'double' }]));
  // Integracion del inventario exacto de 13 tablas con query sustituida por un lector en memoria.
  const schemas = Object.fromEntries(snapshotTables.map(table => [table,
    table === 'compras_proveedores' ? fields : [fields[0]]]));
  const reader = (c, label, input) => {
    if (input.startsWith('SELECT TABLE_NAME')) return snapshotTables.flatMap(table => schemas[table].map(f =>
      [table, f.name, f.type, f.columnType, f.charset, f.collation, f.nullable, f.extra, f.ordinal].join('\t'))).join('\n') + '\n';
    const table = snapshotTables.find(t => input.includes('FROM \x60' + t + '\x60;'));
    assert(table);
    return wire(table === 'compras_proveedores' ? providers : []);
  };
  const all = dataSnapshot(null, 'modelo', reader);
  assert.equal(all.length, 13);
  compareSnapshots(all, dataSnapshot(null, 'modelo', reader));
  for (let i = 0; i < all.length; i++) {
    const altered = structuredClone(all);
    altered[i] = parseTableSnapshot(all[i].table, schemas[all[i].table], wire(
      all[i].table === 'compras_proveedores' ? providers.slice(1) : [['1']]));
    assert.throws(() => compareSnapshots(all, altered));
  }
  assert.throws(() => dataSnapshot(null, 'incompleto', (c, label, input) =>
    reader(c, label, input).replace(/^auditoria\t.*\n/m, '')));
  console.log('PASS: snapshots tipados, fixtures mutados, 13 tablas, conteos, limites y truncamientos (solo memoria).');
}
function selfTest() {
  snapshotSelfTest();
  preState('RESUMEN\tbase_compatible\t1\nRESUMEN\tCLEAN\t0', 'CLEAN');
  assert.throws(() => preState('RESUMEN\tCLEAN\t0', 'CLEAN'));
  assert.throws(() => preState('RESUMEN\tbase_compatible\t1\nRESUMEN\tFINAL\t0', 'FINAL'));
  assert.throws(() => state('RESULTADO\testado_postcheck\tFINAL\nRESULTADO\testado_postcheck\tFINAL', 'RESULTADO', 'estado_postcheck', 'FINAL'));
  const good = 'METADATA\testado_esquema_cb2\tFINAL\nRESULTADO\testado_postcheck\tFINAL\n'
    + Array.from({ length: 15 }, (_, i) => `DATO\tcheck${i}\t0`).join('\n');
  postFinal(good);
  assert.throws(() => postFinal(good.replace('check0\t0', 'check0\t1')));
  assert.throws(() => postFinal(good.replace('check14', 'check13')));
  assert.throws(() => postFinal(good.split('\n').slice(0, -1).join('\n')));
  const fkError = { status: 1, stderr: 'ERROR 1452 (23000) at line 1: constraint fails, CONSTRAINT `fk_cb2c_factura` FOREIGN KEY (`factura_id`)' };
  rejected(fkError, 1452, 'fk_cb2c_factura');
  rejected({ status: 1, stderr: "ERROR 1062 (23000) at line 1: Duplicate entry '1' for key 'uq_cb2l_operacion'" }, 1062, 'uq_cb2l_operacion');
  rejected({ status: 1, stderr: 'ERROR 4025 (23000) at line 1: CONSTRAINT `ck_cb2c_asociacion` failed for `cb2_lab`.`flota_cb2_consumos`' }, 4025, 'ck_cb2c_asociacion');
  for (const bad of [
    { ...fkError, status: 0 }, { ...fkError, status: null, signal: 'SIGTERM' },
    { ...fkError, error: new Error('timeout') },
    { status: 1, stderr: 'ERROR 1064 (42000) at line 1: syntax error' },
    { status: 1, stderr: 'ERROR 2002 (HY000): Cannot connect' },
    { ...fkError, stderr: fkError.stderr.replace('23000', 'HY000') },
    { ...fkError, stderr: fkError.stderr.replace('`fk_cb2c_factura`', '`fk_cb2c_factura_extra`') },
    { ...fkError, stderr: `${fkError.stderr}\nERROR 2002 (HY000): Cannot connect` },
  ]) assert.throws(() => rejected(bad, 1452, 'fk_cb2c_factura'));
  const contracts = Object.values(sql).flatMap(s => [...s.matchAll(/-- BEGIN CB2_METADATA_CANONICO\r?\n([\s\S]*?)\r?\n-- END CB2_METADATA_CANONICO/g)].map(m => m[1].replace(/\r\n/g, '\n')));
  assert.equal(contracts.length, 4);
  assert.equal(new Set(contracts).size, 1);
  const canonical = contracts[0];
  const explicit = value => `CONVERT(${value} USING utf8mb4) COLLATE utf8mb4_bin`;
  for (const name of ['CONSTRAINT_SCHEMA', 'TABLE_NAME', 'CONSTRAINT_NAME']) {
    assert(canonical.includes(`${explicit('r.' + name)} = ${explicit('k.' + name)}`));
  }
  // Ningun cruce textual puede volver a depender de collations implicitas.
  const rawPairs = [...canonical.matchAll(/\b([rck]\.[A-Za-z_]+) (=|<>) ([ekr]\.[A-Za-z_]+)\b/g)];
  assert.equal(rawPairs.length, 5); // cuatro dimensiones numericas y NON_UNIQUE
  for (const [, left] of rawPairs) assert([
    'c.CHARACTER_MAXIMUM_LENGTH', 'c.NUMERIC_PRECISION', 'c.NUMERIC_SCALE',
    'c.DATETIME_PRECISION', 'r.no_unico',
  ].includes(left));
  assert.equal((sql.migrate.match(/^CREATE TABLE /gm) ?? []).length, 4);
  for (const name of ['base', 'seed', 'associate']) assert(fixture(name).includes('SOLO LABORATORIO AISLADO'));
  console.log('PASS: aserciones positivas/negativas del arnes y contratos estaticos. No se ejecuto Docker ni SQL.');
}

// Backend portable explicito; comparte suite y aserciones, no suplanta Docker/Actions.
export function runNativeLaboratory(adapter) {
  assert.equal(process.platform, 'win32');
  nativeLab = adapter;
  evidence = adapter.evidence;
  let status = 'FAIL';
  try { suite(); status = 'PASS'; }
  finally { save('summary.json', { status, tests, backend: 'windows-portable-named-pipe', note: 'Solo fixtures sinteticos; casos posteriores a fallo NO EJECUTADOS.' }); }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
const mode = process.argv[2];
if (mode === '--self-test') selfTest();
else if (mode === '--cleanup') {
  setup();
  const failures = [];
  for (const container of registry.containers) {
    try { cleanupOne(container); } catch (error) { failures.push({ container, error: error.message }); }
  }
  save('cleanup.json', failures.length ? { status: 'FAIL', failures } : { status: 'PASS' });
  assert.equal(failures.length, 0, 'Limpieza incompleta; revisar evidencia');
} else if (mode === '--run') {
  setup();
  save('source.json', {
    sha: process.env.CB2_AUDITED_SHA, workflowSha: process.env.GITHUB_SHA, run: registry.run, date: new Date().toISOString(),
    files: Object.fromEntries([...Object.values(files), ...['base', 'seed', 'associate'].map(n => path.join(dir, `${n}.sql`)), fileURLToPath(import.meta.url)]
      .map(p => [path.relative(repo, p), createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),
  });
  let status = 'FAIL';
  try {
    assert.equal(docker(['info', '--format', '{{.OSType}}']).stdout.trim(), 'linux');
    const pull = docker(['pull', 'mariadb:11.8']);
    save('image-pull.log', pull.stdout + pull.stderr);
    image = docker(['image', 'inspect', 'mariadb:11.8', '--format', '{{index .RepoDigests 0}}']).stdout.trim();
    assert.match(image, /^mariadb@sha256:[0-9a-f]{64}$/);
    save('image.json', { tag: 'mariadb:11.8', digest: image });
    suite(); status = 'PASS';
  } catch (error) {
    save('failure.txt', error.stack ?? error.message);
    console.error(error.message); process.exitCode = 1;
  } finally {
    save('summary.json', { status, tests, note: 'Casos posteriores a un fallo quedan NO EJECUTADOS, nunca PASS. Sin pruebas de produccion.' });
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Laboratorio CB2 SQL: ${status}\n\nCommit SQL/arnes: ${process.env.CB2_AUDITED_SHA}\nWorkflow: ${process.env.GITHUB_SHA}\n\nResultados y logs en artefacto cb2-sql-lab-${registry.run}.\n`);
  }
} else throw new Error('Usar --self-test (estatico) o --run/--cleanup exclusivamente en Actions aprobado');

}
