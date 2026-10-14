import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  ESTADOS_LIQUIDACION_VIAJE,
  TIPOS_EVENTO_LIQUIDACION,
  esPendienteDeLiquidar,
  liquidacionExigidaParaPlan,
  normalizarFechaIso,
} from "./liquidacion-viaje-shared";
import { obtenerFechaActivacionLiquidacion } from "./liquidacion-viaje";

const leer = (p: string) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const fuente = (p: string) => sinComentarios(leer(p));
const sinSqlComentarios = (t: string) => t.replace(/--[^\n]*/g, "");

describe("Liquidación de viajes · Fase 1 · reglas puras", () => {
  it("estados y tipos de evento son exactamente los aprobados (sin estado extra para históricos)", () => {
    expect([...ESTADOS_LIQUIDACION_VIAJE]).toEqual(["REPORTE_RECIBIDO", "LIQUIDADO", "EN_AJUSTE"]);
    expect([...TIPOS_EVENTO_LIQUIDACION]).toEqual(["REPORTE_RECIBIDO", "LIQUIDADO", "REABIERTO", "RELIQUIDADO"]);
  });

  it("sin fecha de activación la liquidación NO se exige (el sistema actual no cambia)", () => {
    expect(liquidacionExigidaParaPlan(null, "2026-10-14")).toBe(false);
    expect(liquidacionExigidaParaPlan(undefined, "2026-10-14")).toBe(false);
    expect(liquidacionExigidaParaPlan("", "2026-10-14")).toBe(false);
    expect(liquidacionExigidaParaPlan("no-es-fecha", "2026-10-14")).toBe(false);
  });

  it("con fecha: se exige solo si fecha_plan >= activación; históricos anteriores no", () => {
    expect(liquidacionExigidaParaPlan("2026-11-01", "2026-10-31")).toBe(false);
    expect(liquidacionExigidaParaPlan("2026-11-01", "2026-11-01")).toBe(true);
    expect(liquidacionExigidaParaPlan("2026-11-01", "2027-01-15")).toBe(true);
    expect(liquidacionExigidaParaPlan("2026-11-01", null)).toBe(false);
    expect(liquidacionExigidaParaPlan("2026-11-01", "2026-02-30")).toBe(false);
  });

  it("normalizarFechaIso valida calendario real", () => {
    expect(normalizarFechaIso("2026-02-28")).toBe("2026-02-28");
    expect(normalizarFechaIso("2026-02-29")).toBeNull();
    expect(normalizarFechaIso("2024-02-29")).toBe("2024-02-29");
    expect(normalizarFechaIso("2026-13-01")).toBeNull();
    expect(normalizarFechaIso(20261001)).toBeNull();
  });

  it("amarillo = REPORTE_RECIBIDO y EN_AJUSTE; LIQUIDADO y sin registro no", () => {
    expect(esPendienteDeLiquidar("REPORTE_RECIBIDO")).toBe(true);
    expect(esPendienteDeLiquidar("EN_AJUSTE")).toBe(true);
    expect(esPendienteDeLiquidar("LIQUIDADO")).toBe(false);
    expect(esPendienteDeLiquidar(null)).toBe(false);
  });

  it("la lectura de activación devuelve null si las tablas de Fase 1 aún no existen (errno 1146), y propaga otros errores", async () => {
    const sinTabla = { query: async () => { throw Object.assign(new Error("Table doesn't exist"), { errno: 1146 }); } };
    await expect(obtenerFechaActivacionLiquidacion(7, sinTabla as never)).resolves.toBeNull();
    const caida = { query: async () => { throw Object.assign(new Error("lost connection"), { errno: 2013 }); } };
    await expect(obtenerFechaActivacionLiquidacion(7, caida as never)).rejects.toThrow("lost connection");
    const sinFila = { query: async () => [[]] };
    await expect(obtenerFechaActivacionLiquidacion(7, sinFila as never)).resolves.toBeNull();
    const conFila = { query: async () => [[{ f: "2026-11-01" }]] };
    await expect(obtenerFechaActivacionLiquidacion(7, conFila as never)).resolves.toBe("2026-11-01");
  });
});

