import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "../../../..");
const DIR = "docs/operaciones/cb2-cierre-20261116";
const leer = (f: string) => readFileSync(path.join(repo, DIR, f), "utf8").replace(/\r\n/g, "\n");
const codigo = (t: string) => t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
const paquetes = [["10-preflight-shell.sql", "10-preflight-shell-esquema.sql"], ["10-preflight-fondos.sql", "10-preflight-fondos-esquema.sql"]] as const;

describe("variantes de preflight con esquema explícito (Shell y Fondos)", () => {
  it.each(paquetes)("%s → %s: solo lectura, sin DATABASE(), con @esquema y SHOW GRANTS; las validaciones de columnas e índices son IDÉNTICAS a las originales salvo el filtro de esquema", (orig, vari) => {
    const o = codigo(leer(orig)); const v = codigo(leer(vari)); const texto = v.join("\n");
    expect(texto).not.toContain("DATABASE()"); expect(texto).toContain("@esquema"); expect(texto).toMatch(/^SET @esquema = '[A-Za-z0-9_]+';/m); expect(texto).toContain("SHOW GRANTS;");
    expect(texto).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT\s+[A-Z]|REVOKE|FLUSH|CALL|USE)\b/i);
    const original = (n: number) => o[n]; const igual = (a: string, b: string) => expect(a).toBe(b.replaceAll("DATABASE()", "@esquema"));
    const columnas = o.find((l) => l.startsWith("WITH requeridas"))!; const indices = o.find((l) => l.startsWith("WITH requeridos"))!;
    igual(v.find((l) => l.startsWith("WITH requeridas"))!, columnas); igual(v.find((l) => l.startsWith("WITH requeridos"))!, indices);   // columnas, tipos, nulabilidad, motor e índices: idénticos
    const nuevas = original(o.findIndex((l) => l.includes("information_schema.TABLES") && l.startsWith("SELECT TABLE_NAME FROM"))); const fks = o.find((l) => l.includes("REFERENTIAL_CONSTRAINTS"))!;
    expect(v.find((l) => l.startsWith("SELECT TABLE_NAME FROM"))!.startsWith(nuevas.replaceAll("DATABASE()", "@esquema").slice(0, -1))).toBe(true);   // objetos nuevos: misma consulta + fila ESQUEMA_INVALIDO
    expect(v.find((l) => l.includes("REFERENTIAL_CONSTRAINTS"))!.startsWith(fks.replaceAll("DATABASE()", "@esquema").slice(0, -1))).toBe(true);
  });
  it("el paquete #629 no cambia: los 20-instalar-* y los postchecks siguen con sus mismos SHA-256 y las variantes están registradas en SQL.sha256", () => {
    const lineas = leer("SQL.sha256").split("\n").filter(Boolean); const por = new Map(lineas.map((l) => { const [h, f] = l.split(/\s{2}/); return [f, h] as const; }));
    for (const [f, h] of por) expect(createHash("sha256").update(leer(f)).digest("hex"), f).toBe(h);
    for (const f of ["10-preflight-shell-esquema.sql", "10-preflight-fondos-esquema.sql", "10-preflight-shell.sql", "10-preflight-fondos.sql", "20-instalar-shell.sql", "20-instalar-fondos.sql", "30-postcheck-shell.sql", "30-postcheck-fondos.sql"]) expect(por.has(f), f).toBe(true);
    expect(lineas).toHaveLength(12);
  });
});
