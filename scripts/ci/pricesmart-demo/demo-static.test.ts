// Pruebas ESTÁTICAS del arnés de la demostración API-12 (sin base de datos ni procesos).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { api12DdlStatements } from "./demo.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("API-12 DDL y colección", () => {
  it("el DDL propuesto conserva el SIGNAL de bloqueo; la copia de laboratorio tiene 2 tablas, solo RESTRICT y sin sentencias destructivas", () => {
    const text = read("docs/integraciones/pricesmart/api12/staging-tms-link.sql.in");
    expect(text).toContain("API12_UNRATIFIED_DESIGN_DO_NOT_EXECUTE");
    const st = api12DdlStatements(text); expect(st).toHaveLength(2);
    expect((st.join("\n").match(/ON DELETE RESTRICT/g) ?? []).length).toBe(3);
    expect(() => api12DdlStatements(text.replace("SIGNAL SQLSTATE", "-- SIGNAL"))).toThrow();
    expect(() => api12DdlStatements(`${text}\nDROP TABLE x;`)).toThrow();
  });
  it("la colección Postman es ejecutable, firma con la clave del ENTORNO (no escrita en el repositorio) y cubre POST, GET, idempotencia, aislamiento, cancelación y 401", () => {
    const text = read("docs/integraciones/pricesmart/api12/postman_collection.json"); const col = JSON.parse(text);
    expect(col.item).toHaveLength(7); expect(text).toContain("pm.environment.get('labKey')"); expect(text).not.toMatch(/"labKey"\s*:\s*"[0-9a-f]{16,}/);
    expect(col.item.map((i: { name: string }) => i.name).join("|")).toMatch(/POST[sS]*GET[sS]*idempotente[sS]*aislamiento[sS]*cancelacion[sS]*401/);
  });
  it("el arnés se niega a usarse fuera del sandbox: la app solo recibe la bandera de laboratorio desde demo.mjs", () => {
    const demo = read("scripts/ci/pricesmart-demo/demo.mjs");
    expect(demo).toContain("env.PRICESMART_LAB_DEMO = 'SINTETICO-LOCAL-SIN-PRODUCCION'"); expect(demo).toContain("crypto.randomBytes(32).toString('hex')");
    expect(read("package.json")).not.toMatch(/PRICESMART_LAB/); expect(read(".env.example") ?? "").not.toMatch(/PRICESMART_LAB/);
  });
});