describe("Liquidación de viajes · Fase 1 · alcance (no toca cierre, facturación, fondos, cuadrilla, FEL ni contabilidad)", () => {
  const MODULOS = ["src/lib/tms/liquidacion-viaje.ts", "src/lib/tms/liquidacion-viaje-shared.ts"];

  it("el módulo no importa ni referencia cierre, facturación, fondos, gastos, cuadrilla, FEL ni contabilidad", () => {
    for (const m of MODULOS) {
      const t = fuente(m);
      expect(t, m).not.toMatch(/@\/lib\/(facturacion|fel|contabilidad|entregas)|\.\/(cierre|fondos|gastos|cuadrilla|viaticos)/);
      expect(t, m).not.toMatch(/fact_|fel_|cont_|tms_solicitud|tms_gastos|tms_plan_cuadrilla|tms_viaticos|flota_viajes|cerrar_viaje/);
    }
  });

  it("solo LEE tms_planes_viaje: ninguna escritura sobre el plan (ni estado, ni tarifa, ni cierre)", () => {
    const t = fuente("src/lib/tms/liquidacion-viaje.ts");
    expect(t).not.toMatch(/UPDATE\s+tms_planes_viaje|INSERT\s+INTO\s+tms_planes_viaje|DELETE\s+FROM\s+tms_planes_viaje/i);
    expect(t).toMatch(/FROM tms_planes_viaje WHERE empresa_id = \? AND id = \? FOR UPDATE/);
  });

  it("la tabla de eventos es append-only: ningún UPDATE ni DELETE sobre tms_viaje_liquidacion_eventos", () => {
    const t = fuente("src/lib/tms/liquidacion-viaje.ts");
    expect(t).not.toMatch(/UPDATE\s+tms_viaje_liquidacion_eventos|DELETE\s+FROM\s+tms_viaje_liquidacion_eventos/i);
    expect(t).not.toMatch(/DELETE\s+FROM\s+tms_viaje_liquidaciones/i);
    expect(t.match(/INSERT INTO tms_viaje_liquidacion_eventos/g)).toHaveLength(1);
  });

  it("el cierre (normal, manual, masivo, período) y sus rutas NO consultan la liquidación (el gate es Fase 5)", () => {
    for (const f of [
      "src/lib/tms/cierre-viaje.ts",
      "src/lib/tms/cierre-viaje-shared.ts",
      "src/lib/tms/cierre-masivo.ts",
      "src/lib/tms/cierre-manual-planes.ts",
      "src/lib/tms/planes-periodo.ts",
      "src/app/api/empresas/[slug]/tms/planes/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/[id]/cerrar/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/cerrar-masivo/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/cerrar-masivo-periodo/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/candidatos-cierre/route.ts",
    ]) {
      expect(leer(f), f).not.toMatch(/liquidacion-viaje|tms_viaje_liquidaci|tms_liquidacion_config/);
    }
  });

  it("importadores PERMITIDOS (Fase 3): endpoints de liquidación, Planes/Viajes, modales y el armado de la lista", () => {
    let salida = "";
    try {
      salida = execFileSync("git", ["grep", "--untracked", "-lE", "liquidacion-viaje(-shared|-reporte|-snapshot|-modales)?[\"']", "--", "src"], { encoding: "utf8" });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e;
    }
    const permitidos = new Set([
      "src/app/api/empresas/[slug]/tms/planes/[id]/reporte-recibido/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/[id]/liquidar/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/[id]/reabrir-liquidacion/route.ts",
      "src/app/api/empresas/[slug]/tms/planes/[id]/liquidacion/route.ts",
      "src/components/tms/liquidacion-viaje-modales.tsx",
      "src/app/e/[slug]/planes/planes-viajes-client.tsx",
      "src/lib/tms/reportes-viajes.ts",
      "src/lib/tms/liquidacion-viaje-reporte.ts",
      // Fase 4: los cargos reutilizan los tipos/estados de la liquidación (solo lectura del estado; no la modifican).
      "src/lib/tms/cargos-adicionales.ts",
      "src/lib/tms/cargos-adicionales-shared.ts",
    ]);
    const importadores = salida
      .split("\n")
      .filter(Boolean)
      .filter((p) => !/liquidacion-viaje[^/]*\.ts$/.test(p))
      .filter((p) => !permitidos.has(p) && !/\.test\.tsx?$/.test(p));
    expect(importadores).toEqual([]);
  });

  it("permisos: solo los de las fases implementadas están declarados (cargos y configuración llegan con su fase)", () => {
    for (const f of ["src/lib/permisos-shared.ts", "src/lib/permisos-catalogo.ts"]) {
      expect(leer(f), f).not.toMatch(/viajes_cargos_aprobar|viajes_liquidacion_config|viajes_liquidacion_reabrir/);
    }
    expect(leer("src/lib/permisos-shared.ts")).toMatch(
      /PERMISOS_LIQUIDACION_VIAJE = \[\s*"viajes_confirmar_reporte",\s*"viajes_liquidar",\s*"viajes_reabrir_liquidacion",\s*"viajes_cargos_adicionales",?\s*\] as const/,
    );
  });

});

