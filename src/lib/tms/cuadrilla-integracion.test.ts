import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { anchosPdfProgramacion, ANCHO_UTIL_PDF } from "./programacion-pdf-anchos";
import { construirLayoutImagen, COLUMNAS_IMAGEN, type FilaProgramacionImagen } from "./programacion-imagen";

const leer = (ruta: string) => readFileSync(ruta, "utf8");
describe("Cuadrilla: UI y despliegue separados", () => {
  it("formulario precarga cuadrilla y catálogo completo; sección distinta, sin reutilizar auxiliares", () => {
    const form = leer("src/app/e/[slug]/programacion/plan-form.tsx");
    expect(form).toContain("plan?.cuadrilla ?? []"); expect(form).toContain("setEmpleadosCuadrilla(list)");
    expect(form).toContain("<CuadrillaSelect"); expect(form).toContain("<AuxiliaresSelect");
    expect(form).toContain("cuadrillaPayload(cuadrilla)"); expect(form).toContain("cuadrillaCambio ? cuadrillaPayload");
    expect(form).toContain("cambioSensible || cuadrillaCambio");
  });
  it("modelo no escribe RRHH, tms_personal, auxiliares ni viáticos", () => {
    const modelo = leer("src/lib/tms/cuadrilla.ts");
    expect(modelo).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:empleados|tms_personal|tms_viaticos|tms_plan_auxiliares)\b/);
  });
  it("ninguna llamada de sincronización de viáticos recibe Cuadrilla", () => {
    const route = leer("src/app/api/empresas/[slug]/tms/planes/route.ts");
    const llamadas = [...route.matchAll(/await sincronizarViaticosPlan\([\s\S]*?\);/g)];
    expect(llamadas).toHaveLength(3);
    llamadas.forEach(([llamada]) => expect(llamada).not.toMatch(/cuadrilla/i));
  });
  it("migración aditiva/idempotente coincide con schema y no ejecuta alter/backfill", () => {
    const ddl = leer("sql/migrate-2026-10-tms-plan-cuadrilla.sql");
    const sentencia = ddl.slice(ddl.indexOf("CREATE TABLE"));
    expect(leer("sql/schema.sql")).toContain(sentencia.trim());
    const sql = ddl.replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS tms_plan_cuadrilla/);
    expect(sql.split(";").filter((s) => s.trim()).every((s) => /^\s*CREATE TABLE IF NOT EXISTS\b/i.test(s))).toBe(true);
    expect(sql).toContain("uq_tpc_plan_empleado"); expect(sql).toContain("chk_tpc_tipo");
  });
  it("preflight solo SELECT/SHOW, sin information_schema", () => {
    const sql = leer("sql/preflight-2026-10-tms-plan-cuadrilla.sql").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/information_schema/i);
    expect(sql.split(";").filter((s) => s.trim()).every((s) => /^\s*(SELECT|SHOW)\b/.test(s))).toBe(true);
  });
  it("DDL aplica aislamiento tenant mediante FKs compuestas con índices hijos compatibles", () => {
    const sql = leer("sql/migrate-2026-10-tms-plan-cuadrilla.sql").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/fk_tpc_plan FOREIGN KEY \(empresa_id, plan_id\)\s+REFERENCES tms_planes_viaje\(empresa_id, id\) ON DELETE CASCADE ON UPDATE RESTRICT/);
    expect(sql).toMatch(/fk_tpc_empleado FOREIGN KEY \(empresa_id, id_empleado\)\s+REFERENCES empleados\(empresa_id, id\) ON DELETE RESTRICT ON UPDATE RESTRICT/);
    expect(sql).toContain("INDEX idx_tpc_empresa_plan (empresa_id, plan_id)");
    expect(sql).toContain("INDEX idx_tpc_empresa_empleado (empresa_id, id_empleado)");
    expect(sql).not.toMatch(/FOREIGN KEY \((?:plan_id|id_empleado)\)/);
    for (const columna of ["empresa_id", "plan_id", "id_empleado"]) {
      expect(sql).toMatch(new RegExp(`\\b${columna} INT (?:NOT NULL|NULL)`));
    }
    expect(sql).not.toContain("UNSIGNED");
  });
  it("conserva integridad directa de empresa, CHECK y NULL para externos; collation MariaDB real", () => {
    const sql = leer("sql/migrate-2026-10-tms-plan-cuadrilla.sql");
    expect(sql).toMatch(/fk_tpc_empresa FOREIGN KEY \(empresa_id\) REFERENCES empresas\(id\)\s+ON DELETE CASCADE ON UPDATE RESTRICT/);
    expect(sql.match(/ON UPDATE RESTRICT/g)).toHaveLength(3);
    expect(sql).not.toMatch(/ON UPDATE CASCADE|SET NULL/);
    expect(sql).toContain("(tipo = 'INTERNO' AND id_empleado IS NOT NULL AND identificacion IS NULL AND telefono IS NULL)");
    expect(sql).toContain("(tipo = 'EXTERNO' AND id_empleado IS NULL)");
    expect(sql).toContain("UNIQUE KEY uq_tpc_plan_empleado (plan_id, id_empleado)");
    expect(sql).toContain("UNIQUE KEY uq_tpc_plan_orden (plan_id, orden)");
    expect(sql).toContain("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;");
  });
  it("schema nuevo ya tiene índices equivalentes en padres, sin modificarlos para esta migración", () => {
    const schema = leer("sql/schema.sql");
    const empleados = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS empleados ("), schema.indexOf("CREATE TABLE IF NOT EXISTS rrhh_descuentos ("));
    const planes = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS tms_planes_viaje ("), schema.indexOf("CREATE TABLE IF NOT EXISTS tms_plan_auxiliares ("));
    expect(empleados).toContain("UNIQUE KEY uq_ruta_personal_empresa_id (empresa_id, id)");
    expect(planes).toContain("UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id)");
  });
  it("preflight comprueba índices padres, checks y collation mediante comandos de solo lectura", () => {
    const sql = leer("sql/preflight-2026-10-tms-plan-cuadrilla.sql");
    expect(sql).toContain("SHOW INDEX FROM empleados;");
    expect(sql).toContain("SHOW INDEX FROM tms_planes_viaje;");
    expect(sql).toContain("SHOW VARIABLES LIKE 'foreign_key_checks';");
    expect(sql).toContain("SHOW VARIABLES LIKE 'check_constraint_checks';");
    expect(sql).toContain("SHOW COLLATION WHERE Collation IN ('utf8mb4_uca1400_ai_ci', 'uca1400_ai_ci');");
    expect(sql).toContain("FKs plan/empleado deben ser COMPUESTAS por empresa");
  });
  it("PDF ajusta anchos al espacio real al agregar Cuadrilla", () => {
    for (const codigo of [[], ["Código"]]) {
      const headers = ["Mes", "Día", "Placa", "TC", "Piloto", "Auxiliar 1", "Auxiliar 2", ...codigo, "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga", "Cuadrilla"];
      expect(Object.values(anchosPdfProgramacion(headers)).reduce((s, n) => s + n, 0)).toBeCloseTo(ANCHO_UTIL_PDF);
    }
  });
  it("imagen mantiene auxiliares independientes y todos los integrantes en continuaciones", () => {
    const fila: FilaProgramacionImagen = { mes: "OCT", dia: "1", placa: "P", tc: "", piloto: "Piloto", auxiliar1: "Auxiliar", auxiliar2: "", cliente: "Cliente", lugarCarga: "Carga", hora: "08:00", lugarDescarga: "Descarga", cuadrilla: "Juan (interno)\nPedro (externo)" };
    const layout = construirLayoutImagen({ empresa: "Empresa", rango: "2026-10-01", filtros: "", generado: "" }, [fila]);
    expect(layout.columnas?.map((c) => c.titulo)).toEqual([...COLUMNAS_IMAGEN.map((c) => c.titulo), "Cuadrilla"]);
    expect(layout.paginas.flat().map((f) => f.at(-1))).toEqual(["Juan (interno)", "Pedro (externo)"]);
    expect(layout.paginas[0][0][5]).toBe("Auxiliar"); expect(layout.paginas[0][1][5]).toBe("");
  });
});
