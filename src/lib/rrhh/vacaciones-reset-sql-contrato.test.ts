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
      "CONTEOS POR EMPRESA", "RESUMEN DE BLOQUEOS", "DUPLICADOS IDENTICOS", "CONJUNTO OBJETIVO DEL RESET", "HARD BLOCKER", "PRECONDICION FUERTE",
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

  it("documenta el orden futuro: backups → validar export → validar preview → transacción → objetivo + hard blockers → detalle → incidencias → vacaciones → saldos → validaciones", () => {
    const orden = [
      "PASO 1 — BACKUPS", "PASO 2 — VALIDAR EL EXPORT HISTORICO Y EL PREVIEW", "START TRANSACTION;", "3.1 CONJUNTO OBJETIVO", "3.2 HARD BLOCKERS",
      "3.3 borrar el DETALLE FIFO", "3.4 borrar las incidencias", "3.5 borrar las vacaciones", "3.6 borrar los saldos", "3.7 NO se toca", "3.8 VALIDACIONES",
      "COMMIT;", "PASO 4 — RECONSTRUCCION POSTERIOR",
    ].map((t) => propuesta.indexOf(t));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it("define el CONJUNTO OBJETIVO (tabla temporal) con pareja inequívoca, sin evidencias ni solicitud, dentro de la empresa y solo vacaciones", () => {
    const bloque = propuesta.slice(propuesta.indexOf("3.1 CONJUNTO OBJETIVO"), propuesta.indexOf("3.2 HARD BLOCKERS"));
    expect(bloque).toContain("CREATE TEMPORARY TABLE tmp_reset_incidencias_objetivo");
    expect(bloque).toContain("i.empresa_id = @empresa_id");
    expect(bloque).toContain("i.tipo IN ('Vacaciones','A cuenta de Vacaciones')");
    expect(bloque).toContain("LOWER(TRIM(v.estado)) = 'aprobado'");
    expect(bloque).toContain("v2.dias_habiles = i.dias_habiles) = 1"); // exactamente 1 vacación para la llave
    expect(bloque).toContain("i2.tipo IN ('Vacaciones','A cuenta de Vacaciones')) = 1"); // exactamente 1 incidencia candidata
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM evidencias_incidencias ev");
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM solicitudes_vacaciones sv");
  });

  it("HARD BLOCKERS antes de cualquier DELETE: total = objetivo, vacaciones = objetivo, export = objetivo, sin protegidas; si falla, ROLLBACK sin borrar nada", () => {
    const bloque = propuesta.slice(propuesta.indexOf("3.2 HARD BLOCKERS"), propuesta.indexOf("3.3 borrar el DETALLE FIFO"));
    for (const t of ["total_incidencias_vacaciones", "total_objetivo", "total_vacaciones", "filas_export_validado", "incidencias_protegidas", "detalle_de_incidencias_no_objetivo", "puede_continuar", "SI puede_continuar = 0", "ROLLBACK", "NO se borra absolutamente nada"]) {
      expect(bloque, t).toContain(t);
    }
    expect(bloque).toContain("= (SELECT COUNT(*) FROM tmp_reset_incidencias_objetivo)");
    expect(bloque).toContain("@filas_export_validado = (SELECT COUNT(*) FROM tmp_reset_incidencias_objetivo)");
    // el gate va ANTES del primer DELETE ejecutable (comentado) de la propuesta
    const primerDelete = propuesta.search(/^--\s+DELETE\s/m);
    expect(primerDelete).toBeGreaterThan(propuesta.indexOf("3.2 HARD BLOCKERS"));
    expect(primerDelete).toBeGreaterThan(propuesta.indexOf("puede_continuar = 0"));
  });

  it("el FIFO SOLO se borra para incidencias del conjunto objetivo; las incidencias solo por ID del conjunto; las vacaciones solo las espejo del objetivo", () => {
    const detalle = propuesta.slice(propuesta.indexOf("3.3 borrar el DETALLE FIFO"), propuesta.indexOf("3.4 borrar las incidencias"));
    expect(detalle).toContain("DELETE d FROM detalle_consumo_vacaciones d");
    expect(detalle).toContain("d.incidencia_id IN (SELECT incidencia_id FROM tmp_reset_incidencias_objetivo)");
    expect(detalle).not.toMatch(/JOIN\s+incidencias/i); // nunca «todas las incidencias de vacaciones»
    const incidencias = propuesta.slice(propuesta.indexOf("3.4 borrar las incidencias"), propuesta.indexOf("3.5 borrar las vacaciones"));
    expect(incidencias).toContain("i.id IN (SELECT incidencia_id FROM tmp_reset_incidencias_objetivo)");
    expect(incidencias).toContain("i.empresa_id = @empresa_id");
    expect(incidencias).toContain("i.tipo IN ('Vacaciones','A cuenta de Vacaciones')");
    const vacaciones = propuesta.slice(propuesta.indexOf("3.5 borrar las vacaciones"), propuesta.indexOf("3.6 borrar los saldos"));
    expect(vacaciones).toContain("v.id IN (SELECT vacacion_id FROM tmp_reset_incidencias_objetivo)");
    expect(vacaciones).toContain("v.empresa_id = @empresa_id");
    expect(propuesta).not.toMatch(/DELETE\s+(\w+\s+)?FROM\s+vacaciones\s+WHERE\s+empresa_id\s*=\s*@empresa_id\s*;/i); // sin DELETE global de vacaciones
    expect(propuesta).not.toMatch(/DELETE\s+(i\s+)?FROM\s+incidencias\s*;/i);
  });

  it("los saldos solo se borran tras comprobar detalle restante = 0 y sin arrastrar detalle por cascada", () => {
    const bloque = propuesta.slice(propuesta.indexOf("3.6 borrar los saldos"), propuesta.indexOf("3.7 NO se toca"));
    expect(bloque).toContain("detalle_restante_en_saldos_de_la_empresa");
    expect(bloque).toContain("NOT EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id)");
    expect(bloque).toContain("s.empresa_id = @empresa_id");
  });

  it("documenta la PRECONDICIÓN FUERTE: el reset no se ejecuta con evidencias, solicitudes, sin pareja, ambiguos, duplicados idénticos o export incompleto", () => {
    const pre = propuesta.slice(propuesta.indexOf("PRECONDICION FUERTE"), propuesta.indexOf("PASO 1 — BACKUPS"));
    for (const t of ["incidencia de vacaciones con evidencia", "incidencia con solicitud ligada", "vacaciones sin incidencia", "incidencias sin vacaciones", "tipo ambiguo", "duplicado identico no resuelto", "export incompleto"]) {
      expect(pre, t).toContain(t);
    }
    expect(propuesta).toContain("EL RESET NO SE EJECUTA");
  });

  it("todos los DELETE van acotados por empresa y por el conjunto objetivo; nunca por 'todas las vacaciones de la empresa'", () => {
    const deletes = propuesta.split("\n").filter((l) => /^--\s+(DELETE\s)/.test(l));
    expect(deletes.length).toBe(4);
    const bloque = propuesta.slice(propuesta.indexOf("START TRANSACTION;"), propuesta.indexOf("COMMIT;"));
    expect(bloque.match(/empresa_id = @empresa_id/g)!.length).toBeGreaterThanOrEqual(10);
    expect((bloque.match(/tmp_reset_incidencias_objetivo/g) ?? []).length).toBeGreaterThanOrEqual(8);
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
