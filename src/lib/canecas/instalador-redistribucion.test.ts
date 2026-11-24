import { describe, expect, it } from 'vitest';
import { ejecutarRedistribucionControlado } from '../../../scripts/ci/canecas/ejecutar-redistribucion-controlado.mjs';
import { ORDEN_FIFO_SQL, triggersEsperadosRedistribucion } from '../../../scripts/ci/canecas/contrato-redistribucion.mjs';
import { ORDEN_FIFO } from './orden-fifo';

const conexion = (version: string, grants: string[]) => ({
  query: async (sql: string) => {
    if (sql.startsWith('SELECT DATABASE() base')) return [[{ base: 'u611730801_Plataforma', version }], []];
    if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [grants.map(g => ({ g })), []];
    throw new Error(`consulta inesperada antes de validar: ${sql.slice(0, 40)}`);
  },
});
const concesion = (permisos: string) => `GRANT ${permisos} ON \`u611730801_Plataforma\`.* TO \`u\`@\`%\``;

describe('instalador de redistribución: condiciones previas (sin base de datos)', () => {
  it('se detiene ante una versión distinta de 11.8.9', async () => {
    await expect(ejecutarRedistribucionControlado(conexion('10.11.14-MariaDB', [concesion('ALL PRIVILEGES')]))).rejects.toThrow('versión incompatible');
  });
  it.each(['SELECT, CREATE, INDEX, REFERENCES, TRIGGER', 'SELECT, CREATE, ALTER, REFERENCES, TRIGGER', 'SELECT, CREATE, ALTER, INDEX, TRIGGER', 'SELECT, CREATE, ALTER, INDEX, REFERENCES'])('exige ALTER, INDEX, REFERENCES y TRIGGER: %s', async permisos => {
    await expect(ejecutarRedistribucionControlado(conexion('11.8.9-MariaDB-ubu2404', [concesion(permisos)]))).rejects.toThrow('privilegios directos insuficientes');
  });
  it('el criterio FIFO del contrato coincide con el que usa el código', () => {
    expect(ORDEN_FIFO_SQL).toBe(ORDEN_FIFO);
  });
  it('la migración define exactamente los 5 triggers esperados', () => {
    expect(triggersEsperadosRedistribucion().map(t => t.TRIGGER_NAME).sort()).toEqual(['can_capa_costo_inmutable', 'trg_can_redis_bd', 'trg_can_redis_bu', 'trg_can_redis_origen_bd', 'trg_can_redis_origen_bu']);
  });
});