describe("Liquidación de viajes · Fase 1 · SQL", () => {
  const M = "sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql";

  it("la migración solo crea las tres tablas nuevas: sin ALTER, DROP, INSERT/UPDATE/DELETE, seeds ni backfill", () => {
    const m = sinSqlComentarios(leer(M));
    expect(m).not.toMatch(/\b(ALTER|DROP|TRUNCATE|REPLACE|GRANT)\b/i);
    expect(m).not.toMatch(/(^|;)\s*(INSERT|UPDATE|DELETE)\b/im);
    expect(m.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
    for (const t of ["tms_liquidacion_config", "tms_viaje_liquidaciones", "tms_viaje_liquidacion_eventos"]) expect(m).toContain(t);
  });

  it("modelo: UNIQUE 1:1 por empresa+viaje, FK compuesta a tms_planes_viaje, RESTRICT en todo", () => {
    const m = leer(M);
    expect(m).toMatch(/UNIQUE KEY uq_tvl_empresa_plan \(empresa_id, plan_id\)/);
    expect(m).toMatch(/FOREIGN KEY \(empresa_id, plan_id\) REFERENCES tms_planes_viaje\(empresa_id, id\)/);
    expect(m).toMatch(/UNIQUE KEY uq_tvle_version \(empresa_id, plan_id, version\)/);
    expect(m).toMatch(/fecha_activacion_liquidacion DATE NULL DEFAULT NULL/);
    expect(m).not.toMatch(/ON DELETE (CASCADE|SET NULL)|ON UPDATE (CASCADE|SET NULL)/);
  });

  it("schema.sql contiene las tres tablas idénticas a la migración", () => {
    const m = leer(M);
    const ddl = m.slice(m.indexOf("CREATE TABLE IF NOT EXISTS tms_liquidacion_config"));
    expect(leer("sql/schema.sql")).toContain(ddl.trim());
  });

  it("preflight y verify son de solo lectura", () => {
    for (const f of ["sql/preflight-2026-10-tms-liquidacion-viajes-fase1.sql", "sql/verify-2026-10-tms-liquidacion-viajes-fase1.sql"]) {
      const t = sinSqlComentarios(leer(f)).replace(/SHOW\s+CREATE\s+TABLE/gi, "SHOW TABLE_DDL");
      expect(t, f).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT)\b/i);
    }
  });
});
