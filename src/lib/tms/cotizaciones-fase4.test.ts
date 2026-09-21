import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crearRutaSchema } from "./rutas-validacion";
import { sugerirServicioRefrigerado } from "./cotizacion-defaults";

const leer = (p: string) => readFileSync(p, "utf8");

describe("Cotizaciones fase 4", () => {
  it("la ruta acepta el indicador habitual refrigerado sin alterar los demás contratos", () => {
    expect(crearRutaSchema.parse({ clienteId: 2, codigo: "R-000001", servicioRefrigeradoHabitual: true }).servicioRefrigeradoHabitual).toBe(true);
  });
  it("la sugerencia de ruta activa refrigeración pero nunca apaga una decisión manual", () => {
    expect(sugerirServicioRefrigerado(false, true)).toBe(true);
    expect(sugerirServicioRefrigerado(true, false)).toBe(true);
    expect(sugerirServicioRefrigerado(false, false)).toBe(false);
  });
  it("reutiliza los endpoints reales de Clientes y Rutas y mantiene ruta manual", () => {
    const ui = leer("src/components/tms/cotizacion-catalogos-rapidos.tsx");
    const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
    expect(ui).toContain("/clientes");
    expect(ui).toContain("/tms/rutas");
    expect(page).toContain("Usar sin guardar como ruta");
    expect(page).toContain("rutaId: null");
  });
  it("oculta altas según permisos reales y no inventa un catálogo paralelo", () => {
    const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
    const ui = leer("src/components/tms/cotizacion-catalogos-rapidos.tsx");
    expect(page).toContain('/api/auth/me');
    expect(ui).toContain("puedeCrearCliente ?");
    expect(ui).toContain("puedeCrearRuta ?");
    expect(ui).not.toContain("CREATE TABLE");
  });
  it("persiste refrigeración comercial separada del costeo", () => {
    const modelo = leer("src/lib/tms/cotizaciones.ts");
    const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
    const panel = leer("src/components/tms/cotizacion-costeo-panel.tsx");
    expect(modelo).toContain("servicio_refrigerado");
    expect(page).toContain("servicioRefrigerado={form.servicioRefrigerado}");
    expect(panel).toContain("Usar precio sugerido");
  });
  it("la migración es aditiva, idempotente y el preflight solo lee", () => {
    const migration = leer("sql/migrate-2026-09-cotizaciones-fase4.sql");
    const preflight = leer("sql/preflight-2026-09-cotizaciones-fase4.sql");
    expect(migration.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
    expect(migration).not.toMatch(/DROP|DELETE|UPDATE|INSERT/i);
    expect(preflight).toContain("SHOW COLUMNS FROM tms_cliente_rutas");
    expect(preflight).toContain("SHOW COLUMNS FROM tms_cotizaciones");
    expect(preflight).not.toMatch(/information_schema/i);
    expect(preflight).not.toMatch(/ALTER TABLE|DROP TABLE|DELETE FROM|UPDATE /i);
  });
});
