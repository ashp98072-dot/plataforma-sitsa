import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { repo, statements, schemaTables, foreignKeys, sha, parts } from './audit.mjs';

const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
export function buildPlan() {
  const schema = read('sql/schema.sql'), tables = schemaTables(schema);
  const sources = ['sql/schema.sql', 'sql/migrate-2026-09-rutas-tarifario-historial.sql'];
  const map = new Map(tables.map(t => [t.name, { ...t, file: sources[0] }]));
  for (const file of sources.slice(1)) for (const t of schemaTables(read(file))) if (!map.has(t.name)) map.set(t.name, { ...t, file });
  const flotaFile = 'src/lib/flota/schema.ts'; sources.push(flotaFile);
  const flotaDdl = /CREATE TABLE IF NOT EXISTS flota_vehiculo_acceso \([\s\S]*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/.exec(read(flotaFile));
  assert.ok(flotaDdl, 'S04_FLOTA_DDL_DRIFT');
  for (const t of schemaTables(flotaDdl[0])) map.set(t.name, { ...t, file: flotaFile, line: read(flotaFile).slice(0, flotaDdl.index).split('\n').length });
  const roots = ['empresas', 'usuarios', 'usuario_empresa', 'usuario_modulo', 'auditoria', 'clientes', 'empleados',
    'tms_clientes', 'tms_lugares', 'tms_unidades', 'tms_personal', 'flota_vehiculos', 'flota_vehiculo_acceso',
    'tms_cliente_ubicaciones', 'tms_cliente_contactos', 'tms_cliente_rutas', 'tms_cliente_ruta_personal', 'tms_cliente_ruta_paradas',
    'tms_cliente_ruta_tarifas', 'tms_ruta_tarifas', 'tms_cliente_usuarios', 'tms_solicitudes_cliente', 'tms_solicitud_paradas'];
  const selected = new Set(), ordered = [], visiting = new Set();
  const deferred = statements(schema).filter(s => /^ALTER TABLE /i.test(s.sql));
  function visit(name) {
    if (selected.has(name)) return;
    assert.ok(!visiting.has(name), 'S04_DEPENDENCY_CYCLE'); visiting.add(name);
    const t = map.get(name); assert.ok(t, 'S04_MISSING_TABLE');
    const later = deferred.filter(s => new RegExp(`^ALTER TABLE ${name}\\b`, 'i').test(s.sql));
    for (const fk of [...t.foreignKeys, ...later.flatMap(s => foreignKeys(s.sql))]) if (fk.target !== name) visit(fk.target);
    visiting.delete(name); selected.add(name); ordered.push(t);
  }
  roots.forEach(visit);
  const alters = deferred.filter(s => selected.has(/^ALTER TABLE\s+(\w+)/i.exec(s.sql)[1]));
  const personalFile = 'sql/migrate-2026-08-fase0-tms-personal-empleado.sql'; sources.push(personalFile);
  // Reuse only the two DDL statements; NEVER execute the historical backfill.
  alters.push(...statements(read(personalFile)).filter(s => /^ALTER TABLE /i.test(s.sql)).map(s => ({ ...s, sql: s.sql.replace('ADD COLUMN IF NOT EXISTS', 'ADD COLUMN'), file: personalFile })));
  const clientFile = 'src/lib/clientes/schema.ts'; sources.push(clientFile);
  for (const name of ['rtu', 'condicion_credito']) {
    const match = new RegExp(`\\["${name}", "([^"]+)"\\]`).exec(read(clientFile)); assert.ok(match, 'S04_CLIENT_COLUMN_DRIFT');
    alters.push({ sql: `ALTER TABLE clientes ADD COLUMN ${match[1]}`, file: clientFile, line: read(clientFile).slice(0, match.index).split('\n').length });
  }
  const identity = statements(read('infra/pricesmart-sandbox/provision-identity.sql.in')).find(s => /^CREATE TABLE sandbox_pricesmart\.novalvion_environment/i.test(s.sql));
  sources.push('infra/pricesmart-sandbox/provision-identity.sql.in', 'infra/pricesmart-sandbox/s04/fixtures.json');
  assert.ok(identity, 'S04_S03_MARKER_MISSING');
  const ddl = [identity.sql, ...ordered.map(t => t.sql.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE')), ...alters.map(s => s.sql)];
  for (const a of alters) {
    const added = /^ALTER TABLE (\w+)\s+ADD COLUMN ([\s\S]+)$/i.exec(a.sql);
    if (added) map.get(added[1]).columns.push({ name: /^(\w+)/.exec(added[2])[1], definition: added[2] });
    const table = /^ALTER TABLE (\w+)/i.exec(a.sql)[1];
    for (const p of parts(a.sql.replace(/^ALTER TABLE \w+/i, ''))) if (/^ADD (INDEX|KEY|UNIQUE)\b/i.test(p)) map.get(table).indexes.push(p.replace(/^ADD /i, ''));
  }
  assert.ok(ddl.every(sql => /^(CREATE TABLE|ALTER TABLE) /i.test(sql) && !/FOREIGN_KEY_CHECKS|\bDROP\b|\bINSERT\b|IF NOT EXISTS/i.test(sql)), 'S04_UNSAFE_DDL');
  const fks = ordered.flatMap(t => t.foreignKeys.map(fk => ({ table: t.name, ...fk })));
  for (const a of alters) for (const fk of foreignKeys(a.sql)) fks.push({ table: /^ALTER TABLE (\w+)/i.exec(a.sql)[1], ...fk });
  const grants = ['novalvion_environment', ...ordered.map(t => t.name)].map(table => ({ table, operations: ['SELECT'], reason: table === 'novalvion_environment' ? 'S02 identity guard only' : 'S04 synthetic read-only navigation; installation writes use administrator' }));
  return { profile: 'S04_READ_ONLY_SYNTHETIC', database: 'sandbox_pricesmart', user: 'sandbox_pricesmart', id: 'pricesmart-qa',
    sources: sources.map(file => ({ file, sha256: sha(read(file)) })),
    tables: ordered.map(table => { const t = { ...table }; delete t.sql; return t; }), foreignKeys: fks, ddl, grants,
    scope: { login: true, tenantSelection: true, readOnlyCatalogsRoutesRequests: true, fullTmsUi: 'PENDING_S06', writes: false, pricesmart: false, decisions: 'D01-D16_PENDING_RATIFICATION' } };
}
export function grantSql(plan = buildPlan()) {
  return plan.grants.map(g => `GRANT ${g.operations.join(', ')} ON \`${plan.database}\`.\`${g.table}\` TO '${plan.user}'@'127.0.0.1'`);
}
export function indexSignatures(plan = buildPlan()) {
  return ['novalvion_environment:0:id', ...plan.tables.flatMap(t => t.indexes.map(index => {
    const columns = /\(([^)]+)\)/.exec(index)[1].split(',').map(c => c.trim().replaceAll('`', '').split(/\s+/)[0]);
    return `${t.name}:${/^(PRIMARY|UNIQUE)/i.test(index) ? 0 : 1}:${columns.join(',')}`;
  }))];
}
export function referentialChecks(plan = buildPlan()) {
  return plan.foreignKeys.map(fk => {
    const present = fk.columns.map(c => `c.\`${c}\` IS NOT NULL`).join(' AND ');
    const match = fk.columns.map((c, i) => `p.\`${fk.targetColumns[i]}\` = c.\`${c}\``).join(' AND ');
    return `SELECT COUNT(*) AS errors FROM \`${fk.table}\` c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM \`${fk.target}\` p WHERE ${match})`;
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = buildPlan();
  if (process.argv[2] === '--write') {
    const dir = path.join(repo, 'infra/pricesmart-sandbox/s04');
    const stop = "-- REVIEW ONLY: future S06, never execute directly.\nSIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='S04_REQUIRES_APPROVED_NEW_INSTANCE';\n";
    fs.writeFileSync(path.join(dir, 'schema.sql.in'), (stop + plan.ddl.join(';\n\n') + ';\n').replace(/[\t ]+$/gm, ''));
    fs.writeFileSync(path.join(dir, 'grants.sql.in'), stop + grantSql(plan).join(';\n') + ';\n');
    fs.writeFileSync(path.join(dir, 'postcheck.sql.in'), stop + referentialChecks(plan).join(';\n') + ';\n');
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'permissions.json'), JSON.stringify(plan.grants.map(g => ({ table: g.table, SELECT: true, INSERT: false, UPDATE: false, DELETE: false, DDL: false, GRANT_OPTION: false, reason: g.reason })), null, 2) + '\n');
  }
  console.log(JSON.stringify({ profile: plan.profile, tables: plan.tables.length + 1, foreignKeys: plan.foreignKeys.length, writesEnabled: false, applied: false }));
}
