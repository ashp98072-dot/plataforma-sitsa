import { describe, expect, it } from 'vitest';
import { capasParaRecepcion } from './costos-fifo-reglas';

describe('costo de recepciones parciales', () => {
  it('distribuye todos los centavos una sola vez entre las recepciones', () => {
    const compra = { cantidadComprada: 3, precioUnitarioCentavos: 1000n, gastosCentavos: 10n };
    const primera = capasParaRecepcion({ ...compra, cantidadPrevia: 0, cantidadRecibida: 2 });
    const segunda = capasParaRecepcion({ ...compra, cantidadPrevia: 2, cantidadRecibida: 1 });
    expect([...primera, ...segunda].reduce((n, c) => n + BigInt(c.cantidad) * c.costoUnitarioCentavos!, 0n)).toBe(3010n);
    expect(primera).toEqual([{ cantidad: 1, costoUnitarioCentavos: 1004n }, { cantidad: 1, costoUnitarioCentavos: 1003n }]);
  });
  it('conserva un costo desconocido y distingue un costo cero', () => {
    const base = { cantidadComprada: 1, cantidadPrevia: 0, cantidadRecibida: 1 };
    expect(capasParaRecepcion({ ...base, precioUnitarioCentavos: null, gastosCentavos: 0n })[0].costoUnitarioCentavos).toBeNull();
    expect(capasParaRecepcion({ ...base, precioUnitarioCentavos: 0n, gastosCentavos: 0n })[0].costoUnitarioCentavos).toBe(0n);
    expect(capasParaRecepcion({ ...base, precioUnitarioCentavos: 100n, gastosCentavos: null })[0].costoUnitarioCentavos).toBeNull();
  });
  it('rechaza cantidades fuera de compra y montos negativos', () => {
    expect(() => capasParaRecepcion({ cantidadComprada: 2, cantidadPrevia: 1, cantidadRecibida: 2, precioUnitarioCentavos: 1n, gastosCentavos: 0n })).toThrow();
    expect(() => capasParaRecepcion({ cantidadComprada: 2, cantidadPrevia: 0, cantidadRecibida: 1, precioUnitarioCentavos: -1n, gastosCentavos: 0n })).toThrow();
  });
});
