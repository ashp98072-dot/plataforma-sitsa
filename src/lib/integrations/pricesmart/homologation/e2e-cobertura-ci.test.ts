import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// El CI de PriceSmart no debe declarar éxito si OMITE pruebas críticas: todo archivo `*.e2e.ts` del laboratorio debe estar enlistado en el runner Linux (que ejecuta el workflow `pricesmart-lab.yml`).
// Un E2E nuevo que nadie enlista, o uno que se quita de la lista, hace fallar las pruebas unitarias del mismo workflow.
const root = path.resolve(__dirname, '../../../../..'); const dir = path.join(root, 'scripts/ci/pricesmart-demo');
const runner = readFileSync(path.join(dir, 'run-linux.mjs'), 'utf8');
const workflow = readFileSync(path.join(root, '.github/workflows/pricesmart-lab.yml'), 'utf8');
const e2e = readdirSync(dir).filter((f) => f.endsWith('.e2e.ts')).map((f) => f.replace(/\.e2e\.ts$/, ''));

describe('cobertura de los E2E en el CI Linux', () => {
  it('todo archivo *.e2e.ts del laboratorio está enlistado en run-linux.mjs (ninguno puede quedar sin ejecutar)', () => {
    expect(e2e.length).toBeGreaterThanOrEqual(10);
    const missing = e2e.filter((name) => !new RegExp(`['"\`/]${name.replace(/[-]/g, '\\-')}(?:\\.e2e\\.ts)?['"\`]`).test(runner));
    expect(missing, `E2E sin enlistar en run-linux.mjs: ${missing.join(', ')}`).toEqual([]);
  });
  it('el workflow ejecuta las unitarias de PriceSmart y el runner E2E sin tolerar fallos (sin continue-on-error ni || true) y el runner falla si una fase falla', () => {
    expect(workflow).toMatch(/run-linux\.mjs/); expect(workflow).toMatch(/vitest run/); expect(workflow).not.toMatch(/continue-on-error|\|\|\s*true/);
    expect(runner).toMatch(/if \(c !== 0\) code = 1;/); expect(runner).toMatch(/main\(\)\.then\(\(c\) => process\.exit\(c\)/);
  });
  it('el workflow también corre tras cada merge a main, con EXACTAMENTE el mismo filtro de rutas que los PR, sin cancelar corridas de main y con permisos de solo lectura', () => {
    const lineas = workflow.split(/\r?\n/);
    /** Rutas listadas bajo `  <disparador>:` → `    paths:` (hasta la primera línea que no sea `      - '…'`). */
    const rutas = (disparador: string) => {
      const i = lineas.indexOf(`  ${disparador}:`); if (i < 0) return null;
      const p = lineas.indexOf('    paths:', i); if (p < 0) return null; const out: string[] = [];
      for (let k = p + 1; k < lineas.length; k++) { const m = /^ {6}- '([^']+)'$/.exec(lineas[k]); if (!m) break; out.push(m[1]); }
      return out;
    };
    const pr = rutas('pull_request'), push = rutas('push');
    expect(pr, 'falta el disparador pull_request con rutas').not.toBeNull(); expect(push, 'falta el disparador push con rutas').not.toBeNull();
    expect(push).toEqual(pr); expect(pr).toContain('src/lib/integrations/pricesmart/**');
    const iPush = lineas.indexOf('  push:'); expect(lineas[iPush + 1]).toBe('    branches: [main]');
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(lineas.slice(lineas.indexOf('permissions:'), lineas.indexOf('permissions:') + 2)).toEqual(['permissions:', '  contents: read']);
    expect(workflow).not.toMatch(/pull_request_target|^ {2}schedule:/m);
  });
});
