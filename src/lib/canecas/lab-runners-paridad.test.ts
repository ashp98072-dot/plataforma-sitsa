import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const leer = (archivo: string) => readFileSync(archivo, 'utf8');
const archivosDePrueba = (texto: string) => [...new Set(texto.match(/src\/lib\/canecas\/[a-z-]+\.db\.test\.ts/g) ?? [])].sort();
const basesYUsuarios = (texto: string) => [...new Set(texto.match(/(?:DATABASE canecas_[a-z_]+|USER 'fifo_[a-z_${}]+'@'localhost'|REQUIRE SSL)/g) ?? [])].sort();

describe('runners del laboratorio de Canecas (Windows y Linux)', () => {
  const windows = leer('scripts/ci/canecas/run-costos-lab-wip.mjs');
  const linux = leer('scripts/ci/canecas/run-costos-lab-linux.mjs');
  it('ejecutan los mismos archivos de prueba', () => {
    expect(archivosDePrueba(linux)).toEqual(archivosDePrueba(windows));
    expect(archivosDePrueba(linux)).toContain('src/lib/canecas/redistribucion.db.test.ts');
    expect(archivosDePrueba(linux)).toContain('src/lib/canecas/salidas-fifo.db.test.ts');
  });
  it('crean las mismas bases y usuarios desechables', () => {
    expect(basesYUsuarios(linux)).toEqual(basesYUsuarios(windows));
  });
  it('el runner Linux exige MariaDB 11.8.9 exacto y no se conecta por red a Hostinger', () => {
    expect(linux).toMatch(/Ver 11\\\.8\\\.9-MariaDB/);
    expect(linux).toContain("startsWith('11.8.9-MariaDB')");
    expect(linux).not.toMatch(/hstgr|hostinger\.com|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/i);
  });
});
