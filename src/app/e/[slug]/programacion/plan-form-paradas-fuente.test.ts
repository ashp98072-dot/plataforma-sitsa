import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-PARADAS-FUENTE — formulario: el destino se captura UNA vez (Paradas del viaje); la descripción distinta para el
 * reporte es una opción colapsada. Inspección de fuente (mismo criterio del repo para componentes sin harness).
 */
const form = readFileSync("src/app/e/[slug]/programacion/plan-form.tsx", "utf8").replace(/\r\n/g, "\n");

describe("plan-form — sin duplicidad de lugar de descarga", () => {
  it("ya no hay un campo siempre visible «Lugar de descarga (descripción operativa …)» arriba de las paradas", () => {
    expect(form).not.toContain("Lugar de descarga (descripción operativa");
    expect(form).not.toMatch(/<label[^>]*>\s*Lugar de descarga/);
  });
  it("la descripción distinta vive en un <details> colapsado por defecto (abierto solo si ya existe o la ruta la aporta)", () => {
    expect(form).toContain("Usar descripción distinta en el reporte (opcional)");
    expect(form).toContain("<details");
    expect(form).toContain("open={descReporteAbierta}");
    expect(form).toContain('useState(descripcionInicialReporte !== "")');
    expect(form).toContain('setDescReporteAbierta(plantilla.lugarDescargaHistorico !== "")');
  });
  it("la ayuda corta explica que las paradas definen carga/destinos y alimentan reportes y Portal del piloto", () => {
    expect(form).toContain("Las paradas definen el lugar de carga y los destinos del viaje.");
    expect(form).toContain("El primer punto de carga y la primera");
    expect(form).toContain("descarga/entrega se usan también en los reportes y el Portal del piloto.");
  });
  it("el valor inicial es solo la descripción DISTINTA; el PATCH compara contra ella (no contra el snapshot derivado)", () => {
    expect(form).toContain("const descripcionInicialReporte = descripcionReporteInicial(plan?.lugar_descarga_historico, plan?.paradas);");
    expect(form).toContain("lugarDescargaHistorico: descripcionInicialReporte,");
    expect(form).toContain("cambioTextoSnapshot(descripcionInicialReporte, form.lugarDescargaHistorico)");
  });
  it("el POST sigue mandando lugarDescargaHistorico solo cuando hay texto (el servidor deriva el resto de las paradas)", () => {
    expect(form).toContain("lugarDescargaHistorico: form.lugarDescargaHistorico.trim() || undefined,");
  });
  it("el resumen de cierre muestra el destino efectivo (descripción distinta o primera descarga)", () => {
    expect(form).toContain('<li>Destino: {form.lugarDescargaHistorico || descargaDeParadas(paradasForm) || "—"}</li>');
  });
  it("las paradas, sus tipos y su editor siguen intactos", () => {
    expect(form).toContain("Paradas del viaje");
    expect(form).toContain("+ Agregar parada");
  });
});

describe("servidor — fuente de verdad", () => {
  const route = readFileSync("src/app/api/empresas/[slug]/tms/planes/route.ts", "utf8").replace(/\r\n/g, "\n");
  it("POST y PATCH derivan el snapshot con la regla única resolverDescargaReporte (no confían en el frontend)", () => {
    expect(route).toContain('import { lugaresDesdeParadas, resolverDescargaReporte } from "@/lib/tms/plan-lugares";');
    expect((route.match(/resolverDescargaReporte\(/g) ?? []).length).toBe(2);
  });
  it("la lectura del estado actual y la escritura del snapshot ocurren en la transacción (conn), junto con las paradas", () => {
    const iUpdate = route.indexOf("const descargaReporte = resolverDescargaReporte({ override: overrideDescarga");
    const iTx = route.lastIndexOf("await conn.beginTransaction();", iUpdate);
    const iCommit = route.indexOf("await conn.commit();", iUpdate);
    expect(iTx).toBeGreaterThan(0);
    expect(iCommit).toBeGreaterThan(iUpdate);
    expect(route.slice(iTx, iUpdate)).toContain("conn.query<RowDataPacket[]>(");
  });
});
