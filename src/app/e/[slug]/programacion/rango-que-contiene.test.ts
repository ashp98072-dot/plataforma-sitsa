import { describe, expect, it } from "vitest";
import { rangoQueContiene } from "./programacion-client";

/**
 * TMS-PROGRAMACION-NAVEGACION-DIRECTA-PLAN — cubre el núcleo puro de la
 * corrección: a qué período (Hoy/Mañana/Semana) debe cambiarse el filtro
 * para que un plan traído por id quede visible, o si ningún período
 * puede contenerlo (caso real del ticket: PLAN-20260901-005 con
 * fecha_plan 2026-09-01, visto desde "hoy" 2026-09-02 — fecha PASADA,
 * ninguno de los 3 períodos la cubre).
 */
describe("rangoQueContiene", () => {
  const HOY = "2026-09-02";

  it("Caso A del ticket: fecha_plan == hoy → 'hoy'", () => {
    expect(rangoQueContiene(HOY, "2026-09-02")).toBe("hoy");
  });

  it("fecha_plan == mañana → 'manana'", () => {
    expect(rangoQueContiene(HOY, "2026-09-03")).toBe("manana");
  });

  it("fecha_plan dentro de los próximos 7 días (pero no hoy/mañana) → 'semana'", () => {
    expect(rangoQueContiene(HOY, "2026-09-05")).toBe("semana");
    expect(rangoQueContiene(HOY, "2026-09-08")).toBe("semana"); // hoy + 6, límite inclusive
  });

  it("Caso B del ticket: fecha_plan FUERA de Hoy/Mañana/Semana (pasada) → null, no inventa un período", () => {
    // Caso real: PLAN-20260901-005, fecha_plan 2026-09-01, hoy 2026-09-02.
    expect(rangoQueContiene(HOY, "2026-09-01")).toBeNull();
    expect(rangoQueContiene(HOY, "2026-08-15")).toBeNull();
  });

  it("fecha_plan más allá de los próximos 7 días (futuro lejano) → null", () => {
    expect(rangoQueContiene(HOY, "2026-09-09")).toBeNull(); // hoy + 7, fuera del límite
    expect(rangoQueContiene(HOY, "2027-01-01")).toBeNull();
  });
});
