// Estado PENDIENTE / LISTO de vales Shell cuando el piloto se resuelve DESDE el vale (sin panel global).
import { describe, expect, it } from "vitest";
import { asignacionesExactas, pilotoShellResuelto, resumirRevision, revisionCandidatos } from "./preview-model";
import { causasAsignacion } from "./problemas-asignacion";
import { clavesListas, resumenPrevio } from "./resumen-previo";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";

const base: FilaCB2 = { perfil: "SHELL", hoja: "Octubre", fila: 2, candidato: "k1", bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "0001", placa: "C-570BZT", placaNormalizada: "C-570BZT", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", lote: "1", origen: { piloto: "  Andres Taracena ", producto: "Diesel" } } as unknown as FilaCB2;
const cat: CatalogosCB2 = { proveedores: [], pilotosReportados: true, vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }], empleados: [{ id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja" }] } as unknown as CatalogosCB2;
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
  it("pilotoShellResuelto: HALEL no se ve afectado; Shell exige una decisión coherente", () => {
    expect(pilotoShellResuelto([{ ...base, perfil: "HALEL" } as FilaCB2], {}, cat)).toBe(true);
    expect(pilotoShellResuelto([base], {}, cat)).toBe(false);
    expect(pilotoShellResuelto([base], undefined, cat)).toBe(false);
  });
  it("decisiones INCONSISTENTES no cuentan como piloto resuelto (tipo, ID, empleado, externo, registro no instalado)", () => {
    const emp = { tipo: "EMPLEADO" as const, empleadoId: 110, confirmado: true }, rep = { tipo: "REPORTADO" as const, confirmado: true };
    const ok = (d: DecisionAsignacion, c: CatalogosCB2 = cat) => pilotoShellResuelto([base], d, c);
    expect(ok({ pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: emp })).toBe(true);
    expect(ok({ pilotoTipo: "INTERNO", empleadoId: 999, decisionNombre: emp })).toBe(false);          // ID del vale distinto del de la decisión
    expect(ok({ pilotoTipo: "REPORTADO", empleadoId: 110, decisionNombre: emp })).toBe(false);        // tipo ≠ decisión
    expect(ok({ pilotoTipo: "INTERNO", empleadoId: null, decisionNombre: emp })).toBe(false);
    expect(ok({ pilotoTipo: "INTERNO", empleadoId: 110, pilotoExternoId: 5, decisionNombre: emp })).toBe(false);   // mezcla empleado + externo
    expect(ok({ pilotoTipo: "INTERNO", empleadoId: 777, decisionNombre: { ...emp, empleadoId: 777 } })).toBe(false); // empleado ajeno al catálogo de la empresa
    expect(ok({ pilotoTipo: "REPORTADO", decisionNombre: rep })).toBe(true);
    expect(ok({ pilotoTipo: "INTERNO", decisionNombre: rep })).toBe(false);
    expect(ok({ pilotoTipo: "REPORTADO", empleadoId: 110, decisionNombre: rep })).toBe(false);
    expect(ok({ pilotoTipo: "REPORTADO", decisionNombre: rep }, { ...cat, pilotosReportados: false } as CatalogosCB2)).toBe(false);   // registro no instalado: el servidor no podría guardarlo
    expect(ok({ pilotoTipo: "REPORTADO", decisionNombre: { tipo: "REPORTADO", confirmado: false } })).toBe(false);   // sin confirmar y sin identidad previa
  });
  it("reconocimiento automático correcto vs propuesta que el motor no respalda", () => {
    const auto = { tipo: "EMPLEADO" as const, empleadoId: 110, confirmado: false };
    expect(pilotoShellResuelto([base], { pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: auto }, cat)).toBe(true);   // «Andres Taracena» → #110 (baja), único
    const otro = { ...cat, empleados: [...(cat.empleados ?? []), { id: 111, nombre: "Andrés Taracena López", estado: "Activo" }] } as unknown as CatalogosCB2;
    expect(pilotoShellResuelto([base], { pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: auto }, otro)).toBe(false);   // ahora es ambiguo: la propuesta sin confirmar ya no vale
    expect(pilotoShellResuelto([base], { pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: { ...auto, confirmado: true } }, otro)).toBe(true);   // confirmada manualmente sí
    const ajeno = { ...base, origen: { piloto: "Otra Persona", producto: "Diesel" } } as unknown as FilaCB2;
    expect(pilotoShellResuelto([ajeno], { pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: auto }, cat)).toBe(false);   // el motor no reconoce a #110 para ese nombre
  });
  it("reportado previamente registrado (reportadoId) vale solo si hoy no hay empleado identificable", () => {
    const previo = { tipo: "REPORTADO" as const, reportadoId: 9, confirmado: false };
    const visitante = { ...base, origen: { piloto: "Visitante Nuevo", producto: "Diesel" } } as unknown as FilaCB2;
    expect(pilotoShellResuelto([visitante], { pilotoTipo: "REPORTADO", decisionNombre: previo }, cat)).toBe(true);
    expect(pilotoShellResuelto([base], { pilotoTipo: "REPORTADO", decisionNombre: previo }, cat)).toBe(false);   // «Andres Taracena» identifica a un empleado: hay que revisar
  });
  it("EXTERNO: exige identidad real del catálogo bajo identidades independientes; el tipo por sí solo no basta", () => {
    const ind = { ...cat, tercerosDirectos: true, identidadesIndependientes: true, pilotosExternos: [{ id: 5, nombre: "Piloto Externo", referencia: "R" }] } as unknown as CatalogosCB2;
    const f = { ...base, origen: { piloto: "Piloto Externo", producto: "Diesel" } } as unknown as FilaCB2;
    expect(pilotoShellResuelto([f], { pilotoTipo: "EXTERNO" }, ind)).toBe(false);                                   // sin identidad
    expect(pilotoShellResuelto([f], { pilotoTipo: "EXTERNO", pilotoExternoId: 99 }, ind)).toBe(false);              // ID inexistente en la empresa
    expect(pilotoShellResuelto([f], { pilotoTipo: "EXTERNO", pilotoExternoId: 5 }, cat)).toBe(false);               // identidades independientes no activas
    expect(pilotoShellResuelto([f], { pilotoTipo: "EXTERNO", pilotoExternoId: 5, empleadoId: 110 }, ind)).toBe(false);   // empleado y externo a la vez
    expect(pilotoShellResuelto([f], { pilotoTipo: "EXTERNO", pilotoExternoId: 5 }, ind)).toBe(true);
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
