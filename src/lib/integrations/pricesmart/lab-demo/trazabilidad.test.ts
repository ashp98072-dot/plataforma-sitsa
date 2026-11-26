import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// La matriz de trazabilidad no puede citar archivos inexistentes ni dejar requisitos sin implementación, prueba o decisión pendiente.
const DIR = 'docs/integraciones/pricesmart/auditoria-homologacion';
const matriz = readFileSync(`${DIR}/MATRIZ-TRAZABILIDAD.md`, 'utf8');
const ROOTS = ['', 'src/lib/integrations/pricesmart', 'docs/integraciones/pricesmart'];
const rows = matriz.split('\n').filter((l) => /^\| (R-\d+|D\d+|T-\d+) \|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const tokens = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((t) => /\.(ts|tsx|json|md|mjs|sql|in)$/.test(t));

describe('matriz de trazabilidad PriceSmart', () => {
  it('cita únicamente archivos que existen (desde la raíz, src/lib/integrations/pricesmart o docs/integraciones/pricesmart)', () => {
    const missing: string[] = [];
    for (const row of rows) for (const t of tokens(row.join(' '))) if (!ROOTS.some((r) => existsSync(path.join(r, t)))) missing.push(`${row[0]}: ${t}`);
    expect(missing).toEqual([]);
  });
  it('cubre D01–D16, los ocho requisitos de la reunión y toda fila indica estado, archivos y pruebas (salvo lo fuera de alcance)', () => {
    const ids = rows.map((r) => r[0]);
    for (let n = 1; n <= 16; n++) expect(ids, `D${String(n).padStart(2, '0')}`).toContain(`D${String(n).padStart(2, '0')}`);
    for (let n = 1; n <= 8; n++) expect(ids).toContain(`R-0${n}`);
    for (const r of rows) {
      if (r[0] === 'D16') continue;   // KPI: fuera de la integración operativa
      expect(r.length, r[0]).toBe(6); expect(tokens(r[3]).length, `${r[0]} archivos`).toBeGreaterThan(0); expect(tokens(r[4]).length, `${r[0]} pruebas`).toBeGreaterThan(0);
      expect(r[2].length, `${r[0]} estado`).toBeGreaterThan(3); expect(r[5].length, `${r[0]} pendiente`).toBeGreaterThan(3);
    }
  });
  it('las pruebas citadas son archivos de prueba y los implementados no lo son; ninguna fila afirma aprobación de PriceSmart ni «confirmado» fuera de la dirección de D01 (lo «interno aprobado» se declara como tal)', () => {
    for (const r of rows.filter((x) => x[0] !== 'D16')) {
      for (const t of tokens(r[4])) expect(t, `${r[0]} prueba`).toMatch(/\.test\.ts$/);
      for (const t of tokens(r[3])) expect(t, `${r[0]} implementación`).not.toMatch(/\.test\.ts$/);
      if (!['R-01', 'R-02', 'R-03', 'D01'].includes(r[0])) expect(r[2], r[0]).not.toMatch(/confirmad[ao]/i);   // solo la dirección de D01 está confirmada
      expect(r[2], r[0]).not.toMatch(/aprobad[ao] (por PriceSmart|para producción)|ratificad[ao] por PriceSmart/i);
    }
    expect(matriz).toMatch(/minuta original no está en el repositorio/);
  });
});
