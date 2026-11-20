import { describe, expect, it } from 'vitest';
import { capasParaRecepcion } from './costos-fifo-reglas';

describe('costo de recepciones parciales', () => {
  it('distribuye todos los centavos una sola vez entre las recepciones', () => {
    const compra = { cantidadComprada: 3, precioUnitarioCentavos: BigInt("1000"), gastosCentavos: BigInt("10") };
    const primera = capasParaRecepcion({ ...compra, cantidadPrevia: 0, cantidadRecibida: 2 });
    const segunda = capasParaRecepcion({ ...compra, cantidadPrevia: 2, cantidadRecibida: 1 });
    expect([...primera, ...segunda].reduce((n, c) => n + BigInt(c.cantidad) * c.costoUnitarioCentavos!, BigInt("0"))).toBe(BigInt("3010"));
    expect(primera).toEqual([{ cantidad: 1, costoUnitarioCentavos: BigInt("1004") }, { cantidad: 1, costoUnitarioCentavos: BigInt("1003") }]);
  });
  it('conserva un costo desconocido y distingue un costo cero', () => {
    const base = { cantidadComprada: 1, cantidadPrevia: 0, cantidadRecibida: 1 };
    expect(capasParaRecepcion({ ...base, precioUnitarioCentavos: null, gastosCentavos: BigInt("0") })[0].costoUnitarioCentavos).toBeNull();
    expect(capasParaRecepcion({ ...base, precioUnitarioCentavos: BigInt("0"), gastosCentavos: BigInt("0") })[0].costoUnitarioCentavos).toBe(BigInt("0"));
    expect(capasParaRecepcion({ ...base, precioUnitarioCentavos: BigInt("100"), gastosCentavos: null })[0].costoUnitarioCentavos).toBeNull();
  });
  it('rechaza cantidades fuera de compra y montos negativos', () => {
    expect(() => capasParaRecepcion({ cantidadComprada: 2, cantidadPrevia: 1, cantidadRecibida: 2, precioUnitarioCentavos: BigInt("1"), gastosCentavos: BigInt("0") })).toThrow();
    expect(() => capasParaRecepcion({ cantidadComprada: 2, cantidadPrevia: 0, cantidadRecibida: 1, precioUnitarioCentavos: -BigInt("1"), gastosCentavos: BigInt("0") })).toThrow();
  });
  it('conserva el gasto total y las cantidades en particiones parciales diferentes', () => {
    for (let comprada = 1; comprada <= 20; comprada++) {
      for (let gasto = BigInt("0"); gasto <= BigInt("25"); gasto++) {
        let previa = 0;
        let importe = BigInt("0");
        let unidades = 0;
        while (previa < comprada) {
          const recibida = Math.min(3, comprada - previa);
          const capas = capasParaRecepcion({ cantidadComprada: comprada, cantidadPrevia: previa, cantidadRecibida: recibida, precioUnitarioCentavos: BigInt("100"), gastosCentavos: gasto });
          for (const capa of capas) {
            unidades += capa.cantidad;
            importe += BigInt(capa.cantidad) * capa.costoUnitarioCentavos!;
          }
          previa += recibida;
        }
        expect(unidades).toBe(comprada);
        expect(importe).toBe(BigInt("100") * BigInt(comprada) + gasto);
      }
    }
  });
  it('no acepta una recepción repetida que excede la compra', () => {
    expect(() => capasParaRecepcion({ cantidadComprada: 5, cantidadPrevia: 5, cantidadRecibida: 1, precioUnitarioCentavos: BigInt("0"), gastosCentavos: BigInt("0") })).toThrow('COSTO_O_CANTIDAD_INVALIDOS');
  });
});
