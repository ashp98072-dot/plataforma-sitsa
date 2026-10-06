import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tieneAccionCatalogo } from "@/lib/permisos-catalogo";

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — panel de administración (3 estados por rol: Sin habilitar/
 * Habilitado/En capacitación), integrado en el área TMS existente (tms/page.tsx), sin tocar RRHH.
 * Inspección de fuente, mismo criterio del repo para componentes sin harness de pruebas.
 */
const panel = readFileSync("src/components/tms/habilitaciones-panel.tsx", "utf8").replace(/\r\n/g, "\n");
const page = readFileSync("src/app/e/[slug]/tms/page.tsx", "utf8").replace(/\r\n/g, "\n");

describe("HabilitacionesPanel", () => {
  it("deja claro que no modifica el puesto de RRHH", () => {
    expect(panel).toMatch(/NO modifican el puesto de RRHH/);
  });

  it("ofrece los 3 estados por rol: Sin habilitar, Habilitado, En capacitación", () => {
    expect(panel).toContain('<option value="">Sin habilitar</option>');
    expect(panel).toContain('<option value="HABILITADO">Habilitado</option>');
    expect(panel).toContain('<option value="CAPACITACION">En capacitación</option>');
  });

  it("consume GET y PUT de /tms/personal-habilitaciones", () => {
    expect(panel).toContain("fetch(`/api/empresas/${slug}/tms/personal-habilitaciones`)");
    expect(panel).toContain('method: "PUT"');
  });

  it("'Sin habilitar' envía estado: null (desactiva, nunca borra) — nunca un string vacío al backend", () => {
    expect(panel).toContain('v === "" ? null : (v as EstadoHabilitacion)');
  });

  it("no toca ningún endpoint de RRHH (empleados/puesto/categoría)", () => {
    expect(panel).not.toMatch(/\/rrhh\//);
    expect(panel).not.toMatch(/\bpuesto\s*=|categoria_ops\s*=/);
  });
});

describe("Integración en el área TMS existente", () => {
  it("tms/page.tsx importa y renderiza HabilitacionesPanel (no se creó una pantalla RRHH nueva)", () => {
    expect(page).toContain('import HabilitacionesPanel from "@/components/tms/habilitaciones-panel";');
    expect(page).toContain("<HabilitacionesPanel slug={slug} />");
  });

  it("vive colapsada junto a 'Catálogos operativos' (mismo patrón <details> del resto de Administración)", () => {
    const idx = page.indexOf("<HabilitacionesPanel");
    const antes = page.slice(Math.max(0, idx - 700), idx);
    expect(antes).toContain("Habilitaciones operativas");
    expect(antes).toContain("<details");
  });
});

describe("Habilitaciones — panel gateado por gestionar TMS", () => {
  it("usa la acción central; Ver no concede gestión y una denegación explícita prevalece", () => {
    const expresion = page.match(/const puedeEditarTms = (.*);/)?.[1];
    expect(expresion).toContain('tieneAccionCatalogo(permisosTms, "tms", "gestionar")');
    const evaluar = new Function("rol","permisosTms","tieneAccionCatalogo",`return ${expresion};`);
    const ver = {modulo:"tms",puedeVer:true,puedeCrear:false,puedeEditar:false,puedeEliminar:false};
    expect(evaluar("Operaciones",[ver],tieneAccionCatalogo)).toBe(false);
    expect(evaluar("Operaciones",[ver,{...ver,modulo:"tms_gestionar"}],tieneAccionCatalogo)).toBe(true);
    expect(evaluar("Operaciones",[{...ver,puedeEditar:true},{...ver,modulo:"tms_gestionar",puedeVer:false}],tieneAccionCatalogo)).toBe(false);
    expect(evaluar("Admin",[],tieneAccionCatalogo)).toBe(true);
  });

  it("el bloque completo de 'Habilitaciones operativas' (el <details> entero) está condicionado a puedeEditarTms", () => {
    const idx = page.indexOf("<HabilitacionesPanel");
    const antes = page.slice(Math.max(0, idx - 700), idx);
    expect(antes).toContain("{puedeEditarTms ? (");
    // El <details> debe estar DENTRO del `{puedeEditarTms ? ( ... )}`, no solo el panel interno.
    const idxCond = antes.indexOf("{puedeEditarTms ? (");
    const idxDetails = antes.indexOf("<details", idxCond);
    expect(idxDetails).toBeGreaterThan(idxCond);
  });

  it("un usuario con solo tms:ver (sin editar) NO ve el bloque — se oculta, no se deshabilita", () => {
    const idx = page.indexOf("<HabilitacionesPanel");
    const bloque = page.slice(Math.max(0, idx - 700), idx + 300);
    expect(bloque).not.toMatch(/disabled=\{!puedeEditarTms\}/); // no es "mostrar deshabilitado", es "no renderizar"
    expect(bloque).toContain("puedeEditarTms ? (");
    expect(bloque).toContain(") : null}");
  });

  it("el backend sigue siendo la autoridad real: PUT usa requireTenantModulo con escritura", () => {
    const route = readFileSync("src/app/api/empresas/[slug]/tms/personal-habilitaciones/route.ts", "utf8");
    expect(route).toContain('requireTenantModulo(slug, "tms", true)');
  });
});
