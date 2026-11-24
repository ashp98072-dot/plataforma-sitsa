import { describe, expect, it } from 'vitest';
import { ejecutarVentasControlado } from '../../../scripts/ci/canecas/ejecutar-ventas-controlado.mjs';
import { triggersEsperadosVentas } from '../../../scripts/ci/canecas/contrato-ventas.mjs';

const conexion = (version: string, grants: string[]) => ({
  query: async (sql: string) => {
    if (sql.startsWith('SELECT DATABASE() base')) return [[{ base: 'u611730801_Plataforma', version }], []];
    if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [grants.map(g => ({ g })), []];
    throw new Error(`consulta inesperada antes de validar: ${sql.slice(0, 40)}`);
  },
});
const concesion = (permisos: string) => `GRANT ${permisos} ON \`u611730801_Plataforma\`.* TO \`u\`@\`%\``;

describe('instalador de ventas: condiciones previas (sin base de datos)', () => {
  it('se detiene ante una versión distinta de 11.8.9', async () => {
    await expect(ejecutarVentasControlado(conexion('10.11.14-MariaDB', [concesion('ALL PRIVILEGES')]))).rejects.toThrow('versión incompatible');
  });
  it.each(['CREATE, INDEX, REFERENCES, TRIGGER', 'SELECT, INDEX, REFERENCES, TRIGGER', 'SELECT, CREATE, REFERENCES, TRIGGER', 'SELECT, CREATE, INDEX, TRIGGER', 'SELECT, CREATE, INDEX, REFERENCES'])('exige SELECT, CREATE, INDEX, REFERENCES y TRIGGER: %s', async permisos => {
    await expect(ejecutarVentasControlado(conexion('11.8.9-MariaDB-ubu2404', [concesion(permisos)]))).rejects.toThrow('privilegios directos insuficientes');
  });
  it('la migración define exactamente los 4 triggers esperados', () => {
    expect(triggersEsperadosVentas().map(t => t.TRIGGER_NAME).sort()).toEqual(['trg_can_mapeo_bd', 'trg_can_mapeo_bu', 'trg_can_venta_bd', 'trg_can_venta_bu']);
  });
});
