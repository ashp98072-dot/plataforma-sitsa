import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const planes = readFileSync(resolve(process.cwd(), "src/app/api/empresas/[slug]/tms/planes/route.ts"), "utf8");
const rutas = readFileSync(resolve(process.cwd(), "src/lib/tms/cliente-rutas.ts"), "utf8");

describe("snapshot de defaults de ruta al crear un plan", () => {
  it("persiste tarifa y piloto en la cabecera histórica del plan", () => {
    expect(planes).toContain("tarifa_comercial");
    expect(planes).toContain("piloto_id");
    expect(planes).toContain("d.tarifaComercial ?? null");
    expect(planes).toContain("pilotoId");
  });

  it("persiste auxiliares y viáticos dentro de la transacción del plan", () => {
    const begin = planes.indexOf("await conn.beginTransaction()");
    const auxiliares = planes.indexOf("await guardarAuxiliaresPlan(planId, auxPersonalIds, conn", begin);
    const viaticos = planes.indexOf("await sincronizarViaticosPlan(", begin);
    const commit = planes.indexOf("await conn.commit()", begin);
    expect(begin).toBeGreaterThan(-1);
    expect(auxiliares).toBeGreaterThan(begin);
    expect(viaticos).toBeGreaterThan(auxiliares);
    expect(commit).toBeGreaterThan(viaticos);
  });

  it("actualizar defaults solo toca la plantilla y no actualiza planes históricos", () => {
    expect(rutas).not.toMatch(/UPDATE\s+tms_planes_viaje/i);
    expect(rutas).not.toMatch(/UPDATE\s+tms_plan_auxiliares/i);
    expect(rutas).not.toMatch(/UPDATE\s+tms_viaticos/i);
  });
});
