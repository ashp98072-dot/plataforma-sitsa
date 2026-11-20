// Guardar un vale Shell SIN vincular la unidad (placa ambigua o sin unidad en Flota): estado LISTO por defecto, sin crear vehículos, y solo con la migración instalada.
import { describe, expect, it } from "vitest";
import { asignacionesExactas, revisionCandidatos } from "./preview-model";
import { seleccionShell } from "./seleccion-shell";
import { claseUnidadShell, vinculoPorDefecto } from "./unidad-shell";
import { seleccion as seleccionSchema } from "@/lib/flota/cb2/model";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";

const K = "a".repeat(64);
const fila = (placa: string, extra: Record<string, unknown> = {}, piloto = "Visitante Sin Registro", producto = "Diesel") => ({ perfil: "SHELL", hoja: "Octubre", fila: 2, candidato: K, bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "0001", placa, placaNormalizada: placa, fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", lote: "1", origen: { piloto, producto }, ...extra }) as unknown as FilaCB2;
const cat = (extra: Record<string, unknown> = {}) => ({ proveedores: [], pilotosReportados: true, vinculoUnidad: true, empleados: [{ id: 9901, nombre: "Rene Baja Vinculo", estado: "Baja" }],
  vehiculos: [{ id: 1, placa: "C-591LAB", estado: "Activo" }, { id: 2, placa: "C 591LAB", estado: "Activo" }, { id: 3, placa: "C-592LAB", estado: "Activo" }, { id: 4, placa: "C-595LAB", estado: "En taller" }], ...extra }) as unknown as CatalogosCB2;
const reportado: DecisionAsignacion = { exigirProducto: true, exigirPiloto: true, pilotoTipo: "REPORTADO", empleadoId: null, decisionNombre: { tipo: "REPORTADO", confirmado: true } };
const estado = (f: FilaCB2, c: CatalogosCB2, d: DecisionAsignacion = reportado) => { const sel = asignacionesExactas([f], c); return { sel, g: revisionCandidatos([f], c, sel, {}, {}, { [K]: d })[0] }; };

describe("unidad sin vincular (Shell, migración instalada)", () => {
  it("placa AMBIGUA entre dos unidades de Flota: se guarda sin elegir ninguna → LISTO, con la identidad marcada AMBIGUA", () => {
    const f = fila("C-591LAB"), r = estado(f, cat());
    expect(vinculoPorDefecto(f, cat())).toBe("AMBIGUA"); expect(r.sel).toEqual({ [K]: "0" }); expect(r.g.estado).toBe("LISTO");
    expect(claseUnidadShell(f, cat(), "0")).toMatchObject({ clase: "SIN_VINCULAR" }); expect(claseUnidadShell(f, cat(), "0").mensaje).toContain("AMBIGUA");
    expect(seleccionShell(f, cat(), reportado, 0)).toMatchObject({ vinculoUnidad: "AMBIGUA", empleadoId: null });
  });
  it("placa SIN unidad en Flota (también la de una unidad en taller): se guarda sin vincular y sin crear nada", () => {
    for (const placa of ["C-593LAB", "C-595LAB", "CANECA 7"]) {
      const f = fila(placa), r = estado(f, cat());
      expect(vinculoPorDefecto(f, cat()), placa).toBe("SIN_VINCULO"); expect(r.sel, placa).toEqual({ [K]: "0" }); expect(r.g.estado, placa).toBe("LISTO");
    }
    expect(claseUnidadShell(fila("C-593LAB"), cat(), "0").mensaje).toContain("sin crear ningún vehículo");
  });
  it("una única unidad de Flota (o una identidad externa registrada) NO se deja sin vincular: se vincula", () => {
    expect(vinculoPorDefecto(fila("C-592LAB"), cat())).toBeNull();
    expect(estado(fila("C-592LAB"), cat()).sel).toEqual({ [K]: String(3) });
    const conExterna = cat({ vehiculos: [...(cat().vehiculos), { id: -7, placa: "M777LAB" }], unidadesExternas: [{ id: 7, placa: "M777LAB", referencia: "r", tipo: "MOTOCICLETA", descripcion: "d" }] });
    expect(vinculoPorDefecto(fila("M777LAB"), conExterna)).toBeNull();
  });
  it("sin la migración instalada (o fuera de Shell) el comportamiento anterior no cambia: la unidad sigue pendiente", () => {
    const sinMigracion = cat({ vinculoUnidad: false });
    expect(vinculoPorDefecto(fila("C-591LAB"), sinMigracion)).toBeNull(); const r = estado(fila("C-591LAB"), sinMigracion); expect(r.sel).toEqual({}); expect(r.g.estado).toBe("PENDIENTE");
    expect(vinculoPorDefecto(fila("C-591LAB", { perfil: "HALEL" }), cat())).toBeNull();
    // un "0" enviado a mano nunca valida sin la migración
    expect(revisionCandidatos([fila("C-593LAB")], sinMigracion, { [K]: "0" }, {}, {}, { [K]: reportado })[0].estado).toBe("PENDIENTE");
  });
  it("el estado LISTO sigue exigiendo piloto resuelto y combustible clasificado; un piloto tercerizado exige una unidad", () => {
    const f = fila("C-593LAB");
    expect(estado(f, cat(), { ...reportado, decisionNombre: undefined }).g.estado).toBe("PENDIENTE");                          // piloto sin resolver
    expect(estado(fila("C-593LAB", {}, "X Y", "20W50"), cat()).g.estado).toBe("PENDIENTE");                                    // combustible sin clasificar
    expect(estado(fila("C-593LAB", {}, "X Y", "20W50"), cat(), { ...reportado, productoClasificado: "NO_DETERMINADO" }).g.estado).toBe("LISTO");
    expect(estado(f, cat(), { exigirProducto: true, exigirPiloto: true, pilotoTipo: "EXTERNO", pilotoExternoId: 5 }).g.estado).toBe("PENDIENTE");
  });
  it("empleado de baja reconocido + placa ambigua → LISTO y el empleado se conserva", () => {
    const d: DecisionAsignacion = { exigirProducto: true, exigirPiloto: true, pilotoTipo: "INTERNO", empleadoId: 9901, decisionNombre: { tipo: "EMPLEADO", empleadoId: 9901, confirmado: false } };
    const f = fila("C-591LAB", {}, "Rene Baja");
    expect(estado(f, cat(), d).g.estado).toBe("LISTO"); expect(seleccionShell(f, cat(), d, 0)).toMatchObject({ vinculoUnidad: "AMBIGUA", empleadoId: 9901, metodoEmpleado: "MANUAL" });
  });
  it("esquema de la solicitud: vehiculoId 0 solo con vinculoUnidad (y sin identidades de piloto externo)", () => {
    const base = { candidato: K, productoClasificado: "DIESEL" as const };
    expect(seleccionSchema.safeParse([{ ...base, vehiculoId: 0, vinculoUnidad: "AMBIGUA" }]).success).toBe(true);
    expect(seleccionSchema.safeParse([{ ...base, vehiculoId: 0 }]).success).toBe(false);
    expect(seleccionSchema.safeParse([{ ...base, vehiculoId: 5, vinculoUnidad: "SIN_VINCULO" }]).success).toBe(false);
    expect(seleccionSchema.safeParse([{ ...base, vehiculoId: 0, vinculoUnidad: "SIN_VINCULO", pilotoTipo: "EXTERNO", pilotoExternoId: 3 }]).success).toBe(false);
    expect(seleccionSchema.safeParse([{ ...base, vehiculoId: 0, vinculoUnidad: "SIN_VINCULO", empleadoId: 9901, metodoEmpleado: "MANUAL" }]).success).toBe(true);
    expect(seleccionSchema.safeParse([{ ...base, vehiculoId: 0, vinculoUnidad: "OTRO" }]).success).toBe(false);
  });
});
