import { describe, expect, it, vi } from "vitest";
import {
  compararTarifa, comparacionRequiereAviso, diagnosticarBloqueos, motivosDeFila, registrarDiagnosticoBloqueo, resumenComparacionesTarifa, sugerenciaDeDiagnostico,
} from "./programacion-copia-diagnostico";
import type { ResultadoFilaLote } from "./programacion-lote";

const err = (fila: number, errores: string[], extra: Partial<ResultadoFilaLote> = {}): ResultadoFilaLote => ({ fila, estado: "error", errores, tarifa: null, ...extra });
const ok = (fila: number): ResultadoFilaLote => ({ fila, estado: "ok", errores: [], tarifa: null });

describe("motivosDeFila", () => {
  it("clasifica por datos estructurados y por mensaje conocido, sin duplicar", () => {
    expect(motivosDeFila({ errores: ["x de este mismo lote."], conflictos: [{ recurso: "persona", filas: [2], causa: "dia_completo" }] })).toEqual(["hora_o_regreso_ausente"]);
    expect(motivosDeFila({ errores: ["x de este mismo lote."], conflictos: [{ recurso: "unidad", filas: [2], causa: "solape" }] })).toEqual(["solape_real"]);
    expect(motivosDeFila({ errores: ["Unidad P-1: Conflicto de identidad TMS: revisar los vínculos existentes; no se reescriben planes históricos."] })).toEqual(["identidad_unidad"]);
    expect(motivosDeFila({ errores: ["La tarifa seleccionada no es una tarifa vigente de esta ruta."] })).toEqual(["tarifa"]);
    expect(motivosDeFila({ errores: ["Juan está asignado a otro viaje de ese día."] })).toEqual(["disponibilidad"]);
    expect(motivosDeFila({ errores: ["La ruta \"1001\" está inactiva."] })).toEqual(["otro"]);
  });
  it("una fila con choque Y otro motivo cuenta ambos", () => {
    const m = motivosDeFila({ errores: ["La unidad X está asignada también en la fila 2 de este mismo lote. Los horarios se solapan.", "La tarifa seleccionada no es una tarifa vigente de esta ruta."], conflictos: [{ recurso: "unidad", filas: [2], causa: "solape" }] });
    expect(m.sort()).toEqual(["solape_real", "tarifa"]);
  });
});

describe("diagnosticarBloqueos / sugerencia", () => {
  it("cuenta, ordena los orígenes por alcance y es robusto ante nulos", () => {
    const filas = [
      err(1, ["a"], { diagnostico: { horaInvalida: false, regresoInvalido: true, filasAfectadas: [2, 3], recursosCompartidos: ["personal"] }, conflictos: [{ recurso: "persona", filas: [2, 3], causa: "dia_completo" }] }),
      err(2, ["a"], { derivada: { origenes: [1, 4] }, conflictos: [{ recurso: "persona", filas: [1], causa: "dia_completo" }] }),
      err(3, ["a"], { derivada: { origenes: [1] }, conflictos: [{ recurso: "persona", filas: [1], causa: "dia_completo" }] }),
      err(4, ["a"], { diagnostico: { horaInvalida: true, regresoInvalido: false, filasAfectadas: [2], recursosCompartidos: ["personal"] }, conflictos: [{ recurso: "persona", filas: [2], causa: "dia_completo" }] }),
      ok(5), null, undefined,
    ];
    const d = diagnosticarBloqueos(filas);
    expect(d).toMatchObject({ total: 5, bloqueadas: 4, derivadas: 2 });
    expect(d.origenes).toEqual([{ fila: 1, falta: "regreso", afecta: 2 }, { fila: 4, falta: "hora", afecta: 1 }]);
    expect(sugerenciaDeDiagnostico(d)).toMatch(/2 filas sin hora o regreso válido.*fila 1/);
  });
  it("una sola fila origen → mensaje específico; sin orígenes → null", () => {
    const d = diagnosticarBloqueos([err(7, ["a"], { diagnostico: { horaInvalida: true, regresoInvalido: true, filasAfectadas: [1], recursosCompartidos: ["personal"] } }), err(1, ["a"], { derivada: { origenes: [7] } })]);
    expect(sugerenciaDeDiagnostico(d)).toBe("La fila 7 está sin hora de carga ni regreso estimado y reserva todo el día: bloquea a 1 fila. Corrígela para liberar 1 fila.");
    expect(sugerenciaDeDiagnostico(diagnosticarBloqueos([err(1, ["La ruta está inactiva."])]))).toBeNull();
  });
  it("la bitácora recibe SOLO conteos y números de fila (sin textos de error)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    registrarDiagnosticoBloqueo(diagnosticarBloqueos([err(1, ["Juan Pérez está asignado en P-1"], { diagnostico: { horaInvalida: false, regresoInvalido: true, filasAfectadas: [2], recursosCompartidos: ["personal"] } })]));
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(info.mock.calls[0])).not.toMatch(/Juan|P-1|asignado/);
    info.mockClear();
    registrarDiagnosticoBloqueo(diagnosticarBloqueos([ok(1)]));
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});

