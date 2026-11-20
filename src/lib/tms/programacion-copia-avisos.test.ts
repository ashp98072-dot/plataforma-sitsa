import { describe, expect, it } from "vitest";
import { HUELLA_RE, huellaAvisosCopia } from "./programacion-copia-avisos";
import type { AvisoLote } from "./programacion-lote";

const ctx = { empresaId: 7, fechaOrigen: "2026-11-19", fechaDestino: "2026-11-20" };
const aviso = (over: Partial<AvisoLote> = {}): AvisoLote => ({ tipo: "ventana_incompleta", recurso: { tipo: "persona", id: "1" }, filas: [2, 3], mensaje: "texto de presentación", ...over });
const h = (filas: { fila: number; avisos?: AvisoLote[] }[], c = ctx) => huellaAvisosCopia(c, filas);

describe("huellaAvisosCopia — solo datos estructurados, nunca el texto de presentación", () => {
  it("sin avisos no hay nada que aceptar (cadena vacía); con avisos es un SHA-256 hex de 64 caracteres", () => {
    expect(h([])).toBe("");
    expect(h([{ fila: 1 }, { fila: 2, avisos: [] }])).toBe("");
    expect(h([{ fila: 1, avisos: [aviso()] }])).toMatch(HUELLA_RE);
  });
  it("el TEXTO del mensaje no influye (cambiar la redacción no invalida la aceptación)", () => {
    expect(h([{ fila: 1, avisos: [aviso({ mensaje: "otra redacción" })] }])).toBe(h([{ fila: 1, avisos: [aviso()] }]));
  });
  it("no depende del orden de las filas, de los avisos ni de las filas relacionadas", () => {
    const a = [{ fila: 1, avisos: [aviso({ filas: [3, 2] }), aviso({ tipo: "destino_ocupado", recurso: { tipo: "unidad", id: "9" }, filas: undefined, ocupadoPor: { planId: 50 } })] }, { fila: 2, avisos: [aviso({ filas: [1] })] }];
    const b = [{ fila: 2, avisos: [aviso({ filas: [1] })] }, { fila: 1, avisos: [aviso({ tipo: "destino_ocupado", recurso: { tipo: "unidad", id: "9" }, filas: undefined, ocupadoPor: { planId: 50 } }), aviso({ filas: [2, 3] })] }];
    expect(h(a)).toBe(h(b));
  });
  it.each([
    ["el tipo de aviso", aviso({ tipo: "destino_ocupado" })],
    ["el TIPO de recurso afectado", aviso({ recurso: { tipo: "unidad", id: "1" } })],
    ["el ID del recurso afectado", aviso({ recurso: { tipo: "persona", id: "2" } })],
    ["las FILAS relacionadas", aviso({ filas: [2, 3, 4] })],
    ["el VIAJE que lo ocupa", aviso({ ocupadoPor: { planId: 50 } })],
  ])("cambia si cambia %s", (_n, otro) => {
    expect(h([{ fila: 1, avisos: [otro] }])).not.toBe(h([{ fila: 1, avisos: [aviso()] }]));
  });
  it("cambia si cambia el viaje que ocupa el recurso (50 → 51) manteniendo todo lo demás", () => {
    const a = aviso({ tipo: "destino_ocupado", filas: undefined, ocupadoPor: { planId: 50 } });
    expect(h([{ fila: 1, avisos: [a] }])).not.toBe(h([{ fila: 1, avisos: [{ ...a, ocupadoPor: { planId: 51 } }] }]));
  });
  it("cambia si el aviso pasa a OTRA fila, si aparece uno nuevo o si desaparece uno", () => {
    const base = h([{ fila: 1, avisos: [aviso()] }]);
    expect(h([{ fila: 2, avisos: [aviso()] }])).not.toBe(base);
    expect(h([{ fila: 1, avisos: [aviso()] }, { fila: 2, avisos: [aviso()] }])).not.toBe(base);
    expect(h([{ fila: 1, avisos: [aviso(), aviso({ recurso: { tipo: "tc", id: "31" } })] }])).not.toBe(base);
  });
  it("está ligada al contexto: empresa y fechas distintas dan otra huella (no se reutiliza entre copias)", () => {
    const f = [{ fila: 1, avisos: [aviso()] }];
    expect(h(f, { ...ctx, empresaId: 8 })).not.toBe(h(f));
    expect(h(f, { ...ctx, fechaDestino: "2026-11-21" })).not.toBe(h(f));
    expect(h(f, { ...ctx, fechaOrigen: "2026-11-18" })).not.toBe(h(f));
  });
  it("es determinista", () => {
    const f = [{ fila: 1, avisos: [aviso()] }];
    expect(h(f)).toBe(h(f));
  });
});
