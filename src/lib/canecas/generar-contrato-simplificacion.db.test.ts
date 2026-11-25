import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { obtenerContratoSimplificacion } from '../../../scripts/ci/canecas/contrato-simplificacion.mjs';
import { aplicar, crearBase, hayLaboratorio, instaladorEn, prepararBaseHastaVentas } from './lab-simplificacion';

// Solo laboratorio: CANECAS_GENERAR_CONTRATO=simplificacion. Contrato posterior a la migración en MariaDB 11.8.9 desechable.
describe.skipIf(process.env.CANECAS_GENERAR_CONTRATO !== 'simplificacion' || !hayLaboratorio)('generar contrato de simplificación solo en laboratorio', () => {
  it('registra metadatos de la migración sobre la cadena completa instalada', async () => {
    const pool = await crearBase('canecas_simp_gen_test');
    try {
      await prepararBaseHastaVentas(pool);
      await aplicar(pool, 'sql/migrate-2026-11-canecas-simplificacion-wip.sql');
      const contrato = await instaladorEn(pool, c => obtenerContratoSimplificacion(c));
      writeFileSync('scripts/ci/canecas/contrato-simplificacion-mariadb-11.8.9.json', `${JSON.stringify(contrato, null, 2)}\n`);
    } finally { await pool.end(); }
  }, 120000);
});
