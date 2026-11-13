import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/** El SQL de diagnóstico para Hostinger debe ser estrictamente de lectura (no se ejecuta SQL productivo que escriba). */
describe("sql/diagnostico-2026-11-tms-planes-creacion-bloqueada.sql — solo lectura", () => {
  const texto = readFileSync("sql/diagnostico-2026-11-tms-planes-creacion-bloqueada.sql", "utf8");
  const sinComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n").replace(/'(?:[^']|'')*'/g, "''");
  const sentencias = sinComentarios.split(";").map((s) => s.trim()).filter(Boolean);

  it("toda sentencia empieza con SELECT, SHOW o WITH", () => {
    expect(sentencias.length).toBeGreaterThan(5);
    for (const s of sentencias) expect(s).toMatch(/^(SELECT|SHOW|WITH)\b/i);
  });
  it("no contiene escritura, DDL, bloqueos ni exportación", () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|TRUNCATE|CALL|GRANT|LOCK\s+TABLES|GET_LOCK|FOR\s+UPDATE|LOCK\s+IN\s+SHARE|INTO\s+(OUTFILE|DUMPFILE)|SET\s+GLOBAL)\b/i);
  });
});
