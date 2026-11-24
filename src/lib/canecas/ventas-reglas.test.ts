import { describe, expect, it } from 'vitest';
import { calcularVenta, formatearQuetzales, precioACentavos, validarCantidadVenta, validarFechaVenta } from './ventas-reglas';

describe('reglas de ventas de Canecas (centavos exactos)', () => {
  it.each([['0.01', 1], ['1', 100], ['12.5', 1250], ['85.00', 8500], ['1000000', 100000000], ['1000000.00', 100000000]])('precio %s → %d centavos', (valor, esperado) => { expect(precioACentavos(valor)).toBe(BigInt(esperado)); });
  it.each(['', '0', '0.00', '-5', '12.345', '1,000', 'abc', '1000000.01', '10000000', '1e3', ' '])('rechaza el precio inválido %j', valor => { expect(() => precioACentavos(valor)).toThrow('VENTA_INVALIDA'); });
  it('valida la cantidad en canecas enteras', () => {
    expect(validarCantidadVenta(8)).toBe(8);
    for (const x of [0, -1, 1.5, NaN, 1000001]) expect(() => validarCantidadVenta(x)).toThrow('VENTA_INVALIDA');
  });
  it('valida la fecha: real, con formato y no posterior a hoy', () => {
    expect(validarFechaVenta('2026-11-24', '2026-11-24')).toBe('2026-11-24');
    for (const f of ['2026-11-25', '2026-02-30', '24/11/2026', '', '1999-12-31']) expect(() => validarFechaVenta(f, '2026-11-24')).toThrow('VENTA_INVALIDA');
  });
  it('calcula ingreso, costo y utilidad bruta al centavo', () => {
    // 8 canecas a Q95.00; costo FIFO real Q640.00 (8 × Q80.00)
    expect(calcularVenta(precioACentavos('95'), 8, BigInt(64000))).toEqual({ totalCentavos: BigInt(76000), costoCentavos: BigInt(64000), utilidadCentavos: BigInt(12000) });
    // Con pérdida: la utilidad es negativa, no se oculta
    expect(calcularVenta(precioACentavos('70.01'), 3, BigInt(24000)).utilidadCentavos).toBe(BigInt(-2997));
    // Sin errores de coma flotante
    expect(calcularVenta(precioACentavos('0.10'), 3, BigInt(0)).totalCentavos).toBe(BigInt(30));
  });
  it('da formato de quetzales con separador de miles y signo', () => {
    expect(formatearQuetzales(BigInt(0))).toBe('Q 0.00');
    expect(formatearQuetzales(5)).toBe('Q 0.05');
    expect(formatearQuetzales('123456789')).toBe('Q 1,234,567.89');
    expect(formatearQuetzales(BigInt(-2997))).toBe('-Q 29.97');
  });
});