describe("compararTarifa: valor del origen vs el que REALMENTE se usará en destino", () => {
  const dest = { id: 100, nombre: "Base", monto: 1500, moneda: "GTQ" };
  it("igual: mismo monto y moneda (tolerancia de centavos redondeados)", () => {
    expect(compararTarifa({ nombre: "Base", monto: 1500, moneda: "GTQ" }, dest).estado).toBe("igual");
    expect(compararTarifa({ nombre: "Base", monto: 1500.004, moneda: "GTQ" }, dest).estado).toBe("igual");
    expect(compararTarifa({ nombre: "Base", monto: 1500, moneda: null }, dest).estado).toBe("igual");
  });
  it("distinta: otro monto (con diferencia firmada) o distinta moneda (sin diferencia numérica)", () => {
    expect(compararTarifa({ nombre: "Base", monto: 1200, moneda: "GTQ" }, dest)).toMatchObject({ estado: "distinta", diferencia: 300 });
    expect(compararTarifa({ nombre: "Base", monto: 1800, moneda: "GTQ" }, dest)).toMatchObject({ estado: "distinta", diferencia: -300 });
    expect(compararTarifa({ nombre: "Base", monto: 1500, moneda: "USD" }, dest)).toMatchObject({ estado: "distinta", diferencia: null });
    expect(compararTarifa({ nombre: "Base", monto: null, moneda: "GTQ" }, dest).estado).toBe("asignada");   // un origen sin monto equivale a «sin tarifa»
  });
  it("asignada (el origen no tenía) y perdida (el destino no tiene) también requieren aviso; sin tarifa en ambos no", () => {
    expect(compararTarifa(null, dest).estado).toBe("asignada");
    expect(compararTarifa({ nombre: null, monto: null, moneda: null }, dest).estado).toBe("asignada");
    expect(compararTarifa({ nombre: "Vieja", monto: 900, moneda: "GTQ" }, null).estado).toBe("perdida");
    expect(compararTarifa(null, null).estado).toBe("sin_tarifa");
    expect(["distinta", "asignada", "perdida"].every((e) => comparacionRequiereAviso({ estado: e } as never))).toBe(true);
    expect(comparacionRequiereAviso({ estado: "igual" } as never)).toBe(false);
    expect(comparacionRequiereAviso({ estado: "sin_tarifa" })).toBe(false);
  });
  it("resumen: cuenta solo las filas con aviso", () => {
    const r = resumenComparacionesTarifa([{ fila: 1, comparacion: compararTarifa({ nombre: "B", monto: 1500, moneda: "GTQ" }, dest) }, { fila: 2, comparacion: compararTarifa({ nombre: "B", monto: 1, moneda: "GTQ" }, dest) }, { fila: 3, comparacion: compararTarifa(null, null) }]);
    expect(r).toEqual({ conAviso: 1, filas: [2] });
  });
});
