import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as bundle from '../../../../../scripts/ci/pricesmart-homologation/bundle.mjs';

const repo = path.resolve(__dirname, '../../../../..');

// Causa raíz del fallo TMS_SCHEMA_INCOMPLETE del ensayo de aprovisionamiento (API-26): `sql/migrate-2026-11-cb2-vinculo-unidad.sql` (módulo de combustibles CB2, no instalado en el sandbox)
// se añadió a main DESPUÉS de fijar la lista de exclusión, quedó INCLUIDA y altera `flota_cb2_consumos`, que no existe → `finalize` la rechazaba. No dependía de Linux.
describe('alcance del esquema del TMS en el sandbox (deriva de migraciones)', () => {
  const files = bundle.tmsSchemaFiles(repo) as string[];
  const excluded = (bundle.tmsExcludedFiles(repo) as string[]);

  it('ninguna migración INCLUIDA (salvo sql/schema.sql, que omite esas sentencias una a una con OUT_OF_SCOPE_STATEMENT) toca tablas de módulos fuera de alcance (combustibles CB2, contabilidad de regularización/origen)', () => {
    const touching = files.filter((f) => f !== 'sql/schema.sql' && /\b(?:flota_cb2_\w+|cont_regularizacion\w*|cont_asientos_origen\w*)\b/i.test(readFileSync(path.join(repo, f), 'utf8').replace(/--.*$/gm, '')));
    expect(touching, `migraciones incluidas que dependen de un módulo no instalado: ${touching.join(', ')} → añadir a OUT_OF_SCOPE_FILES (con revisión)`).toEqual([]);
  });
  it('la migración que causó la deriva está excluida, declarada con su módulo, y la exclusión NO oculta archivos del esquema base ni de PriceSmart', () => {
    expect(excluded).toContain('sql/migrate-2026-11-cb2-vinculo-unidad.sql'); expect(files).not.toContain('sql/migrate-2026-11-cb2-vinculo-unidad.sql');
    expect(bundle.OUT_OF_SCOPE_FILES['cb2-vinculo-unidad']).toBe('combustibles-cb2');
    expect(files).toEqual(expect.arrayContaining(['sql/schema.sql', 'sql/migrate-2026-08-rrhh-colaborador-auth.sql', 'sql/migrate-2026-11-tms-parada-confirmaciones.sql']));
    expect(excluded.some((f) => /pricesmart|ps_api|plan|parada|solicitud/i.test(f))).toBe(false);
  });
});
