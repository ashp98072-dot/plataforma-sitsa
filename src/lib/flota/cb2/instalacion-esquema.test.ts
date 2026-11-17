import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const repo = path.resolve(__dirname, "../../../..");
const leer = (f: string) => readFileSync(path.join(repo, f), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const esperado = (t: string) => t.slice(t.indexOf("-- BEGIN-ESPERADO"), t.indexOf("-- END-ESPERADO"));

it("variante con esquema explícito: sin DATABASE() en el código, solo lectura, mismo bloque de firmas esperadas que el detector original y misma CTE de observación salvo el filtro de esquema", () => {
  const original = leer("sql/preflight-2026-11-cb2-nivel-instalacion.sql"); const variante = leer("sql/preflight-2026-11-cb2-nivel-instalacion-esquema.sql");
  expect(sinComentarios(variante)).not.toContain("DATABASE()"); expect(sinComentarios(variante)).toContain("@esquema");
  expect(sinComentarios(variante)).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|FLUSH|CALL|USE)\b/i);
  expect(esperado(variante)).toBe(esperado(original));   // las firmas esperadas no se duplican con valores distintos
  const cte = (t: string) => t.slice(t.indexOf("-- BEGIN-CTE"), t.indexOf("-- END-CTE"));
  expect(cte(variante)).toBe(cte(original).replaceAll("DATABASE()", "@esquema").replace(" tab AS (SELECT TABLE_NAME t, ENGINE e FROM information_schema.TABLES WHERE TABLE_SCHEMA=@esquema),", " tab AS (SELECT TABLE_NAME t, ENGINE e FROM information_schema.TABLES WHERE TABLE_SCHEMA=@esquema),\n esq AS (SELECT SCHEMA_NAME s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=@esquema AND @esquema IS NOT NULL AND @esquema<>'' AND SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')),"));
  const sha = readFileSync(path.join(repo, "docs/operaciones/cb2-instalacion-minima-20261117/SQL.sha256"), "utf8").split("\n").find((l) => l.endsWith("preflight-2026-11-cb2-nivel-instalacion-esquema.sql"));
  expect(sha?.split(/\s{2}/)[0]).toBe(createHash("sha256").update(variante).digest("hex"));
});
