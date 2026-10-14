import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  evaluarEdicionCargos,
  textoResumenCargos,
  totalCargosActivos,
  totalComercialPreliminar,
  validarConceptoCargo,
  validarMontoCargo,
  validarMotivoAnulacionCargo,
  validarObservacionCargo,
} from "./cargos-adicionales-shared";
import {
  catalogoGlobalPermisos,
  esPlataformaPermisible,
  labelPermiso,
  moduloEmpresaDelPermiso,
  permisosDefaultPorRol,
  PERMISOS_LIQUIDACION_VIAJE,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos-shared";
import { CATALOGO_PERMISOS } from "@/lib/permisos-catalogo";

const leer = (p: string) => readFileSync(p, "utf8");
const RUTAS = [
  "src/app/api/empresas/[slug]/tms/planes/[id]/cargos/route.ts",
  "src/app/api/empresas/[slug]/tms/planes/[id]/cargos/[cargoId]/route.ts",
  "src/app/api/empresas/[slug]/tms/planes/[id]/cargos/[cargoId]/anular/route.ts",
  "src/app/api/empresas/[slug]/tms/planes/[id]/cargos/[cargoId]/reactivar/route.ts",
];

describe("Cargos adicionales · Fase 4 · validaciones puras", () => {
  it("monto: positivo, máximo 2 decimales, sin redondeo silencioso y sin notación científica", () => {
    expect(validarMontoCargo("150")).toEqual({ ok: true, valor: "150.00" });
    expect(validarMontoCargo(12.5)).toEqual({ ok: true, valor: "12.50" });
    expect(validarMontoCargo(" 0.01 ")).toEqual({ ok: true, valor: "0.01" });
    for (const malo of [0, "0", "0.00", -1, "-5", "10.005", "1e3", "abc", "", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "10000000000.00"]) {
      expect(validarMontoCargo(malo).ok, String(malo)).toBe(false);
    }
  });

  it("concepto/observación/motivo: se normalizan y respetan longitudes", () => {
    expect(validarConceptoCargo("  Tiempo   de  espera ")).toEqual({ ok: true, valor: "Tiempo de espera" });
    expect(validarConceptoCargo("a").ok).toBe(false);
    expect(validarConceptoCargo("x".repeat(121)).ok).toBe(false);
    expect(validarObservacionCargo("   ")).toEqual({ ok: true, valor: null });
    expect(validarObservacionCargo(undefined)).toEqual({ ok: true, valor: null });
    expect(validarObservacionCargo("x".repeat(501)).ok).toBe(false);
    expect(validarMotivoAnulacionCargo("1234").ok).toBe(false);
    expect(validarMotivoAnulacionCargo(" Duplicado ")).toEqual({ ok: true, valor: "Duplicado" });
  });

  it("totales con Decimal: sin error de coma flotante, anulados fuera, sin base no se inventa total", () => {
    expect(totalCargosActivos([{ monto: "0.10" }, { monto: "0.20" }])).toBe("0.30");
    expect(totalCargosActivos([{ monto: "10.00", activo: true }, { monto: "99.00", activo: false }])).toBe("10.00");
    expect(totalComercialPreliminar("1000", [{ monto: "0.10" }, { monto: "0.20" }])).toEqual({
      tarifaBase: "1000.00", cargosAdicionales: "0.30", totalComercial: "1000.30", ivaPendiente: true,
    });
    expect(totalComercialPreliminar(null, [{ monto: "5" }])).toMatchObject({ tarifaBase: null, totalComercial: null, cargosAdicionales: "5.00" });
  });

  it("texto compacto de la fila: «Cargos: n · Q total» / «Sin cargos»", () => {
    expect(textoResumenCargos(null)).toBe("Sin cargos");
    expect(textoResumenCargos({ cantidad: 0, total: "0.00" })).toBe("Sin cargos");
    expect(textoResumenCargos({ cantidad: 2, total: "350" })).toBe("Cargos: 2 · Q350.00");
    expect(textoResumenCargos({ cantidad: 1, total: "10" }, "USD")).toBe("Cargos: 1 · USD 10.00");
  });
});

describe("Cargos adicionales · Fase 4 · reglas de edición por estado (secuencia confirmada)", () => {
  it("editables: abierto no liquidado, Cerrado + REPORTE_RECIBIDO, Cerrado sin liquidación y Cerrado + EN_AJUSTE", () => {
    for (const plan of ["Programado", "En ruta", "Entregado", "Cerrado"]) {
      expect(evaluarEdicionCargos(plan, null).editable, `${plan} sin liquidación`).toBe(true);
      expect(evaluarEdicionCargos(plan, "REPORTE_RECIBIDO").editable, `${plan} + REPORTE_RECIBIDO`).toBe(true);
      expect(evaluarEdicionCargos(plan, "EN_AJUSTE").editable, `${plan} + EN_AJUSTE`).toBe(true);
    }
  });

  it("LIQUIDADO (incluye re-liquidado) bloquea con código y mensaje que explica cómo corregir sin reabrir el viaje", () => {
    for (const plan of ["Programado", "Cerrado"]) {
      const r = evaluarEdicionCargos(plan, "LIQUIDADO");
      expect(r).toMatchObject({ editable: false, codigo: "LIQUIDACION_CERRADA" });
      if (!r.editable) expect(r.motivo).toMatch(/reabre la liquidación/i);
    }
  });

  it("Cancelado no admite cargos (supuesto a confirmar con negocio)", () => {
    expect(evaluarEdicionCargos("Cancelado", null)).toMatchObject({ editable: false, codigo: "PLAN_NO_ADMITE" });
    expect(evaluarEdicionCargos("Cancelado", "REPORTE_RECIBIDO")).toMatchObject({ editable: false, codigo: "PLAN_NO_ADMITE" });
  });
});

describe("Cargos adicionales · Fase 4 · permiso (patrón real del repositorio)", () => {
  it("viajes_cargos_adicionales: fila propia, editar, módulo TMS, ≤ 40 caracteres, sin rol por defecto", () => {
    expect(PERMISOS_LIQUIDACION_VIAJE).toContain("viajes_cargos_adicionales");
    expect("viajes_cargos_adicionales".length).toBeLessThanOrEqual(40);
    expect(esPlataformaPermisible("viajes_cargos_adicionales")).toBe(true);
    expect(moduloEmpresaDelPermiso("viajes_cargos_adicionales")).toBe("tms");
    expect(labelPermiso("viajes_cargos_adicionales")).toBe("Viajes: cargos adicionales facturables");
    expect(catalogoGlobalPermisos()).toContain("viajes_cargos_adicionales");
    const prog = CATALOGO_PERMISOS.find((m) => m.id === "programacion")!;
    expect(prog.acciones.find((a) => a.modulo === "viajes_cargos_adicionales")).toMatchObject({ id: "cargos_adicionales", flag: "puedeEditar" });
    // Ningún rol (salvo Admin, que recibe todo el catálogo) lo trae por defecto, y viajes_cerrar/viajes_liquidar no lo conceden.
    const roles = [
      "RRHH", "Marcaje", "Contabilidad", "Operaciones", "GerenteOperaciones", "JefeOperaciones",
      "AuxiliarOperaciones", "Facturador", "CoordinadorPredios", "CoordinadorCompras", "Piloto", "Visualizador",
    ];
    for (const rol of roles) {
      const perms: PermisoModulo[] = permisosDefaultPorRol(rol as never);
      expect(perms.find((p) => p.modulo === "viajes_cargos_adicionales")?.puedeEditar ?? false, rol).toBe(false);
    }
    const otros: PermisoModulo[] = ["viajes_cerrar", "viajes_liquidar", "viajes_reabrir_liquidacion"].map((modulo) => ({
      modulo, puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true,
    }));
    expect(tienePermiso(otros, "viajes_cargos_adicionales", "editar")).toBe(false);
  });

  it("guard del servidor: permiso explícito, exige módulo TMS y Admin entra por catálogo", () => {
    const t = leer("src/lib/tenant.ts");
    expect(t).toMatch(/requireTenantViajesCargosAdicionales[\s\S]{0,300}"viajes_cargos_adicionales"/);
    expect(t).toMatch(/"viajes_liquidar" \| "viajes_reabrir_liquidacion" \| "viajes_cargos_adicionales"/);
  });
});

describe("Cargos adicionales · Fase 4 · endpoints (tenant/permiso/esquema estricto)", () => {
  it("toda mutación exige el permiso propio y toma empresa/usuario de la sesión, nunca del cuerpo", () => {
    for (const ruta of RUTAS) {
      const src = leer(ruta);
      if (/export async function (POST|PATCH)/.test(src)) {
        expect(src, ruta).toMatch(/requireTenantViajesCargosAdicionales\(slug, "editar"\)/);
        expect(src, ruta).toMatch(/guard\.empresa\.id/);
        expect(src, ruta).toMatch(/guard\.session\.id/);
        expect(src, ruta).toMatch(/\.strict\(\)/);
        expect(src, ruta).not.toMatch(/body(\.|\[)(empresa|usuario|creado|actor)/i);
      }
    }
  });

  it("la lectura usa la visibilidad del listado de viajes y 404 para viajes de otra empresa", () => {
    const src = leer(RUTAS[0]);
    expect(src).toMatch(/requireTenantProgramacionOTms\(slug, "ver"\)/);
    expect(src).toMatch(/status: 404/);
    const resumen = leer("src/app/api/empresas/[slug]/tms/planes/cargos-resumen/route.ts");
    expect(resumen).toMatch(/requireTenantProgramacionOTms\(slug, "ver"\)/);
    expect(resumen).toMatch(/MAX_IDS/);
  });

  it("el cuerpo exige expectedVersion (concurrencia optimista) y motivo para anular", () => {
    expect(leer(RUTAS[1])).toMatch(/expectedVersion: z\.number\(\)\.int\(\)\.min\(1\)/);
    expect(leer(RUTAS[2])).toMatch(/motivo: z\.string\(\)/);
    expect(leer(RUTAS[3])).toMatch(/expectedVersion/);
  });
});

describe("Cargos adicionales · Fase 4 · alcance y SQL", () => {
  it("el módulo de cargos NO importa cierre, facturación, FEL, contabilidad, fondos ni gastos", () => {
    for (const f of ["src/lib/tms/cargos-adicionales.ts", "src/lib/tms/cargos-adicionales-shared.ts", "src/components/tms/cargos-viaje-modal.tsx"]) {
      expect(leer(f), f).not.toMatch(/from "[^"]*(facturacion|fel|contabilidad|fondos|gastos|viaticos|cierre|cerrar)[^"]*"/i);
      expect(leer(f), f).not.toMatch(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+(fact_|fel_|cont_|tms_solicitud|tms_gastos|tms_planes_viaje)/i);
    }
  });

  it("nada fuera de cargos escribe en tms_viaje_cargos_adicionales/eventos (tabla propia del módulo)", () => {
    let salida = "";
    try {
      salida = execFileSync("git", ["grep", "--untracked", "-lE", "tms_viaje_cargo(s_adicionales|_eventos)", "--", "src"], { encoding: "utf8" });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e;
    }
    const permitidos = new Set(["src/lib/tms/cargos-adicionales.ts", "src/lib/tms/liquidacion-viaje-snapshot.ts"]);
    const otros = salida.split("\n").filter(Boolean).filter((p) => !permitidos.has(p) && !/\.test\.tsx?$/.test(p));
    expect(otros).toEqual([]);
    // El snapshot solo LEE los cargos vigentes.
    expect(leer("src/lib/tms/liquidacion-viaje-snapshot.ts")).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+tms_viaje_cargo/i);
  });

  it("migración: tablas nuevas, FK compuesta por empresa, checks, sin DROP/ALTER/seed", () => {
    const m = leer("sql/migrate-2026-10-tms-liquidacion-cargos-fase4.sql").replace(/--[^\n]*/g, "");
    expect(m).not.toMatch(/(^|;)\s*(DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT)\b/im);
    expect(m).toMatch(/CREATE TABLE IF NOT EXISTS tms_viaje_cargos_adicionales/);
    expect(m).toMatch(/CREATE TABLE IF NOT EXISTS tms_viaje_cargo_eventos/);
    expect(m).toMatch(/FOREIGN KEY \(empresa_id, plan_id\) REFERENCES tms_planes_viaje\(empresa_id, id\)/);
    expect(m).toMatch(/FOREIGN KEY \(empresa_id, cargo_id\) REFERENCES tms_viaje_cargos_adicionales\(empresa_id, id\)/);
    expect(m).toMatch(/CHECK \(monto > 0\)/);
    expect(m).toMatch(/UNIQUE KEY uq_tvca_clave \(empresa_id, clave_envio\)/);
    expect(m).toMatch(/UNIQUE KEY uq_tvce_version \(empresa_id, cargo_id, version\)/);
    expect(m).toMatch(/ON DELETE RESTRICT/);
    expect(m).not.toMatch(/\biva\b|impuesto|factura/i);
  });

  it("preflight/verify son de solo lectura", () => {
    for (const f of ["sql/preflight-2026-10-tms-liquidacion-cargos-fase4.sql", "sql/verify-2026-10-tms-liquidacion-cargos-fase4.sql"]) {
      expect(leer(f).replace(/--[^\n]*/g, ""), f).not.toMatch(/(^|;)\s*(DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT|CREATE)\b/im);
    }
  });

  it("schema.sql refleja las dos tablas nuevas", () => {
    const s = leer("sql/schema.sql");
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS tms_viaje_cargos_adicionales/);
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS tms_viaje_cargo_eventos/);
  });
});

