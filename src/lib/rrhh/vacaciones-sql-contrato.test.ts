import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").split("\r\n").join("\n");
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("SQL de reparación de períodos de vacaciones (propuesta, no ejecutado)", () => {
  const preflight = leer("sql/preflight-2026-10-vacaciones-historial-periodos.sql");
  const propuesta = leer("sql/propuesta-2026-10-reparar-periodos-vacaciones.sql");

  it("el preflight es SOLO lectura: ninguna sentencia de escritura ni DDL", () => {
    expect(sinComentarios(preflight)).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|REPLACE)\b/im);
  });

  it("el preflight cubre lo pedido: períodos por empleado, fecha sospechosa, traslapes borde/real, duplicados, gaps, valores, consumos y clasificación", () => {
    for (const parte of [
      "periodos_esperados_max", "< '1980-01-01'", "BORDE", "REAL (varios dias)", "dias_superposicion", "ANIO_LABORAL_REPETIDO", "INICIO_REPETIDO",
      "dias_gap", "OTORGADOS_MAYOR_15", "DISPONIBLES_MAYOR_OTORGADOS", "detalle_consumo_vacaciones", "NO ELIMINAR",
    ]) expect(preflight, parte).toContain(parte);
    expect(preflight).toContain("VACACION_SIN_INCIDENCIA");
    expect(preflight).toContain("INCIDENCIA_SIN_VACACION");
    expect(preflight).toMatch(/A - seguro de eliminar/);
    expect(preflight).toMatch(/B - con consumo/);
    expect(preflight).toMatch(/C - decision de RRHH/);
    expect(preflight).toMatch(/D - corregir ficha/);
  });

  it("Elisa (empleado 37) aparece explícitamente, sin asumir su fecha", () => {
    expect(preflight).toContain("WHERE e.id = 37");
    expect(preflight).toContain("fecha laboral invalida/sospechosa; requiere dato de RRHH antes de reparar");
    expect(propuesta).toContain("NO asumir la fecha");
    expect(propuesta).toContain("<FECHA_REAL_RRHH>");
  });

  it("la propuesta está 100 % comentada: ninguna línea ejecutable", () => {
    expect(sinComentarios(propuesta).trim()).toBe("");
  });

  it("todo DELETE propuesto protege los saldos con consumo (el detalle FIFO es ON DELETE CASCADE)", () => {
    expect(propuesta).toMatch(/DELETE s FROM saldos_vacaciones s[\s\S]*NOT EXISTS \(SELECT 1 FROM detalle_consumo_vacaciones d WHERE d\.saldo_id = s\.id\)/);
    expect(propuesta).toContain("ON DELETE CASCADE");
    expect(propuesta).toMatch(/NO se borra ninguna vacaciones\/incidencia real/);
  });
});
