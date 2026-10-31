// Offline dossier validation only. No subprocesses, sockets, SQL or system inspection.
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checked } from '../sandbox-s05/artifact.mjs';

export const controls = Array.from({ length: 16 }, (_, i) => `PF${String(i + 1).padStart(2, '0')}`);
export const tests = [
  ['A1', 'REAL_LINUX'], ['A2', 'REAL_LINUX'], ['B1', 'REAL_LINUX'], ['B2', 'REAL_LINUX'],
  ['C1', 'REAL_LINUX'], ['C2', 'REAL_LINUX'], ['C3', 'REAL_LINUX'],
  ['D1', 'REAL_LINUX'], ['D2', 'REAL_LINUX'], ['D3', 'REAL_BROWSER'],
  ['E1', 'REAL_DB'], ['E2', 'REAL_DB'], ['F1', 'REAL_DB'], ['F2', 'REAL_DB'], ['F3', 'REAL_DB'],
  ['G1', 'REAL_HTTP'], ['G2', 'REAL_BROWSER'], ['H1', 'REAL_HTTP'],
  ['I1', 'REAL_LINUX'], ['I2', 'REAL_BROWSER'], ['J1', 'REAL_LINUX'], ['J2', 'REAL_DB'],
  ['K1', 'REAL_LINUX'], ['L1', 'DOCUMENT_REVIEW'], ['L2', 'REAL_LINUX'],
];
const states = ['PASS', 'FAIL', 'NO EJECUTADA'];
const error = () => { throw new Error('S06A_INVALID_DOSSIER'); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) error();
}
function row(value, id, expectedMethod) {
  exact(value, ['id', 'status', 'method', 'evidenceSha256', 'reviewedAt', 'reviewer']);
  if (value.id !== id || !states.includes(value.status)) error();
  if (value.status === 'NO EJECUTADA') {
    if (value.method !== 'NOT_RUN' || value.evidenceSha256 !== null || value.reviewedAt !== null || value.reviewer !== null) error();
  } else {
    if (value.method !== expectedMethod || !/^[a-f0-9]{64}$/.test(value.evidenceSha256 ?? '') || /^([a-f0-9])\1{63}$/.test(value.evidenceSha256)) error();
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value.reviewedAt ?? '') || !Number.isFinite(Date.parse(value.reviewedAt)) || new Date(value.reviewedAt).toISOString() !== value.reviewedAt.replace('Z', '.000Z')) error();
    if (!/^qa-[a-z0-9-]{2,24}$/.test(value.reviewer ?? '')) error();
  }
}
export function validate(dossier) {
  exact(dossier, ['schemaVersion', 'phase', 'environment', 'decisions', 'controls', 'gates', 'tests']);
  if (dossier.schemaVersion !== 1 || dossier.phase !== 'S06-A-PREPARATION' || dossier.environment !== 'sandbox' || dossier.decisions !== 'D01-D16_PENDING_RATIFICATION') error();
  if (!Array.isArray(dossier.controls) || dossier.controls.length !== controls.length || !Array.isArray(dossier.tests) || dossier.tests.length !== tests.length || !Array.isArray(dossier.gates) || dossier.gates.length !== 7) error();
  dossier.controls.forEach((value, i) => row(value, controls[i], i === 0 ? 'DOCUMENT_REVIEW' : i === 14 ? 'REAL_DB' : 'REAL_LINUX'));
  dossier.tests.forEach((value, i) => row(value, tests[i][0], tests[i][1]));
  dossier.gates.forEach((value, i) => row(value, `GATE${i + 1}`, 'EXPLICIT_AUTHORIZATION'));
  // Gate approvals cannot jump over a missing/rejected previous gate.
  let stopped = false;
  for (const gate of dossier.gates) {
    if (stopped && gate.status === 'PASS') error();
    if (gate.status !== 'PASS') stopped = true;
  }
  return dossier;
}
export function assess(input) {
  const dossier = validate(input);
  const all = [...dossier.controls, ...dossier.gates, ...dossier.tests];
  const blocked = all.filter(value => value.status !== 'PASS').map(value => value.id);
  return {
    schemaValid: true,
    documentaryStatus: blocked.length ? 'BLOCKED' : 'COMPLETE_FOR_INDEPENDENT_REVIEW',
    blocked,
    firstUnapprovedGate: dossier.gates.find(value => value.status !== 'PASS')?.id ?? null,
    authorizedToExecute: false,
    operationalIsolationCertified: false,
  };
}
export function load(path) {
  const full = resolve(path);
  if (!full.endsWith('.json') || /(?:^|[.\-_])(env|secrets?|credentials?|passwords?|tokens?|keys?)(?:[.\-_]|$)/i.test(basename(full))) error();
  const safe = checked(dirname(full), basename(full));
  const stat = lstatSync(safe);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) error();
  return validate(JSON.parse(readFileSync(safe, 'utf8')));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, path, ...extra] = process.argv.slice(2);
    if (!['validate', 'assess'].includes(command) || !path || extra.length) error();
    const result = assess(load(path));
    console.log(JSON.stringify(command === 'validate' ? { schemaValid: true, authorizedToExecute: false } : result));
    if (command === 'assess' && result.blocked.length) process.exitCode = 2;
  } catch { console.error('S06A_INVALID_DOSSIER'); process.exitCode = 1; }
}