describe("Cargos adicionales · Fase 4 · UI (Ajustes rápidos)", () => {
  const tabla = leer("src/app/e/[slug]/programacion/edicion-rapida.tsx");
  const modal = leer("src/components/tms/cargos-viaje-modal.tsx");

  it("la fila muestra el resumen compacto y abre el panel; los cargos no entran al borrador de la tabla", () => {
    expect(tabla).toMatch(/"Cargos", "Estado de edición"/);
    expect(tabla).toMatch(/textoResumenCargos\(/);
    expect(tabla).toMatch(/cargos-resumen\?ids=/);
    expect(tabla).toMatch(/<ModalCargosViaje/);
    expect(tabla).not.toMatch(/cuerpoEdicionRapida\([^)]*cargos/i);
  });

  it("el panel dice «Total comercial preliminar», no «total factura», y deja IVA pendiente sin decidirlo", () => {
    expect(modal).toMatch(/Total comercial preliminar/);
    expect(modal).toMatch(/pendiente de definición de negocio\/fiscal/);
    expect(modal).not.toMatch(/total factura|total de factura|IVA incluido|\+ IVA/i);
    expect(modal).toMatch(/No es el total de la factura/);
  });

  it("anular pide motivo, el panel nunca borra y respeta el permiso y el estado que decide el servidor", () => {
    expect(modal).toMatch(/Confirmar anulación/);
    expect(modal).toMatch(/motivo\.trim\(\)\.length < 5/);
    expect(modal).not.toMatch(/method: "DELETE"/);
    expect(modal).toMatch(/vista\?\.edicion\.editable === true/);
    expect(modal).toMatch(/puedeEditar/);
  });

  it("el cliente de Programación pasa el permiso explícito del cargo (no deriva de edición rápida)", () => {
    expect(leer("src/app/e/[slug]/programacion/programacion-client.tsx")).toMatch(
      /puedeGestionarCargos=\{tienePermiso\(permisos, "viajes_cargos_adicionales", "editar"\)\}/,
    );
  });
});
