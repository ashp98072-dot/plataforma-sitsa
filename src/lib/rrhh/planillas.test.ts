import { describe, expect, it } from "vitest";
import { calcularCuadre, type PlanillaLinea } from "./planillas";

function linea(
  id: number,
  cambios: Partial<PlanillaLinea> = {},
): PlanillaLinea {
  return {
    id,
    periodoId: 1,
    empleadoId: id,
    codigoEmpleado: String(id),
    nombreEmpleado: `Empleado ${id}`,
    dpi: String(id),
    tipoContrato: "fijo",
    formaPago: "transferencia",
    sueldoMensual: 4000,
    sueldoBase: 2000,
    bonoIncentivo: 125,
    bonoHerramientas: 50,
    otrosIngresos: 25,
    igssLaboral: 96.6,
    igssPatronal: 253.4,
    descuentos: 100,
    isr: 0,
    neto: 2003.4,
    estadoPago: "Pendiente",
    refPago: "",
    notas: "",
    ...cambios,
  };
}

describe("cuadre crítico de planilla", () => {
  it("separa pagado/pendiente y formales/outsourcing sin perder centavos", () => {
    const resultado = calcularCuadre([
      linea(1, { estadoPago: "Pagado", neto: 2003.4 }),
      linea(2, {
        tipoContrato: "outsourcing",
        formaPago: "efectivo",
        neto: 1000.01,
        igssLaboral: 0,
        igssPatronal: 0,
      }),
    ]);

    expect(resultado.totales.empleados).toBe(2);
    expect(resultado.totales.formales).toBe(1);
    expect(resultado.totales.outsourcing).toBe(1);
    expect(resultado.totales.pagado).toBe(2003.4);
    expect(resultado.totales.pendiente).toBe(1000.01);
    expect(resultado.totales.neto).toBe(3003.41);
    expect(resultado.porFormaPago.transferencia.pagado).toBe(2003.4);
    expect(resultado.porFormaPago.efectivo.pendiente).toBe(1000.01);
  });
});
