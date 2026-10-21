import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").split("\r\n").join("\n");
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("SQL de reconstrucción de vacaciones (propuesta; NO ejecutado)", () => {
  const preflight = leer("sql/preflight-reconstruccion-vacaciones.sql");
  const propuesta = leer("sql/reconstruccion-vacaciones-propuesta.sql");

  it("el preflight es SOLO lectura: ninguna sentencia de escritura ni DDL", () => {
    expect(sinComentarios(preflight)).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|REPLACE)\b/im);
  });

  it("el preflight verifica respaldos, tipos de incidencia, referencias y bloqueantes (Elisa, Amílcar)", () => {
    for (const parte of [
      "backup_saldos_vacaciones_20261006", "NO SE TOCA", "RECONSTRUIBLE", "REFERENCED_TABLE_NAME IN ('incidencias', 'saldos_vacaciones', 'vacaciones')",
      "evidencias_incidencias", "VACACION_SIN_INCIDENCIA", "INCIDENCIA_SIN_VACACION", "e.fecha_alta < '1980-01-01'",
      "Diferencia entre fecha entrada laboral y base de vacaciones", "fecha_alta <> e.fecha_inicio_laboral",
    ]) expect(preflight, parte).toContain(parte);
  });

  it("la propuesta está 100 % comentada: ninguna línea ejecutable", () => {
    expect(sinComentarios(propuesta).trim()).toBe("");
  });

  it("la propuesta NO usa TRUNCATE ni FOREIGN_KEY_CHECKS=0 (solo los menciona para prohibirlos)", () => {
    expect(propuesta).not.toMatch(/^--\s*(TRUNCATE\s+(TABLE\s+)?\w+|SET\s+FOREIGN_KEY_CHECKS\s*=\s*0)/im);
    expect(propuesta).toContain("NO TRUNCATE");
    expect(propuesta).toContain('NO "SET FOREIGN_KEY_CHECKS = 0"');
  });

  it("sigue el orden pedido: respaldos → validar staging → transacción → detalle → incidencias de vacaciones → vacaciones → saldos → períodos → vacaciones → incidencias → FIFO → validar → commit", () => {
    const orden = [
      "PASO 1 — RESPALDOS", "PASO 3 — VALIDAR EL STAGING", "START TRANSACTION;", "4.1 eliminar el DETALLE FIFO", "4.2 eliminar UNICAMENTE incidencias de vacaciones",
      "4.3 eliminar las vacaciones", "4.4 eliminar los saldos", "4.5 regenerar los periodos", "4.6 insertar las incidencias", "4.7 insertar las vacaciones",
      "4.8 generar el detalle FIFO", "4.9 VALIDACIONES", "COMMIT;",
    ].map((t) => propuesta.indexOf(t));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("solo se borran incidencias de vacaciones, sin evidencias ni solicitudes; nunca otros tipos", () => {
    const bloque = propuesta.slice(propuesta.indexOf("4.2 eliminar UNICAMENTE"), propuesta.indexOf("4.3 eliminar las vacaciones"));
    expect(bloque).toContain("i.tipo IN ('Vacaciones','A cuenta de Vacaciones')");
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM evidencias_incidencias ev");
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM solicitudes_vacaciones sv");
    expect(propuesta).not.toMatch(/DELETE\s+(i\s+)?FROM\s+incidencias\s*;/i);
    expect(propuesta).not.toMatch(/TRUNCATE\s+incidencias/i);
  });

  it("los respaldos son separados, con sello explícito, y no tocan backup_saldos_vacaciones_20261006", () => {
    for (const t of ["vacaciones", "incidencias_vacaciones", "detalle_consumo_vacaciones", "saldos_vacaciones", "solicitudes_vacaciones"]) {
      expect(propuesta, t).toContain(`bk_reconstruccion_<TS>_${t}`);
    }
    expect(propuesta).toContain("NO se sobrescribe backup_saldos_vacaciones_20261006");
    expect(propuesta).not.toMatch(/(DROP|CREATE OR REPLACE)[^\n]*backup_saldos_vacaciones_20261006/i);
  });

  it("incluye las validaciones post-reconstrucción pedidas", () => {
    for (const v of ["anios laborales duplicados", "saldos_sin_anio", "saldos_negativos", "> 30", "detalle_huerfano", "SUM(d.dias_tomados)", "empleados_bloqueados"]) {
      expect(propuesta.toLowerCase(), v).toContain(v.toLowerCase());
    }
  });
});
