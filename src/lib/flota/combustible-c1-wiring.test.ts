import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { FLOTA_NAV, moduloEmpresaDelPermiso, permisosDefaultPorRol, tienePermiso } from "@/lib/permisos-shared";
import { CATALOGO_PERMISOS } from "@/lib/permisos-catalogo";
const leer = (path: string) => readFileSync(path, "utf8");
it("mueve un solo enlace a Operaciones y no amplía grants", () => {
  expect(FLOTA_NAV.some(n => n.sub === "flota_combustible")).toBe(false);
  expect(CATALOGO_PERMISOS.find(m => m.id === "flota_combustible")?.area).toBe("operaciones");
  expect(moduloEmpresaDelPermiso("flota_combustible")).toBe("tms");
  expect(tienePermiso(permisosDefaultPorRol("AuxiliarOperaciones"), "flota_combustible", "editar")).toBe(false);
  expect(leer("src/components/app-shell.tsx")).toContain('href: `${base}/combustibles`');
});
it("ruta antigua redirige en servidor sin duplicar panel", async () => {
  vi.doMock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
  vi.doMock("@/app/e/[slug]/flota/flota-page-client", () => ({ default: () => null }));
  const { default: Page } = await import("@/app/e/[slug]/flota/page");
  await expect(Page({ params: Promise.resolve({ slug: "uno" }), searchParams: Promise.resolve({ tab: "combustible" }) })).rejects.toThrow("REDIRECT:/e/uno/combustibles");
  expect(leer("src/app/e/[slug]/flota/flota-client.tsx")).not.toContain("<CombustibleRevisionPanel");
});
it("retira captura Portal sin tocar motor de viajes", () => {
  expect(leer("src/app/portal/viajes/viaje-form.tsx")).not.toContain("<CombustibleForm");
  const portal = leer("src/app/api/portal/viajes/[id]/combustible/route.ts");
  expect(portal).toContain("export async function GET"); expect(portal).toContain("status: 410");
});
it("servicio no escribe contabilidad/fondos ni modifica recursos de viajes", () => {
  const s = leer("src/lib/flota/combustible-staff.ts");
  expect(s).not.toMatch(/cont_eventos|cont_asientos|tms_solicitudes_fondo|GET_LOCK|UPDATE flota_viajes|tms_planes_viaje|tms_personal/);
});
it("requests combustible no ejecutan bootstrap DDL", () => {
  for (const p of ["route.ts", "resumen/route.ts", "conciliaciones/route.ts"]) {
    expect(leer(`src/app/api/empresas/[slug]/flota/combustible/${p}`)).not.toContain("asegurarSchemaFlota");
  }
});
it("migración no borra históricos ni agrega UNIQUE/Fondos", () => {
  const sql = leer("sql/migrate-2026-10-combustibles-c1.sql").replace(/--[^\n]*/g, "");
  expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|UNIQUE)\b/i);
  expect(sql).toContain("MODIFY COLUMN viaje_id INT NULL");
  expect(sql).not.toContain("solicitud_fondos_id");
});
