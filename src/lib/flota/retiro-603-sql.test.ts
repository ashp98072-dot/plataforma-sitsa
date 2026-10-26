import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { compararInventarios603, resumirInventario603, type FilaFk } from "../../../scripts/retiro-603-inventario";

const leer = (n: string) => readFileSync(`sql/retiro-603-${n}.sql`, "utf8").replace(/--[^\n]*/g, "");
const antes = leer("01-preflight"), despues = leer("03-postcheck");
const fila = (patch: Partial<FilaFk> = {}): FilaFk => ({ constraint_schema: "novalvion", table_schema: "novalvion", table_name: "dependencia",
  constraint_name: "fk_vehiculo", column_name: "vehiculo_id", ordinal_position: 1, position_in_unique_constraint: 1,
  referenced_table_schema: "novalvion", referenced_table_name: "flota_vehiculos", referenced_column_name: "id",
  unique_constraint_schema: "novalvion", unique_constraint_name: "PRIMARY", match_option: "NONE", update_rule: "RESTRICT", delete_rule: "RESTRICT", ...patch });
const compuesto = () => [fila({ column_name: "empresa_id", referenced_column_name: "empresa_id", unique_constraint_name: "uq_empresa_id" }),
  fila({ ordinal_position: 2, position_in_unique_constraint: 2, unique_constraint_name: "uq_empresa_id" })];

it("no entrega el mutador anterior ni otro SQL DML de retiro", () => {
  expect(existsSync("sql/retiro-603-02-eliminacion-pendiente.sql")).toBe(false);
  expect(readdirSync("sql").filter(p => p.startsWith("retiro-603-") && p.endsWith(".sql")).sort())
    .toEqual(["retiro-603-01-preflight.sql", "retiro-603-03-postcheck.sql"]);
  for (const sql of [antes, despues]) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|EXECUTE|PREPARE|CALL|COMMIT|ROLLBACK|GRANT|REVOKE)\b(?!_)/i);
});
it("excluye solo la fila 603 del esquema objetivo en ambos barridos, nunca una tabla completa", () => {
  const exclusion = "IF(c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='flota_vehiculos',' AND `id`<>603','')";
  expect(antes.split(exclusion)).toHaveLength(3);
  expect(antes).not.toMatch(/(?:TABLE_NAME|table_name)\s*(?:<>|NOT IN)/i);
  expect(antes).not.toMatch(/empresa_id\s*=/i);
  expect(antes).toContain("SELECT * FROM flota_vehiculos WHERE id IN (603,1297)");
});
it("no descarta accesos, documentos ni auditoría y descubre tablas con FK de otros esquemas", () => {
  expect(antes).toContain("k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME");
  expect(antes).toContain("k.REFERENCED_TABLE_SCHEMA=DATABASE()");
  expect(antes).toContain("c.DATA_TYPE IN ('char','varchar','tinytext','text','mediumtext','longtext','json','tinyblob','blob','mediumblob','longblob')");
  expect(antes).not.toMatch(/(?:TABLE_NAME|table_name)\s+IN\s*\(/i);
  expect(antes).toContain("603([^[:alnum:]]|$)|veh603-doc");
});
it("cuenta columnas y restricciones por separado sin exigir 15 restricciones ni agregar JSON en servidor", () => {
  expect(antes).toContain("cantidad_columnas_fk"); expect(antes).toContain("cantidad_restricciones_fk");
  expect(antes).toContain("GROUP BY CONSTRAINT_SCHEMA,TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME");
  expect(antes).not.toMatch(/JSON_ARRAYAGG\s*\(/i); expect(antes).toContain("LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS");
  for (const campo of ["ORDINAL_POSITION", "POSITION_IN_UNIQUE_CONSTRAINT", "REFERENCED_TABLE_SCHEMA", "REFERENCED_TABLE_NAME", "UNIQUE_CONSTRAINT_NAME", "MATCH_OPTION"]) expect(antes).toContain(campo);
});
it("postcheck no autoriza excepciones históricas por tabla ni permite reescribirlas", () => {
  expect(readFileSync("sql/retiro-603-03-postcheck.sql", "utf8")).toContain("Ninguna excepción está aprobada hoy");
  expect(despues).toContain("WHERE id=603"); expect(despues).toContain("fondos_debe_ser_13"); expect(despues).toContain("tms_debe_ser_1");
});
it("diseño está bloqueado sin instrucciones DML para armarlo", () => {
  const diseno = readFileSync("sql/retiro-603-02-diseno-no-ejecutable.md", "utf8");
  expect(diseno).toContain("BLOQUEADO"); expect(diseno).toContain("No se entrega una sentencia de eliminación");
  expect(diseno).not.toMatch(/DELETE\s+FROM|INSERT\s+INTO|START\s+TRANSACTION|COMMIT\s*;/i);
});
it("15 filas pueden ser 14 restricciones: cuenta una FK compuesta una sola vez", () => {
  const rows = [...Array.from({ length: 13 }, (_, i) => fila({ constraint_name: `simple${i}` })), ...compuesto()];
  expect(resumirInventario603(rows, "novalvion")).toMatchObject({ cantidadColumnasFk: 15, cantidadRestriccionesFk: 14, retiroHabilitado: false });
});
it("misma restricción nominal en otras tablas/esquemas no se fusiona", () => {
  const r = resumirInventario603([fila(), fila({ table_name: "otra" }), fila({ constraint_schema: "externo", table_schema: "externo" })], "novalvion");
  expect(r.cantidadRestriccionesFk).toBe(3);
});
it("la huella no depende del orden del exportador ni de sus claves de objeto", () => {
  const original = compuesto(); const reordenado = [...original].reverse().map(r => Object.fromEntries(Object.entries(r).reverse()));
  expect(resumirInventario603(original, "novalvion").huella).toBe(resumirInventario603(reordenado, "novalvion").huella);
});
it("cambiar emparejamiento u orden de una FK compuesta cambia la huella", () => {
  const a = compuesto(); const b = a.map(r => ({ ...r, ordinal_position: 3 - r.ordinal_position }));
  expect(compararInventarios603(a, b, "novalvion").coincide).toBe(false);
});
it.each(["delete_rule", "update_rule", "referenced_column_name", "unique_constraint_name", "position_in_unique_constraint"] as const)("la huella detecta cambio en %s", campo => {
  const a = fila(); const b = { ...a, [campo]: campo === "position_in_unique_constraint" ? 2 : "CAMBIADO" };
  expect(compararInventarios603([a], [b], "novalvion").coincide).toBe(false);
});
it("inventario incompleto, duplicado, sin reglas o con destino distinto no se certifica", () => {
  for (const datos of [[], [fila(), fila()], [fila({ ordinal_position: 2 })], [{ ...fila(), delete_rule: null }],
    [{ ...fila(), position_in_unique_constraint: null }], [fila({ referenced_table_schema: "otro" })]]) {
    expect(() => resumirInventario603(datos, "novalvion")).toThrow();
  }
});
it("incluso un manifiesto idéntico no habilita retiro ni afirma validación MariaDB", () => {
  expect(compararInventarios603(compuesto(), compuesto(), "novalvion")).toMatchObject({ coincide: true, retiroHabilitado: false });
});
