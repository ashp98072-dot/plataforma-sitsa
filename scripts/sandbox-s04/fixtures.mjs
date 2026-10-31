import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { repo } from './audit.mjs';
import { buildPlan } from './plan.mjs';
import { hashPassword } from '../../src/lib/password.ts';

export const loadFixtures = () => JSON.parse(fs.readFileSync(path.join(repo, 'infra/pricesmart-sandbox/s04/fixtures.json'), 'utf8'));
// Explicit logical relationships already used by the application but not DB FKs.
export const logicalReferences = [
  ['flota_vehiculo_acceso', ['vehiculo_id'], 'flota_vehiculos', ['id']],
  ['flota_vehiculo_acceso', ['empresa_id'], 'empresas', ['id']],
  ['clientes', ['tms_cliente_id'], 'tms_clientes', ['id']],
  ['tms_cliente_rutas', ['ubicacion_carga_id'], 'tms_cliente_ubicaciones', ['id']],
  ['tms_cliente_rutas', ['contacto_cliente_id'], 'tms_cliente_contactos', ['id']],
  ['tms_cliente_ruta_paradas', ['cliente_ubicacion_id'], 'tms_cliente_ubicaciones', ['id']],
  ['tms_solicitud_paradas', ['cliente_ubicacion_id'], 'tms_cliente_ubicaciones', ['id']],
].map(([table, columns, target, targetColumns]) => ({ table, columns, target, targetColumns }));
export function validateFixtures(fixture, plan = buildPlan()) {
  assert.equal(fixture.kind, 'SYNTHETIC_ONLY_S04');
  const map = new Map(plan.tables.map(t => [t.name, t]));
  for (const [name, rows] of Object.entries(fixture.tables)) {
    const table = map.get(name); assert.ok(table && Array.isArray(rows), 'S04_FIXTURE_TABLE');
    for (const row of rows) {
      assert.ok(Object.keys(row).every(key => table.columns.some(c => c.name === key)), 'S04_FIXTURE_COLUMN');
      for (const c of table.columns) {
        const value = row[c.name];
        if (/NOT NULL|PRIMARY KEY/i.test(c.definition) && !/DEFAULT|AUTO_INCREMENT/i.test(c.definition)) assert.ok(value !== undefined && value !== null, 'S04_REQUIRED');
        const length = /(?:VAR)?CHAR\((\d+)\)/i.exec(c.definition);
        if (length && value != null) assert.ok(String(value).length <= Number(length[1]), 'S04_LENGTH');
      }
      if (row.email) assert.ok(row.email.endsWith('@example.invalid'), 'S04_EMAIL_NOT_SYNTHETIC');
      if (row.empresa_id != null) assert.ok([710001, 710002].includes(row.empresa_id), 'S04_TENANT');
    }
    const keys = table.indexes.filter(s => /^(PRIMARY|UNIQUE)/.test(s)).map(s => /\(([^)]+)\)/.exec(s)[1].split(',').map(c => c.trim().replaceAll('`', '').split(/\s+/)[0]));
    for (const c of table.columns) if (/PRIMARY KEY|\bUNIQUE\b/.test(c.definition)) keys.push([c.name]);
    for (const key of keys) {
      const values = rows.filter(r => key.every(c => r[c] != null)).map(r => JSON.stringify(key.map(c => r[c])));
      assert.equal(new Set(values).size, values.length, 'S04_DUPLICATE_KEY');
    }
  }
  for (const fk of [...plan.foreignKeys, ...logicalReferences]) for (const row of fixture.tables[fk.table] ?? []) {
    if (fk.columns.some(c => row[c] == null)) continue;
    const parent = (fixture.tables[fk.target] ?? []).find(p => fk.columns.every((c, i) => p[fk.targetColumns[i]] === row[c]));
    assert.ok(parent, 'S04_ORPHAN');
    if (row.empresa_id != null && parent.empresa_id != null) assert.equal(row.empresa_id, parent.empresa_id, 'S04_CROSS_TENANT');
  }
  assert.equal(fixture.tables.empresas.find(e => e.slug === 'kt-monaco')?.codigo, 'QA_MONACO_S04');
  assert.ok(fixture.tables.usuarios.every(u => u.username.startsWith('qa-s04-') && u.rol_global === 'Visualizador' && !u.acceso_todas_empresas));
  assert.ok(fixture.tables.tms_cliente_usuarios.every(u => u.activo === 0), 'S04_PORTAL_DISABLED');
  return true;
}
export function materialize(fixture, passwords) {
  const copy = structuredClone(fixture);
  for (const name of ['usuarios', 'tms_cliente_usuarios']) for (const row of copy.tables[name]) {
    const user = /^@HASH:([a-z0-9-]+)@$/.exec(row.password_hash)?.[1];
    assert.ok(user && /^sandbox:pricesmart-qa:[a-f0-9]{64}$/.test(passwords[user] ?? ''), 'S04_SYNTHETIC_PASSWORD_REQUIRED');
    const { salt, passwordHash } = hashPassword(passwords[user]); row.salt = salt; row.password_hash = passwordHash;
  }
  return copy;
}
export function fixtureStatements(fixture, plan = buildPlan()) {
  validateFixtures(fixture, plan);
  return plan.tables.flatMap(t => (fixture.tables[t.name] ?? []).map(row => {
    const columns = Object.keys(row);
    return { sql: `INSERT INTO \`${t.name}\` (${columns.map(c => `\`${c}\``).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, params: Object.values(row) };
  }));
}
