import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").split("\r\n").join("\n");
const sinComentarios = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("SQL del reset controlado de vacaciones (preparado; NO ejecutado)", () => {
  const preflight = leer("sql/preflight-reset-vacaciones.sql");
  const propuesta = leer("sql/propuesta-reset-vacaciones.sql");

  it("el preflight es SOLO lectura: ninguna sentencia de escritura ni DDL", () => {
    expect(sinComentarios(preflight)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|REPLACE|RENAME|GRANT)\b/i);
    expect(sinComentarios(preflight)).not.toMatch(/FOREIGN_KEY_CHECKS/i);
    const sinLiterales = sinComentarios(preflight).replace(/'[^']*'/g, "''"); // los textos pueden contener «;»
    const sentencias = sinLiterales.split(";").map((s) => s.trim()).filter(Boolean);
    expect(sentencias.length).toBeGreaterThan(10);
    for (const s of sentencias) expect(s, s.slice(0, 60)).toMatch(/^(SELECT|\()/i);
  });

  it("el preflight reporta todo lo pedido", () => {
    for (const parte of [
      "conteos", "backup_saldos_vacaciones_20261006", "bk_reset_<TS>_*", "RECONSTRUIBLE", "NO SE TOCA",
      "CUALQUIER FK QUE IMPIDA EL RESET", "BLOQUEA EL RESET", "information_schema.REFERENTIAL_CONSTRAINTS",
      "VACACION_SIN_INCIDENCIA", "INCIDENCIA_SIN_VACACION", "TIPO_AMBIGUO", "INCIDENCIAS_CANTIDAD_DISTINTA",
      "detalle sin incidencia", "detalle sin saldo", "i.tipo NOT IN ('Vacaciones','A cuenta de Vacaciones')",
      "SALDOS CON CONSUMO", "SOLICITUDES ACTIVAS", "EVIDENCIAS", "e.fecha_alta < '1980-01-01'", "fecha_alta <> e.fecha_inicio_laboral",
      "CONTEOS POR EMPRESA", "RESUMEN DE BLOQUEOS",
    ]) expect(preflight, parte).toContain(parte);
  });

  it("el preflight acota por empresa los conteos por empresa y usa el mismo criterio de pareja que la exportación", () => {
    const porEmpresa = preflight.slice(preflight.indexOf("CONTEOS POR EMPRESA"));
    expect(porEmpresa).toContain("v.empresa_id = e.id");
    expect(porEmpresa).toContain("s.empresa_id = e.id");
    expect(preflight).toContain("v.fecha_inicio = g.fecha_inicio AND v.fecha_fin = g.fecha_fin AND v.dias_habiles = g.dias_habiles");
  });

  it("la propuesta está 100 % comentada: ninguna línea ejecutable", () => {
    expect(sinComentarios(propuesta).trim()).toBe("");
  });

  it("la propuesta NO usa TRUNCATE ni FOREIGN_KEY_CHECKS=0 (solo los menciona para prohibirlos)", () => {
    expect(propuesta).not.toMatch(/^--\s*(TRUNCATE\s+(TABLE\s+)?\w+|SET\s+FOREIGN_KEY_CHECKS\s*=\s*0)/im);
    expect(propuesta).toContain("NO TRUNCATE");
    expect(propuesta).toContain('NO "SET FOREIGN_KEY_CHECKS = 0"');
    expect(propuesta).not.toMatch(/TRUNCATE\s+(TABLE\s+)?incidencias/i);
  });

  it("documenta el orden futuro pedido: backups → validar export → validar preview → transacción → detalle → incidencias de vacaciones → vacaciones → saldos → reconstrucción", () => {
    const orden = [
      "PASO 1 — BACKUPS", "PASO 2 — VALIDAR EL EXPORT HISTORICO Y EL PREVIEW", "START TRANSACTION;", "3.1 borrar el DETALLE FIFO",
      "3.2 borrar UNICAMENTE incidencias de vacaciones", "3.3 borrar las vacaciones", "3.4 borrar los saldos", "3.5 NO se toca", "3.6 VALIDACIONES",
      "COMMIT;", "PASO 4 — RECONSTRUCCION POSTERIOR",
    ].map((t) => propuesta.indexOf(t));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("solo se borran incidencias de vacaciones reconstruibles (con pareja, sin evidencias ni solicitudes); nunca otros tipos; sin DELETE global", () => {
    const bloque = propuesta.slice(propuesta.indexOf("3.2 borrar UNICAMENTE"), propuesta.indexOf("3.3 borrar las vacaciones"));
    expect(bloque).toContain("i.tipo IN ('Vacaciones','A cuenta de Vacaciones')");
    expect(bloque).toContain("i.empresa_id = @empresa_id");
    expect(bloque).toContain("EXISTS (SELECT 1 FROM vacaciones v");
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM evidencias_incidencias ev");
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM solicitudes_vacaciones sv");
    expect(propuesta).not.toMatch(/DELETE\s+(i\s+)?FROM\s+incidencias\s*;/i);
    // ningún DELETE de la propuesta toca empleados, solicitudes ni evidencias
    expect(propuesta).not.toMatch(/DELETE\s+(\w+\s+)?FROM\s+(empleados|solicitudes_vacaciones|evidencias_incidencias)\b/i);
  });

  it("todos los DELETE van acotados por empresa y el borrado de saldos nunca arrastra detalle por cascada", () => {
    const deletes = propuesta.split("\n").filter((l) => /DELETE\s/.test(l) && !/NO borrar/i.test(l));
    expect(deletes.length).toBeGreaterThanOrEqual(4);
    const bloque = propuesta.slice(propuesta.indexOf("START TRANSACTION;"), propuesta.indexOf("COMMIT;"));
    expect(bloque.match(/empresa_id = @empresa_id/g)!.length).toBeGreaterThanOrEqual(8);
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id)");
    expect(bloque).toContain("detalle_restante_en_saldos_de_la_empresa");
  });

  it("verifica que no cambian las otras incidencias, los empleados ni las solicitudes", () => {
    for (const v of ["otras_incidencias_antes", "otras_incidencias_despues", "empleados_antes", "empleados_despues", "solicitudes_antes", "solicitudes_despues", "respaldo_intacto"]) {
      expect(propuesta, v).toContain(v);
    }
  });

  it("los respaldos son separados, uno por tabla, y no tocan backup_saldos_vacaciones_20261006", () => {
    for (const t of ["vacaciones", "incidencias_vacaciones", "detalle_consumo_vacaciones", "saldos_vacaciones", "solicitudes_vacaciones"]) {
      expect(propuesta, t).toContain(`bk_reset_<TS>_${t}`);
    }
    expect(propuesta).toContain("NO se sobrescribe backup_saldos_vacaciones_20261006");
    expect(propuesta).not.toMatch(/(DROP|CREATE OR REPLACE|DELETE|TRUNCATE)[^\n]*backup_saldos_vacaciones_20261006/i);
  });

  it("no repara a Elisa ni a Amílcar", () => {
    expect(propuesta).toContain("NO reparar a Elisa (id 37) ni a Amilcar (id 14)");
    expect(sinComentarios(propuesta)).not.toMatch(/UPDATE\s+empleados/i);
  });
});
