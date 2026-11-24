import { describe, expect, it } from 'vitest';
import { privilegiosDirectos } from '../../../scripts/ci/canecas/privilegios.mjs';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';
import { ejecutarSalidasControlado } from '../../../scripts/ci/canecas/ejecutar-salidas-controlado.mjs';
import { ejecutarRedistribucionControlado } from '../../../scripts/ci/canecas/ejecutar-redistribucion-controlado.mjs';
import { ejecutarCatalogosControlado } from '../../../scripts/ci/canecas/ejecutar-catalogos-controlado.mjs';
import { ejecutarVentasControlado } from '../../../scripts/ci/canecas/ejecutar-ventas-controlado.mjs';

const BASE = 'u611730801_Plataforma';
const ESC = 'u611730801\\_Plataforma';
const g = (permisos: string, objeto: string) => `GRANT ${permisos} ON ${objeto} TO \`u\`@\`%\``;
const filas = (...v: string[]) => v.map(x => ({ x }));

describe('privilegiosDirectos', () => {
  it('reconoce la base con guion bajo escapado (MariaDB 11.8.9)', () => {
    const p = privilegiosDirectos(filas(g('SELECT, CREATE', `\`${ESC}\`.*`)), BASE);
    expect([...p].sort()).toEqual(['CREATE', 'SELECT']);
  });
  it('caso real de Hostinger: ALL PRIVILEGES con guion bajo sin escapar cubre la base', () => {
    expect(privilegiosDirectos(filas(g('ALL PRIVILEGES', `\`${BASE}\`.*`)), BASE).has('ALL PRIVILEGES')).toBe(true);
  });
  it('un guion bajo sin escapar solo cubre exactamente un carácter', () => {
    for (const o of ['`u611730801_Plataform`.*', '`u611730801_Plataforma_`.*', '`u611730801__Plataforma`.*', '`u611730802_Plataforma`.*', '`U611730801_Plataforma`.*']) {
      expect(privilegiosDirectos(filas(g('ALL PRIVILEGES', o)), BASE).size).toBe(0);
    }
    expect(privilegiosDirectos(filas(g('SELECT', '`u6117308___Plataforma`.*')), BASE).has('SELECT')).toBe(true);
  });
  it('rechaza cualquier patrón con % sin escapar (cobertura amplia)', () => {
    for (const o of ['`%`.*', '`u611730801%`.*', '`u611730801_Plataform%`.*', '`%Plataforma`.*']) {
      expect(privilegiosDirectos(filas(g('ALL PRIVILEGES', o)), BASE).size).toBe(0);
    }
  });
  it('un % escapado es literal y no cubre la base', () => {
    expect(privilegiosDirectos(filas(g('ALL PRIVILEGES', '`u611730801\\_Plataform\\%`.*')), BASE).size).toBe(0);
  });
  it('reconoce permisos directos completos', () => {
    expect(privilegiosDirectos(filas(g('ALL PRIVILEGES', `\`${ESC}\`.*`)), BASE).has('ALL PRIVILEGES')).toBe(true);
  });
  it('ignora permisos de otra base, incluidas las que solo difieren en el guion bajo', () => {
    const otras = [`\`otra\\_base\`.*`, '`u611730801xPlataforma`.*', '`u611730801\\_Plataforma2`.*', '`%`.*', '`u611730801%`.*'];
    for (const o of otras) expect(privilegiosDirectos(filas(g('ALL PRIVILEGES', o)), BASE).size).toBe(0);
  });
  it('ignora permisos de tabla/columna y roles', () => {
    const rows = filas(g('SELECT', `\`${ESC}\`.\`empresas\``), 'GRANT `rol` TO `u`@`%`', g('SELECT (id)', `\`${ESC}\`.\`t\``));
    expect(privilegiosDirectos(rows, BASE).size).toBe(0);
  });
  it('acepta permisos globales', () => {
    expect(privilegiosDirectos(filas(g('ALL PRIVILEGES', '*.*')), BASE).has('ALL PRIVILEGES')).toBe(true);
  });
  it('permisos insuficientes no incluyen los requeridos', () => {
    expect(privilegiosDirectos(filas(g('SELECT', `\`${ESC}\`.*`)), BASE).has('CREATE')).toBe(false);
  });
});

const conexion = (grants: string[]) => ({
  query: async (sql: string) => {
    if (sql.startsWith('SELECT DATABASE()')) return [[{ base: BASE, version: '11.8.9-MariaDB-ubu2404' }], []];
    if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [filas(...grants), []];
    throw new Error('LLEGO_MAS_ALLA');
  },
});
const instaladores = { costos: ejecutarCostosControlado, salidas: ejecutarSalidasControlado, redistribucion: ejecutarRedistribucionControlado, catalogos: ejecutarCatalogosControlado, ventas: ejecutarVentasControlado } as const;

describe.each(Object.entries(instaladores))('instalador %s: validación de privilegios', (_n, ejecutar) => {
  const fn = ejecutar as (c: unknown) => Promise<unknown>;
  it('acepta ALL PRIVILEGES con base escapada (supera la validación de privilegios)', async () => {
    await expect(fn(conexion([g('ALL PRIVILEGES', `\`${ESC}\`.*`)]))).rejects.toThrow('LLEGO_MAS_ALLA');
  });
  it('acepta permisos globales', async () => {
    await expect(fn(conexion([g('ALL PRIVILEGES', '*.*')]))).rejects.toThrow('LLEGO_MAS_ALLA');
  });
  it('rechaza permisos insuficientes', async () => {
    await expect(fn(conexion([g('SELECT', `\`${ESC}\`.*`)]))).rejects.toThrow('privilegios directos insuficientes');
  });
  it('rechaza permisos de otra base', async () => {
    await expect(fn(conexion([g('ALL PRIVILEGES', '`otra\\_base`.*')]))).rejects.toThrow('privilegios directos insuficientes');
  });
});
