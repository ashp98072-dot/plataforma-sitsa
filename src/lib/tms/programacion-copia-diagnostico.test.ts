import { describe, expect, it, vi } from "vitest";
import {
  compararTarifa, comparacionRequiereAviso, diagnosticarBloqueos, motivosDeFila, registrarDiagnosticoBloqueo, resumenComparacionesTarifa, sugerenciaDeDiagnostico,
} from "./programacion-copia-diagnostico";
import type { ResultadoFilaLote } from "./programacion-lote";

const err = (fila: number, errores: string[], extra: Partial<ResultadoFilaLote> = {}): ResultadoFilaLote => ({ fila, estado: "error", errores, tarifa: null, ...extra });
const ok = (fila: number, extra: Partial<ResultadoFilaLote> = {}): ResultadoFilaLote => ({ fila, estado: "ok", errores: [], tarifa: null, ...extra });

describe("motivosDeFila", () => {
  it("clasifica por datos estructurados y por mensaje conocido, sin duplicar; los conflictos por día completo NO son un motivo de bloqueo", () => {
    expect(motivosDeFila({ errores: ["x de este mismo lote. Los horarios se solapan."], conflictos: [{ recurso: "unidad", filas: [2], causa: "solape" }] })).toEqual(["solape_real"]);
    expect(motivosDeFila({ errores: [], conflictos: [{ recurso: "persona", filas: [2], causa: "dia_completo" }] })).toEqual([]);
    expect(motivosDeFila({ errores: ["Unidad P-1: Conflicto de identidad TMS: revisar los vínculos existentes; no se reescriben planes históricos."] })).toEqual(["identidad_unidad"]);
    expect(motivosDeFila({ errores: ["La tarifa seleccionada no es una tarifa vigente de esta ruta."] })).toEqual(["tarifa"]);
    expect(motivosDeFila({ errores: ["La unidad P-1 no está disponible: En taller."] })).toEqual(["disponibilidad"]);
    expect(motivosDeFila({ errores: ["La ruta \"1001\" está inactiva."] })).toEqual(["otro"]);
  });
  it("una fila con solape real Y otro motivo cuenta ambos", () => {
    const m = motivosDeFila({ errores: ["La unidad X está asignada también en la fila 2 de este mismo lote. Los horarios se solapan.", "La tarifa seleccionada no es una tarifa vigente de esta ruta."], conflictos: [{ recurso: "unidad", filas: [2], causa: "solape" }] });
    expect(m.sort()).toEqual(["solape_real", "tarifa"]);
  });
});

describe("diagnosticarBloqueos / sugerencia", () => {
  const origen = (fila: number, falta: "hora" | "regreso" | "hora_y_regreso", afecta: number[]) => ({ horaInvalida: falta !== "regreso", regresoInvalido: falta !== "hora", filasAfectadas: afecta, recursosCompartidos: ["personal"] });
  const aviso = (tipo: "ventana_incompleta" | "destino_ocupado", filas?: number[]) => ({ tipo, recurso: { tipo: "persona", id: "1" }, mensaje: "x", ...(filas ? { filas } : {}) });
  it("separa lo que BLOQUEA de lo que solo AVISA, cuenta por tipo y ordena los orígenes por alcance; robusto ante nulos", () => {
    const filas = [
      ok(1, { diagnostico: origen(1, "regreso", [2, 3]), avisos: [aviso("ventana_incompleta", [2, 3])] }),
      ok(2, { avisos: [aviso("ventana_incompleta", [1]), aviso("destino_ocupado")] }),
      ok(3, { avisos: [aviso("ventana_incompleta", [1])] }),
      ok(4, { diagnostico: origen(4, "hora", [2]) }),
      err(5, ["La tarifa seleccionada no es una tarifa vigente de esta ruta."]),
      ok(6), null, undefined,
    ];
    const d = diagnosticarBloqueos(filas);
    expect(d).toMatchObject({ total: 6, bloqueadas: 1, conAvisos: 3, avisosPorTipo: { ventana_incompleta: 3, destino_ocupado: 1 } });
    expect(d.porMotivo.tarifa).toBe(1);
    expect(d.origenes).toEqual([{ fila: 1, falta: "regreso", afecta: 2 }, { fila: 4, falta: "hora", afecta: 1 }]);
    expect(sugerenciaDeDiagnostico(d)).toMatch(/2 filas sin hora o regreso válido.*se copian igual que el origen.*fila 1/);
  });
  it("una sola fila origen → mensaje específico; sin orígenes → null", () => {
    const d = diagnosticarBloqueos([ok(7, { diagnostico: origen(7, "hora_y_regreso", [1]) }), ok(1)]);
    expect(sugerenciaDeDiagnostico(d)).toBe("La fila 7 está sin hora de carga ni regreso estimado y reserva todo el día: comparte recursos con 1 fila. Se copia igual que el origen; puedes darle un regreso si quieres evitar el aviso.");
    expect(sugerenciaDeDiagnostico(diagnosticarBloqueos([err(1, ["La ruta está inactiva."])]))).toBeNull();
  });
  it("la bitácora recibe SOLO conteos y números de fila (sin textos de error) y se registra con bloqueos o con avisos", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    registrarDiagnosticoBloqueo(diagnosticarBloqueos([ok(1, { diagnostico: origen(1, "regreso", [2]), avisos: [{ tipo: "ventana_incompleta", recurso: { tipo: "persona", id: "1" }, mensaje: "Juan Pérez está asignado en P-1", filas: [2] }] })]));
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
