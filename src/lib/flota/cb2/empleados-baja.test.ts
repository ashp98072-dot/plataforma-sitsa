import { describe, expect, it } from "vitest";
import { identificarEmpleado, seleccionarEmpleado } from "./empleados-coincidencias";
import { etiquetaEmpleado, ventanaLaboral } from "./empleados-baja";
import { proponerNombre } from "./pilotos-nombres";
import { decisionesMasivas } from "@/components/flota/cb2/nombres-masivos";

const edgar = { id: 33, nombre: "Edgar Palala", estado: "Activo" };
const andres: { id: number; nombre: string; estado: string; fechaBaja: string | null; fechaAlta: string | null } = { id: 50, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja", fechaBaja: "2026-06-30", fechaAlta: "2024-01-10" };
describe("empleados activos y de baja en la revisión Shell", () => {
  it("Edgar Palala (activo) se reconoce solo y aparece como candidato seleccionable", () => {
    const m = identificarEmpleado("EDGAR PALALA", [edgar, andres]);
    expect(m.propuesta?.id).toBe(33); expect(m.metodo).toBe("EXACTA_NORMALIZADA");
    const r = proponerNombre("EDGAR PALALA", [edgar, andres]);
    expect(r.candidatos.map(c => c.id)).toEqual([33]); expect(r.propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 33, confirmado: false });
  });
  it("un empleado de baja es candidato pero nunca se vincula automáticamente", () => {
    const m = identificarEmpleado("Andres Taracena", [edgar, andres]);
    expect(m.candidatos.map(c => c.id)).toEqual([50]); expect(m.propuesta).toBeNull(); expect(m.estado).toBe("REQUIERE_CONFIRMACION_BAJA");
    expect(seleccionarEmpleado("Andres Taracena", [andres], undefined)).toEqual({ empleadoId: null, metodoEmpleado: "SIN_ASIGNACION" });
    expect(seleccionarEmpleado("Andres Taracena", [andres], 50)).toEqual({ empleadoId: 50, metodoEmpleado: "MANUAL" });
    const r = proponerNombre("Andres Norberto Taracena Mayen", [edgar, andres]);
    expect(r.candidatos.map(c => c.id)).toEqual([50]); expect(r.propuesta).toBeNull();
  });
  it("estados distintos de Activo/Baja siguen excluidos", () => {
    expect(identificarEmpleado("Andres Taracena", [{ ...andres, estado: "Inactivo" }]).estado).toBe("INEXISTENTE");
  });
  it("homónimo activo + baja = ambiguo: no hay autopropuesta", () => {
    const hom = { id: 51, nombre: "Edgar Palala", estado: "Baja", fechaBaja: "2025-01-01" };
    expect(identificarEmpleado("Edgar Palala", [edgar, hom]).estado).toBe("AMBIGUA");
    expect(proponerNombre("Edgar Palala", [edgar, hom]).propuesta).toBeNull();
  });
  it("ventana laboral: anterior, posterior, sin fecha de baja y sin fechas de consumo", () => {
    expect(ventanaLaboral(andres, { min: "2026-01-02", max: "2026-06-30" })).toBe("VALIDA");
    expect(ventanaLaboral(andres, { min: "2026-05-01", max: "2026-07-01" })).toBe("POSTERIOR_A_BAJA");
    expect(ventanaLaboral(andres, { min: "2023-12-01", max: "2024-02-01" })).toBe("ANTERIOR_A_ALTA");
    expect(ventanaLaboral({ ...andres, fechaBaja: null }, { min: "2026-01-01", max: "2026-01-02" })).toBe("SIN_FECHA_BAJA");
    expect(ventanaLaboral(andres, { min: null, max: null })).toBe("SIN_FECHA_CONSUMO");
    expect(ventanaLaboral(edgar, undefined)).toBe("ACTIVO");
  });
  it("acción masiva: baja solo con consumos anteriores o iguales a la baja; posteriores o sin fecha de baja quedan manuales; no crea reportado", () => {
    const mk = (rango: { min: string | null; max: string | null } | undefined, c = andres) => ({ clave: "A", originales: ["Andres Norberto Taracena Mayen"], filas: 3, rango, candidatos: [c], propuesta: null });
    expect(decisionesMasivas([mk({ min: "2026-01-01", max: "2026-06-30" })], {}).empleado).toHaveLength(1);
    expect(decisionesMasivas([mk({ min: "2026-01-01", max: "2026-07-01" })], {}).empleado).toHaveLength(0);
    expect(decisionesMasivas([mk({ min: "2026-01-01", max: "2026-02-01" }, { ...andres, fechaBaja: null })], {}).empleado).toHaveLength(0);
    expect(decisionesMasivas([mk(undefined)], {}).empleado).toHaveLength(0);
    expect(decisionesMasivas([mk({ min: "2026-07-01", max: "2026-07-02" })], {}).reportado).toHaveLength(0);
  });
  it("etiqueta con estado y fecha de baja", () => {
    expect(etiquetaEmpleado(andres)).toBe("Andrés Norberto Taracena Mayén · #50 · Baja (2026-06-30)");
    expect(etiquetaEmpleado(edgar)).toBe("Edgar Palala · #33");
  });
});
