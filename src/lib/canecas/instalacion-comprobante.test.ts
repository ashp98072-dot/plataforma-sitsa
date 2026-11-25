import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'sql/instalacion-comprobante-phpmyadmin';
const BASE = 'u611730801_Plataforma';
const archivos = Object.fromEntries(readdirSync(DIR).sort().map(n => [n, readFileSync(`${DIR}/${n}`, 'utf8')]));
const sinComentarios = (t: string) => t.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');

describe('instalación manual del comprobante de venta (SQL)', () => {
  it('son 5 archivos numerados: preflight, etapa 1, verificación, etapa 2 (trigger) y postcheck', () => {
    expect(Object.keys(archivos)).toEqual(['01-preflight-solo-lectura.sql', '02-etapa1-columnas.sql', '03-verificar-etapa1-solo-lectura.sql', '04-etapa2-trigger.sql', '05-postcheck-solo-lectura.sql']);
  });
  it('esquema explícito: sin USE, sin DATABASE(), toda tabla/trigger calificada y todo metadato filtrado por la base de producción', () => {
    for (const [n, t] of Object.entries(archivos)) {
      const sql = sinComentarios(t);
      expect(sql, n).not.toMatch(/\bUSE\b|DATABASE\s*\(/i);
      expect(sql, n).not.toMatch(/\b(FROM|JOIN|TABLE|ON)\s+canecas_/i);
      for (const m of sql.matchAll(/(?:TABLE_SCHEMA|TRIGGER_SCHEMA)\s*=\s*'([^']+)'/g)) expect(m[1], n).toBe(BASE);
    }
  });
  it('preflight, verificación y postcheck solo leen; las etapas de escritura son exactamente las esperadas', () => {
    for (const n of Object.keys(archivos).filter(x => x.includes('solo-lectura'))) {
      const lineas = sinComentarios(archivos[n]).split('\n').filter(l => /^[A-Z]/.test(l));
      expect(lineas.filter(l => /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|REPLACE|RENAME|SET|PREPARE|EXECUTE)\b/.test(l)), n).toEqual([]);
      expect(lineas.filter(l => l.startsWith('SELECT')).length, n).toBeGreaterThan(3);
    }
    expect(sinComentarios(archivos['02-etapa1-columnas.sql']).trim()).toBe(`ALTER TABLE \`${BASE}\`.canecas_ventas\n  ADD COLUMN IF NOT EXISTS quien_lleva VARCHAR(160) NULL,\n  ADD COLUMN IF NOT EXISTS quien_recibe VARCHAR(160) NULL;`);
    expect(sinComentarios(archivos['04-etapa2-trigger.sql'])).not.toMatch(/\bDROP\b|\bDELETE\b|TRUNCATE|\bUPDATE `/i);
  });
  it('fidelidad: el trigger nuevo es EXACTAMENTE el de la simplificación (#689) más las dos comparaciones NEW/OLD, y no pierde ninguna protección', () => {
    const origen = readFileSync('sql/migrate-2026-11-canecas-simplificacion-wip.sql', 'utf8').split('DELIMITER //')[1].split('//')[0].trim();
    const cuerpoOrigen = origen.replace(/^CREATE OR REPLACE TRIGGER trg_can_venta_bu\nBEFORE UPDATE ON canecas_ventas\nFOR EACH ROW\n/, '');
    const literal = sinComentarios(archivos['04-etapa2-trigger.sql']).match(/,\n'(CREATE OR REPLACE TRIGGER(?:[^']|'')*)',\n'SELECT/)![1].replace(/''/g, "'");
    const [cabecera, cuerpo] = [literal.slice(0, literal.indexOf('BEGIN')), literal.slice(literal.indexOf('BEGIN'))];
    expect(cabecera).toBe(`CREATE OR REPLACE TRIGGER \`${BASE}\`.trg_can_venta_bu\nBEFORE UPDATE ON \`${BASE}\`.canecas_ventas\nFOR EACH ROW\n`);
    const lineaDir = '    OR NOT (NEW.direccion_entrega <=> OLD.direccion_entrega)\n';
    expect(cuerpo).toBe(cuerpoOrigen.replace(lineaDir, `${lineaDir}    OR NOT (NEW.quien_lleva <=> OLD.quien_lleva)\n    OR NOT (NEW.quien_recibe <=> OLD.quien_recibe)\n`));
    expect(cuerpo).toContain("'CANECAS_VENTA_INMUTABLE'"); expect(cuerpo).toContain("'CANECAS_VENTA_ANULADA_INMUTABLE'");
    // El postcheck compara contra ese mismo cuerpo.
    expect(archivos['05-postcheck-solo-lectura.sql']).toContain(`'${cuerpo.replace(/'/g, "''")}'`);
  });
  it('etapa 2: guarda intrínseca (PREPARE condicionado), delimitador // y orden PREPARE → EXECUTE → DEALLOCATE', () => {
    const sql = sinComentarios(archivos['04-etapa2-trigger.sql']).trim();
    expect(sql).toMatch(/^SET @etapa_sql = IF\(\n[\s\S]*COLUMN_NAME IN \('quien_lleva','quien_recibe'\)\)=2 AND/);
    const orden = ['PREPARE etapa_stmt FROM @etapa_sql//', 'EXECUTE etapa_stmt//', 'SHOW WARNINGS//', 'DEALLOCATE PREPARE etapa_stmt//'].map(x => sql.indexOf(x));
    expect(orden.every((x, i) => x > 0 && (i === 0 || x > orden[i - 1]))).toBe(true);
    expect(archivos['04-etapa2-trigger.sql']).toContain('Delimitador');
    expect(sql).not.toMatch(/^CREATE OR REPLACE TRIGGER/m); // ninguna DDL suelta fuera del literal
  });
  it('solo ASCII (se pega en phpMyAdmin sin problemas de codificación)', () => {
    for (const [n, t] of Object.entries(archivos)) expect(/^[\x00-\x7f]*$/.test(t), n).toBe(true);
  });
});
