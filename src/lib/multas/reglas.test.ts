import { describe, expect, it } from "vitest";
import { centavos, nuevaMulta, transicion, validarMulta } from "./reglas";

const base = { revision_id: 2, vehiculo_id: 3, fecha_infraccion: "2026-08-01", tipo_multa: "Prueba",
  descripcion: "Caso sintético", monto_total: "100.00", tipo_responsabilidad: "POR_DEFINIR", resolucion_economica: "PENDIENTE" };
const personal = { tipo_responsabilidad: "PILOTO", empleado_responsable_id: 5 };
describe("reglas Multas", () => {
  it("PENDIENTE conserva montos NULL", () => {
    const m = nuevaMulta(base);
    expect(m.monto_empresa).toBeNull(); expect(m.monto_colaborador).toBeNull();
    expect(() => nuevaMulta({ ...base, monto_empresa: 0 })).toThrow();
  });
  it.each([
    ["EMPRESA", "100.00", "0.00"], ["COLABORADOR", "0.00", "100.00"], ["COMPARTIDO", "33.33", "66.67"],
  ])("acepta reparto exacto %s", (resolucion_economica, monto_empresa, monto_colaborador) => {
    expect(nuevaMulta({ ...base, ...personal, resolucion_economica, monto_empresa, monto_colaborador }).monto_empresa).toBe(monto_empresa);
  });
  it("COMPARTIDO exige suma exacta y dos importes positivos", () => {
    expect(() => nuevaMulta({ ...base, ...personal, resolucion_economica: "COMPARTIDO", monto_empresa: "33.33", monto_colaborador: "66.66" })).toThrow();
    expect(() => nuevaMulta({ ...base, ...personal, resolucion_economica: "COMPARTIDO", monto_empresa: 0, monto_colaborador: 100 })).toThrow();
    expect(centavos("0.29")).toBe(29);
    expect(centavos("9999999999.99")).toBe(999999999999);
  });
  it.each(["-1", "0.001", "NaN", "1e3", "10000000000.00"])("rechaza importe %s", (monto_total) => {
    expect(() => nuevaMulta({ ...base, monto_total })).toThrow();
  });
  it("NO_APLICA requiere justificación", () => {
    const data = { ...base, resolucion_economica: "NO_APLICA", monto_empresa: 0, monto_colaborador: 0 };
    expect(() => nuevaMulta(data)).toThrow();
    expect(nuevaMulta({ ...data, observaciones: "Exoneración documentada" }).estado_pago).toBe("NO_APLICA");
  });
  it.each([
    { tipo_responsabilidad: "EMPRESA", empleado_responsable_id: 5 },
    { ...personal, responsable_texto: "Dos responsables" },
    { tipo_responsabilidad: "LOGISTICA" },
    { resolucion_economica: "COLABORADOR", monto_empresa: 0, monto_colaborador: 100 },
  ])("rechaza responsable incoherente %j", (extra) => expect(() => nuevaMulta({ ...base, ...extra })).toThrow());
  it("acepta responsable libre sin empleado", () => {
    expect(nuevaMulta({ ...base, tipo_responsabilidad: "OTRO_COLABORADOR", responsable_texto: "Responsable externo" }).empleado_responsable_id).toBeNull();
  });
  it("rechaza fecha inválida, placa inyectada e identidad en PATCH", () => {
    expect(() => nuevaMulta({ ...base, fecha_infraccion: "2026-02-30" })).toThrow();
    expect(() => nuevaMulta({ ...base, placa_historica: "INYECTADA" })).toThrow();
    expect(() => transicion(nuevaMulta(base), { accion: "datos", empresa_id: 7 }, 1)).toThrow();
    expect(() => transicion(nuevaMulta(base), { accion: "datos", monto_total: "0" }, 1)).toThrow();
  });
  it("RESUELTA con obligaciones pendientes se rechaza", () => {
    expect(() => transicion(nuevaMulta(base), { accion: "estado", estado: "RESUELTA" }, 1)).toThrow(/pendientes/);
  });
  it("PAGADA y DESCONTADO requieren metadatos", () => {
    const m = nuevaMulta({ ...base, ...personal, resolucion_economica: "COLABORADOR", monto_empresa: 0, monto_colaborador: 100 });
    expect(() => validarMulta({ ...m, estado_pago: "PAGADA" })).toThrow(/Metadatos/);
    expect(() => validarMulta({ ...m, estado_descuento: "DESCONTADO" })).toThrow(/Metadatos/);
  });
  it("solo servidor fija metadatos; completa pago y descuento antes de resolver", () => {
    const m = nuevaMulta({ ...base, ...personal, resolucion_economica: "COLABORADOR", monto_empresa: 0, monto_colaborador: 100 });
    const ahora = new Date();
    const pagada = transicion(m, { accion: "pagar" }, 8, ahora).multa;
    expect(pagada.pagada_en).toBe(ahora); expect(pagada.pagada_por_usuario_id).toBe(8);
    expect(() => transicion(pagada, { accion: "estado", estado: "RESUELTA" }, 8)).toThrow();
    const descontada = transicion(pagada, { accion: "descontar" }, 9, ahora).multa;
    expect(descontada.descontada_por_usuario_id).toBe(9);
    expect(transicion(descontada, { accion: "estado", estado: "RESUELTA" }, 8).multa.estado).toBe("RESUELTA");
    expect(() => transicion(pagada, { accion: "pagar" }, 8)).toThrow();
    expect(() => transicion(m, { accion: "pagar", pagada_por_usuario_id: 99 }, 8)).toThrow();
  });
  it.each(["pagar", "descontar"])("bloquea anulación y cambios económicos después de %s", (accion) => {
    const m = nuevaMulta({ ...base, ...personal, resolucion_economica: "COLABORADOR", monto_empresa: 0, monto_colaborador: 100 });
    const movida = transicion(m, { accion }, 8).multa;
    expect(() => transicion(movida, { accion: "anular", motivo_anulacion: "Error" }, 8)).toThrow();
    expect(() => transicion(movida, { accion: "responsable", ...personal }, 8)).toThrow();
    expect(() => transicion(movida, { accion: "resolucion", resolucion_economica: "PENDIENTE" }, 8)).toThrow();
  });
  it("anulación exige motivo y es terminal", () => {
    const m = nuevaMulta(base);
    expect(() => transicion(m, { accion: "anular", motivo_anulacion: " " }, 1)).toThrow();
    const anulada = transicion(m, { accion: "anular", motivo_anulacion: "Duplicada" }, 1).multa;
    expect(anulada.anulada_por_usuario_id).toBe(1);
    expect(() => transicion(anulada, { accion: "datos", descripcion: "Otra" }, 1)).toThrow();
  });
});
