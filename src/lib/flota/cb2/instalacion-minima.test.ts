import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const repo = path.resolve(__dirname, "../../../..");
const sha = (f: string) => createHash("sha256").update(readFileSync(path.join(repo, f), "utf8").replace(/\r\n/g, "\n")).digest("hex");

it("SQL.sha256 del plan mínimo coincide con los archivos reales (sin saltos CRLF) y el detector/postcheck son de SOLO LECTURA", () => {
  const lines = readFileSync(path.join(repo, "docs/operaciones/cb2-instalacion-minima-20261117/SQL.sha256"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  expect(lines.length).toBe(10);
  for (const l of lines) { const [hash, file] = l.split(/\s{2}/); expect(sha(file), file).toBe(hash); }
  for (const f of ["sql/preflight-2026-11-cb2-nivel-instalacion.sql", "sql/postcheck-2026-11-cb2-nivel-instalacion.sql"]) {
    const texto = readFileSync(path.join(repo, f), "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(texto, f).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|SET\s+GLOBAL|FLUSH|CALL)\b/i);
  }
});
