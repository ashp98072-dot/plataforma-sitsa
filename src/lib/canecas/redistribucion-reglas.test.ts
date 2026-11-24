import { describe, expect, it } from 'vitest';
import { repartirRedistribucion, type CapaOrigen } from './redistribucion-reglas';

const T1 = '2026-01-01 08:00:00', T2 = '2026-01-02 08:00:00';
const capa = (capaId: string, cantidad: number, costo: number, creadoEn = T1, orden = Number(capaId)): CapaOrigen => ({ capaId, cantidad, creadoEn, orden: BigInt(orden), costoUnitarioCentavos: BigInt(costo) });
const total = (s: { cantidad: number; costoUnitarioCentavos: bigint }[]) => s.reduce((n, x) => n + x.costoUnitarioCentavos * BigInt(x.cantidad), BigInt(0));

describe('repartirRedistribucion', () => {
  it('20 → 25 reparte Q2,000.00 exactos a Q80.00 y conserva la antigüedad', () => {
    const r = repartirRedistribucion([capa('1', 20, 10000)], 25);
    expect(r).toMatchObject({ cantidadOrigen: 20, costoTotalCentavos: BigInt(200000) });
    expect(r.segmentos).toEqual([{ cantidad: 25, creadoEn: T1, ordenFifo: BigInt(1), costoUnitarioCentavos: BigInt(8000) }]);
  });
  it('20 → 20 reparte el costo sin cambiarlo cuando ya es uniforme', () => {
    const r = repartirRedistribucion([capa('1', 20, 10000)], 20);
    expect(r.segmentos).toEqual([{ cantidad: 20, creadoEn: T1, ordenFifo: BigInt(1), costoUnitarioCentavos: BigInt(10000) }]);
  });
  it('20 → 18 (merma) conserva el costo total en menos unidades: 200,000/18 = 11,111 con resto 2', () => {
    const r = repartirRedistribucion([capa('1', 20, 10000)], 18);
    expect(r.segmentos).toEqual([
      { cantidad: 2, creadoEn: T1, ordenFifo: BigInt(1), costoUnitarioCentavos: BigInt(11112) },
      { cantidad: 16, creadoEn: T1, ordenFifo: BigInt(1), costoUnitarioCentavos: BigInt(11111) },
    ]);
    expect(total(r.segmentos)).toBe(BigInt(200000));
  });
  it('asigna el resto en centavos a las unidades más antiguas', () => {
    const r = repartirRedistribucion([capa('1', 20, 10000), capa('2', 1, 1)], 25);
    expect(total(r.segmentos)).toBe(BigInt(200001));
    expect(r.segmentos[0]).toMatchObject({ cantidad: 1, costoUnitarioCentavos: BigInt(8001) });
    expect(r.segmentos.slice(1).map(x => [x.cantidad, x.ordenFifo, x.costoUnitarioCentavos])).toEqual([[19, BigInt(1), BigInt(8000)], [5, BigInt(2), BigInt(8000)]]);
  });
  it('mantiene la antigüedad de cada origen y las extras heredan la más reciente', () => {
    const r = repartirRedistribucion([capa('1', 2, 150, T1), capa('2', 2, 150, T2)], 6);
    expect(r.segmentos.map(s => [s.cantidad, s.creadoEn])).toEqual([[2, T1], [4, T2]]);
  });
  it('hereda la prioridad FIFO de cada origen aunque compartan el mismo segundo', () => {
    // Capas con el mismo creado_en pero prioridades distintas (7 y 9): se conservan por posición.
    const r = repartirRedistribucion([capa('10', 2, 150, T1, 7), capa('11', 2, 150, T1, 9)], 6);
    expect(r.segmentos.map(s => [s.cantidad, s.ordenFifo])).toEqual([[2, BigInt(7)], [4, BigInt(9)]]);
  });
  it('una capa ya redistribuida transmite su prioridad efectiva, no su id', () => {
    const r = repartirRedistribucion([capa('500', 3, 100, T1, 42)], 4);
    expect(r.segmentos.every(s => s.ordenFifo === BigInt(42))).toBe(true);
  });
  it('con merma descarta primero las unidades más recientes', () => {
    const r = repartirRedistribucion([capa('1', 2, 75, T1), capa('2', 2, 75, T2)], 3);
    expect(r.segmentos.map(s => [s.cantidad, s.creadoEn])).toEqual([[2, T1], [1, T2]]);
    expect(total(r.segmentos)).toBe(BigInt(300));
  });
  it('rechaza entradas inválidas', () => {
    expect(() => repartirRedistribucion([], 1)).toThrow('REDISTRIBUCION_INVALIDA');
    expect(() => repartirRedistribucion([capa('1', 1, 1)], 0)).toThrow('REDISTRIBUCION_INVALIDA');
    expect(() => repartirRedistribucion([capa('1', 1, 1)], 1.5)).toThrow('REDISTRIBUCION_INVALIDA');
    expect(() => repartirRedistribucion([capa('1', 0, 1)], 1)).toThrow('REDISTRIBUCION_INVALIDA');
  });
});
