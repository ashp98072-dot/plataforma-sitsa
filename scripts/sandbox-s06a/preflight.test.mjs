import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assess, validate, load } from './preflight.mjs';

const template = JSON.parse(readFileSync(new URL('../../infra/pricesmart-sandbox/s06a/dossier.example.json', import.meta.url)));
const fresh = () => structuredClone(template);
function pass(value, method) {
  Object.assign(value, { status: 'PASS', method, evidenceSha256: createHash('sha256').update(`synthetic:${value.id}`).digest('hex'), reviewedAt: '2026-10-31T16:00:00Z', reviewer: 'qa-synthetic' });
}
function complete() {
  const value = fresh();
  value.controls.forEach((row, i) => pass(row, i === 0 ? 'DOCUMENT_REVIEW' : i === 14 ? 'REAL_DB' : 'REAL_LINUX'));
  value.gates.forEach(row => pass(row, 'EXPLICIT_AUTHORIZATION'));
  const methods = ['REAL_LINUX','REAL_LINUX','REAL_LINUX','REAL_LINUX','REAL_LINUX','REAL_LINUX','REAL_LINUX','REAL_LINUX','REAL_LINUX','REAL_BROWSER','REAL_DB','REAL_DB','REAL_DB','REAL_DB','REAL_DB','REAL_HTTP','REAL_BROWSER','REAL_HTTP','REAL_LINUX','REAL_BROWSER','REAL_LINUX','REAL_DB','REAL_LINUX','DOCUMENT_REVIEW','REAL_LINUX'];
  value.tests.forEach((row, i) => pass(row, methods[i]));
  return value;
}
test('template is valid but all 48 items block operation', () => {
  const result = assess(fresh()); assert.equal(result.blocked.length, 48); assert.equal(result.firstUnapprovedGate, 'GATE1'); assert.equal(result.authorizedToExecute, false);
});
test('complete synthetic dossier remains documentary and never authorizes execution', () => {
  const result = assess(complete()); assert.equal(result.documentaryStatus, 'COMPLETE_FOR_INDEPENDENT_REVIEW'); assert.equal(result.authorizedToExecute, false); assert.equal(result.operationalIsolationCertified, false);
});
test('every critical failure blocks even a complete dossier', () => {
  for (let i = 0; i < 16; i++) { const value = complete(); value.controls[i].status = 'FAIL'; assert.ok(assess(value).blocked.includes(value.controls[i].id)); }
});
test('each unexecuted real test blocks completion', () => {
  for (let i = 0; i < 25; i++) { const value = complete(); value.tests[i] = fresh().tests[i]; assert.equal(assess(value).documentaryStatus, 'BLOCKED'); }
});
test('rejects gate jumps', () => { const value = fresh(); pass(value.gates[1], 'EXPLICIT_AUTHORIZATION'); assert.throws(() => validate(value)); });
test('rejects static substitutes for real Linux/DB/HTTP/browser results', () => {
  for (let i = 0; i < 25; i++) { if (i === 23) continue; const value = complete(); value.tests[i].method = 'STATIC'; assert.throws(() => validate(value)); }
});
test('rejects missing, reordered and duplicate controls or categories', () => {
  for (const change of [v => v.controls.pop(), v => v.controls.reverse(), v => v.tests[1] = v.tests[0], v => v.gates.pop(), v => v.tests.pop()]) { const value = fresh(); change(value); assert.throws(() => validate(value)); }
});
test('rejects unknown keys, secrets fields and contract ratification', () => {
  for (const change of [v => v.password = 'synthetic', v => v.controls[0].token = 'synthetic', v => v.decisions = 'APPROVED', v => v.phase = 'LIVE']) { const value = fresh(); change(value); assert.throws(() => validate(value)); }
});
test('rejects fabricated placeholder hashes, invalid dates and personal identifiers', () => {
  for (const change of [v => v.tests[0].evidenceSha256 = '0'.repeat(64), v => v.tests[0].reviewedAt = '2026-02-30T00:00:00Z', v => v.tests[0].reviewer = 'person@example.invalid', v => v.tests[0].evidenceSha256 = null]) { const value = complete(); change(value); assert.throws(() => validate(value)); }
});
test('NO EJECUTADA cannot carry a claimed execution method or evidence', () => {
  const value = fresh(); value.tests[0].method = 'REAL_LINUX'; assert.throws(() => validate(value));
});
test('CLI reports blocked with exit 2, schema validation alone exits 0', () => {
  const path = resolve('infra/pricesmart-sandbox/s06a/dossier.example.json');
  for (const [command, status] of [['validate', 0], ['assess', 2]]) {
    const result = spawnSync(process.execPath, ['scripts/sandbox-s06a/preflight.mjs', command, path], { encoding: 'utf8' });
    assert.equal(result.status, status); assert.equal(JSON.parse(result.stdout).authorizedToExecute, false); assert.equal(result.stderr, '');
  }
});
test('loader rejects secret-named inputs, oversized files, links and sensitive output', () => {
  const root = mkdtempSync(join(tmpdir(), 's06a-'));
  try {
    const path = join(root, 'dossier.json'); writeFileSync(path, JSON.stringify(template)); assert.equal(load(path).phase, template.phase);
    const linked = join(root, 'linked'); symlinkSync(root, linked, 'junction'); assert.throws(() => load(join(linked, 'dossier.json')));
    const secret = join(root, 'secret.json'); writeFileSync(secret, 'SYNTHETIC_DO_NOT_PRINT'); assert.throws(() => load(secret));
    for (const name of ['credentials.json', 'passwords.json', 'private.key.json', '.env.json']) assert.throws(() => load(join(root, name)));
    const result = spawnSync(process.execPath, ['scripts/sandbox-s06a/preflight.mjs', 'validate', secret], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stderr.trim(), 'S06A_INVALID_DOSSIER'); assert.equal(result.stdout, '');
    writeFileSync(path, 'x'.repeat(65537)); assert.throws(() => load(path));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
