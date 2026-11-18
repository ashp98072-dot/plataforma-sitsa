// Estado PENDIENTE / LISTO de vales Shell cuando el piloto se resuelve DESDE el vale (sin panel global).
import { describe, expect, it } from "vitest";
import { asignacionesExactas, pilotoShellResuelto, resumirRevision, revisionCandidatos } from "./preview-model";
import { causasAsignacion } from "./problemas-asignacion";
import { clavesListas, resumenPrevio } from "./resumen-previo";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";

const base: FilaCB2 = { perfil: "SHELL", hoja: "Octubre", fila: 2, candidato: "k1", bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "0001", placa: "C-570BZT", placaNormalizada: "C-570BZT", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", lote: "1", origen: { piloto: "  Andres Taracena ", producto: "Diesel" } } as unknown as FilaCB2;
const cat: CatalogosCB2 = { proveedores: [], vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }], empleados: [{ id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja" }] } as unknown as CatalogosCB2;
const dec = (extra: Partial<DecisionAsignacion> = {}): Record<string, DecisionAsignacion> => ({ k1: { exigirProducto: true, exigirPiloto: true, ...extra } });
const estado = (filas: FilaCB2[], c: CatalogosCB2, d: Record<string, DecisionAsignacion>) => {
  const sel = asignacionesExactas(filas, c);   // selección automática de unidad (solo con placa inequívoca)
  return revisionCandidatos(filas, c, sel, {}, {}, d)[0].estado;
};

describe("estado LISTO/PENDIENTE de vales Shell", () => {
  it("sin decisión de piloto → PENDIENTE (aunque la unidad y el combustible estén bien); la causa lo explica", () => {
    expect(estado([base], cat, dec({ pilotoTipo: "REPORTADO" }))).toBe("PENDIENTE");
    const g = revisionCandidatos([base], cat, asignacionesExactas([base], cat), {}, {}, dec())[0];
    expect(causasAsignacion(g, cat, dec()["k1"]).join(" ")).toContain("Falta resolver el piloto");
  });
  it("empleado ACTIVO o de BAJA reconocido (decisionNombre sin confirmar) → LISTO sin pasos adicionales", () => {
    for (const estadoEmp of ["Activo", "Baja"]) {
      const c = { ...cat, empleados: [{ id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: estadoEmp }] } as unknown as CatalogosCB2;
      expect(estado([base], c, dec({ pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: { tipo: "EMPLEADO", empleadoId: 110, confirmado: false } }))).toBe("LISTO");
    }
  });
  it("PENDIENTE → LISTO al confirmar el piloto reportado o elegir empleado desde el vale", () => {
    expect(estado([base], cat, dec({ pilotoTipo: "REPORTADO" }))).toBe("PENDIENTE");
    expect(estado([base], cat, dec({ pilotoTipo: "REPORTADO", decisionNombre: { tipo: "REPORTADO", confirmado: true } }))).toBe("LISTO");
    expect(estado([base], cat, dec({ pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: { tipo: "EMPLEADO", empleadoId: 110, confirmado: true } }))).toBe("LISTO");
  });
  it("piloto resuelto pero combustible sin clasificar sigue PENDIENTE (no basta elegir piloto)", () => {
    const f = { ...base, origen: { ...base.origen, producto: "20W50" } } as FilaCB2;
    const d = dec({ pilotoTipo: "REPORTADO", decisionNombre: { tipo: "REPORTADO", confirmado: true } });
    expect(estado([f], cat, d)).toBe("PENDIENTE");
    expect(estado([f], cat, { k1: { ...d.k1, productoClasificado: "NO_DETERMINADO" } })).toBe("LISTO");
  });
  it("piloto resuelto pero la placa coincide con dos unidades → PENDIENTE hasta elegir la unidad; elegirla lo pasa a LISTO", () => {
    const dos = { ...cat, vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }, { id: 2, placa: "P-570BZT", estado: "Activo" }] } as unknown as CatalogosCB2;
    const f = { ...base, placa: "570BZT", placaNormalizada: "570BZT" } as FilaCB2;
    const d = dec({ pilotoTipo: "REPORTADO", decisionNombre: { tipo: "REPORTADO", confirmado: true } });
    expect(asignacionesExactas([f], dos)).toEqual({});
    expect(revisionCandidatos([f], dos, {}, {}, {}, d)[0].estado).toBe("PENDIENTE");
    expect(revisionCandidatos([f], dos, { k1: "1" }, {}, {}, { k1: { ...d.k1, motivoUnidad: "Se verificó la unidad correcta con el proveedor" } })[0].estado).toBe("LISTO");
  });
  it("pilotoShellResuelto: HALEL no se ve afectado; Shell exige decisión o piloto externo explícito", () => {
    expect(pilotoShellResuelto([{ ...base, perfil: "HALEL" } as FilaCB2], {})).toBe(true);
    expect(pilotoShellResuelto([base], {})).toBe(false);
    expect(pilotoShellResuelto([base], { pilotoTipo: "EXTERNO" })).toBe(true);
  });
  it("coherencia con el resumen previo: las claves LISTAS son exactamente las de estado LISTO y el resumen cuadra", () => {
    const filas = [base, { ...base, candidato: "k2", vale: "0002", fila: 3, origen: { piloto: "Desconocido Visitante", producto: "Diesel" } } as FilaCB2];
    const d: Record<string, DecisionAsignacion> = { k1: dec({ pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: { tipo: "EMPLEADO", empleadoId: 110, confirmado: false } }).k1, k2: dec({ pilotoTipo: "REPORTADO" }).k1 };
    const sel = { k1: "1", k2: "1" }, r = resumirRevision(filas, cat, sel, {}, {}, d);
    const listas = clavesListas({ filas, cat, segura: r.segura, omitidos: {}, decisiones: d });
    expect([...listas]).toEqual(r.revision.filter(g => g.estado === "LISTO").map(g => g.clave));
    expect(r.revision.find(g => g.clave === "k2")!.estado).toBe("PENDIENTE");
    const res = resumenPrevio({ filas, cat, segura: r.segura, omitidos: {}, decisiones: d });
    expect(res).toMatchObject({ listas: 1, pendientes: 1, cuadra: true });
  });
});
