import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Contratos de seguridad de artefactos pendientes: no importa mysql2 ni ejecuta SQL.
const leer = (n: string) => readFileSync(`sql/retiro-603-${n}.sql`, "utf8").replace(/--[^\n]*/g, "");
const antes = leer("01-preflight"), cambio = leer("02-eliminacion-pendiente"), despues = leer("03-postcheck");
it("preflight y postcheck no contienen DML/DDL ni ejecutan las consultas generadas", () => {
  for (const sql of [antes, despues]) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|EXECUTE|PREPARE|CALL|GRANT|REVOKE)\b(?!_)/i);
});
it("el único borrado es 603/empresa4/placa exacta; no limpia hijos ni modifica otros módulos", () => {
  expect(cambio.match(/\bDELETE\s+FROM\b/gi)).toHaveLength(1);
  expect(cambio).toContain("DELETE FROM flota_vehiculos WHERE id=603 AND empresa_id=4 AND BINARY placa=BINARY 'C-035BXR'");
  expect(cambio).not.toMatch(/\b(UPDATE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\s+(TABLE|DATABASE|PROCEDURE|[a-z_]+)\b/i);
  expect(cambio.match(/\bINSERT\s+INTO\b/gi)).toHaveLength(1);
  expect(cambio).toContain("INSERT INTO auditoria"); expect(cambio).toContain("IF ROW_COUNT()<>1 THEN SIGNAL");
  const borrar = cambio.slice(cambio.indexOf("DELETE FROM flota_vehiculos"), cambio.indexOf("IF ROW_COUNT()"));
  expect(borrar).toContain("AND v_autorizado AND v_tx AND v_sin_escrituras AND v_archivos_revisados AND v_inventario_completo");
  expect(borrar).toContain("a.id=v_auditoria_id");
});
it("no viene armado: cuatro certificaciones falsas y base/actor/huella sin completar", () => {
  for (const v of ["v_autorizado", "v_sin_escrituras", "v_archivos_revisados", "v_inventario_completo"]) {
    expect(cambio).toContain(`DECLARE ${v} BOOLEAN DEFAULT FALSE`); expect(cambio).toContain(`NOT ${v}`);
  }
  for (const v of ["v_esquema", "v_operador", "v_huella_fk"]) expect(cambio).toMatch(new RegExp(`DECLARE ${v} [^;]+ DEFAULT NULL`));
  expect(cambio).not.toMatch(/(?:foreign_key_checks|check_constraint_checks)\s*=\s*0/i);
});
it("errores y warnings abortan la transacción propia, y no revierten una sesión previa", () => {
  expect(cambio).toContain("DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN IF v_tx THEN ROLLBACK; END IF; RESIGNAL; END");
  expect(cambio).toMatch(/DECLARE EXIT HANDLER FOR SQLWARNING\s+BEGIN IF v_tx THEN ROLLBACK;/);
  expect(cambio.indexOf("@@in_transaction<>0")).toBeLessThan(cambio.indexOf("START TRANSACTION;"));
  expect(cambio).toContain("START TRANSACTION;\n  SET v_tx=TRUE;");
});
it("descubre FK y referencias sin FK en todas las empresas, y bloquea cambios de inventario", () => {
  expect(cambio).toContain("IF v_n<>15 THEN SIGNAL"); expect(cambio).toContain("v_huella_fk <=> v_huella_actual");
  expect(cambio).toContain("k.TABLE_SCHEMA<>DATABASE()"); expect(cambio).toContain("FK externa o sin identidad id");
  expect(cambio).toContain("LOWER(c.COLUMN_NAME) LIKE '%vehicul%'"); expect(cambio).toContain("c.COLUMN_NAME='unidad_recurrente_id'");
  expect(cambio).toContain("@ret603_referencias IS NULL OR @ret603_referencias<>0");
  const cursor = cambio.slice(cambio.indexOf("DECLARE c_dependencias"), cambio.indexOf("DECLARE CONTINUE HANDLER"));
  expect(cursor).not.toMatch(/empresa_id\s*=/); expect(cursor).toContain("REFERENCED_COLUMN_NAME='id'");
});
it("revisa JSON/texto/binarios y huella de uploads, sin reescribir evidencia", () => {
  for (const sql of [antes, cambio]) {
    expect(sql).toContain("'longtext','json','tinyblob','blob','mediumblob','longblob'");
    expect(sql).toContain("603([^[:alnum:]]|$)|veh603-doc");
  }
  expect(cambio).not.toMatch(/JSON_(?:SET|REPLACE|REMOVE)\s*\(/i);
});
it("preserva 1297 KT, 13 fondos y una TMS mediante snapshot de todas las columnas", () => {
  expect(cambio).toContain("v_id<>1297 OR v_empresa<>1"); expect(cambio).toContain("IF v_n<>13 THEN SIGNAL");
  expect(cambio).toContain("no hay exactamente una unidad TMS");
  expect(cambio).toContain("ORDER BY ORDINAL_POSITION"); expect(cambio).toContain("JSON_ARRAYAGG(JSON_OBJECT(");
  expect(cambio).toContain("ORDER BY id"); expect(cambio).toContain("v_antes_veh"); expect(cambio).toContain("v_antes_fondos"); expect(cambio).toContain("v_antes_tms");
  expect(cambio).toContain("v_i<3 AND NOT (SHA2(@ret603_snapshot,256) <=> SHA2(");
  expect(cambio.match(/\bCOMMIT\s*;/g)).toHaveLength(1);
  expect(cambio.indexOf("INSERT INTO auditoria")).toBeLessThan(cambio.indexOf("DELETE FROM flota_vehiculos"));
  expect(cambio.indexOf("COMMIT;")).toBeGreaterThan(cambio.indexOf("SET v_fase=v_fase+1"));
});
it("postcheck exige conteos y exportaciones; no limpia el evento nuevo de retiro", () => {
  expect(despues).toContain("WHERE id=603"); expect(despues).toContain("fondos_debe_ser_13");
  expect(despues).toContain("tms_debe_ser_1"); expect(despues).toContain("accion='retiro_duplicado_603'");
});
