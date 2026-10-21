import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — DDL propuesto (sql/migrate-2026-10-tms-personal-habilitaciones.sql,
 * NO ejecutado) y su preflight de SOLO LECTURA (sql/preflight-2026-10-tms-personal-habilitaciones.sql).
 * Mismo criterio de prueba ya usado para la migración aditiva más reciente de este mismo módulo TMS
 * (ver src/lib/tms/cuadrilla-integracion.test.ts, "migración aditiva/idempotente...").
 */
// schema.sql vive con CRLF (convención del repo en Windows); se normaliza a LF antes de comparar.
const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");

describe("TMS-PROGRAMACION-HABILITACIONES-1 — migración aditiva/idempotente coincide con schema.sql", () => {
  it("el CREATE TABLE de la migración aparece TAL CUAL dentro de schema.sql", () => {
    const ddl = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql");
    const sentencia = ddl.slice(ddl.indexOf("CREATE TABLE"));
    expect(leer("sql/schema.sql")).toContain(sentencia.trim());
  });

  it("la migración contiene ÚNICAMENTE CREATE TABLE IF NOT EXISTS (aditiva: sin ALTER/DROP/backfill/DML)", () => {
    const sql = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS tms_personal_habilitaciones/);
    expect(
      sql
        .split(";")
        .filter((s) => s.trim())
        .every((s) => /^\s*CREATE TABLE IF NOT EXISTS\b/i.test(s)),
    ).toBe(true);
    // "ON UPDATE CURRENT_TIMESTAMP" es sintaxis DDL legítima de la propia columna `actualizado_en` — el
    // check de "cada sentencia empieza con CREATE TABLE" (arriba) ya garantiza que no hay ningún UPDATE/
    // INSERT/DELETE/ALTER/DROP como sentencia independiente; aquí solo se descarta lo verdaderamente ajeno.
    expect(sql).not.toMatch(/\bALTER TABLE\b|\bDROP TABLE\b|\bINSERT INTO\b|\bDELETE FROM\b/i);
  });

  it("UNIQUE KEY empleado+rol y los dos CHECK (rol, estado) están presentes", () => {
    const sql = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql");
    expect(sql).toContain("UNIQUE KEY uq_tph_empleado_rol (empresa_id, empleado_id, rol)");
    expect(sql).toContain("CONSTRAINT chk_tph_rol CHECK (rol IN ('PILOTO', 'AUXILIAR'))");
    expect(sql).toContain("CONSTRAINT chk_tph_estado CHECK (estado IN ('HABILITADO', 'CAPACITACION'))");
  });

  it("preflight contiene ÚNICAMENTE SELECT/SHOW, sin information_schema", () => {
    const sql = leer("sql/preflight-2026-10-tms-personal-habilitaciones.sql").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/information_schema/i);
    expect(
      sql
        .split(";")
        .filter((s) => s.trim())
        .every((s) => /^\s*(SELECT|SHOW)\b/.test(s)),
    ).toBe(true);
  });
});

describe("TMS-PROGRAMACION-HABILITACIONES-1 — aislamiento multiempresa vía FK compuesta", () => {
  it("FK a empleados es COMPUESTA por empresa (nunca solo por id) — mismo patrón ya validado en tms_plan_cuadrilla", () => {
    const sql = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(
      /fk_tph_empleado FOREIGN KEY \(empresa_id, empleado_id\)\s+REFERENCES empleados\(empresa_id, id\) ON DELETE RESTRICT ON UPDATE RESTRICT/,
    );
    expect(sql).not.toMatch(/FOREIGN KEY \(empleado_id\)/);
  });

  it("FK a empresas con ON DELETE CASCADE / ON UPDATE RESTRICT (igual que el resto del módulo TMS)", () => {
    const sql = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/fk_tph_empresa FOREIGN KEY \(empresa_id\) REFERENCES empresas\(id\)\s+ON DELETE CASCADE ON UPDATE RESTRICT/);
    expect(sql.match(/ON UPDATE RESTRICT/g)).toHaveLength(2);
    expect(sql).not.toMatch(/ON UPDATE CASCADE|SET NULL/);
  });

  it("columnas de FK son INT (no UNSIGNED) — mismo tipo que empleados.id/empresa_id en schema.sql", () => {
    const sql = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql");
    for (const columna of ["empresa_id", "empleado_id"]) {
      expect(sql).toMatch(new RegExp(`\\b${columna} INT NOT NULL`));
    }
    expect(sql).not.toContain("UNSIGNED");
  });

  it("índices de apoyo por empresa+empleado y empresa+rol+activo", () => {
    const sql = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql");
    expect(sql).toContain("INDEX idx_tph_empresa_empleado (empresa_id, empleado_id)");
    expect(sql).toContain("INDEX idx_tph_empresa_rol_activo (empresa_id, rol, activo)");
  });

  it("ENGINE/COLLATE reales de producción — mismos que la migración aditiva más reciente del módulo (tms_plan_cuadrilla)", () => {
    const sql = leer("sql/migrate-2026-10-tms-personal-habilitaciones.sql");
    expect(sql).toContain("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;");
  });
});

describe("TMS-PROGRAMACION-HABILITACIONES-1 — el padre empleados ya tiene el índice compuesto que necesita la FK", () => {
  it("empleados conserva su UNIQUE KEY (empresa_id, id) en schema.sql — esta migración no lo crea ni lo modifica", () => {
    const schema = leer("sql/schema.sql");
    const empleados = schema.slice(
      schema.indexOf("CREATE TABLE IF NOT EXISTS empleados ("),
      schema.indexOf("CREATE TABLE IF NOT EXISTS rrhh_descuentos ("),
    );
    expect(empleados).toContain("UNIQUE KEY uq_ruta_personal_empresa_id (empresa_id, id)");
  });
});

describe("TMS-PROGRAMACION-HABILITACIONES-1 — preflight verifica el estado real antes de aplicar", () => {
  it("comprueba índices del padre, checks, foreign keys y collation mediante comandos de solo lectura", () => {
    const sql = leer("sql/preflight-2026-10-tms-personal-habilitaciones.sql");
    expect(sql).toContain("SHOW INDEX FROM empleados;");
    expect(sql).toContain("SHOW VARIABLES LIKE 'foreign_key_checks';");
    expect(sql).toContain("SHOW VARIABLES LIKE 'check_constraint_checks';");
    expect(sql).toContain("SHOW COLLATION WHERE Collation IN ('utf8mb4_uca1400_ai_ci', 'uca1400_ai_ci');");
    expect(sql).toContain("SHOW TABLES LIKE 'tms_personal_habilitaciones';");
  });

  it("no asume el nombre del índice padre de empleados documentado en schema.sql — pide confirmarlo con SHOW INDEX", () => {
    const sql = leer("sql/preflight-2026-10-tms-personal-habilitaciones.sql");
    expect(sql).toMatch(/no asumir el nombre|SHOW INDEX/i);
    expect(sql).toContain("uq_multas_empleado_empresa_id");
  });

  it("documenta explícitamente que no toca tms_personal (catálogo operativo existente, sin cambios)", () => {
    const sql = leer("sql/preflight-2026-10-tms-personal-habilitaciones.sql");
    expect(sql).toContain("SHOW CREATE TABLE tms_personal;");
  });
});
