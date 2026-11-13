// Pruebas ESTÁTICAS de API-11: rutas solo delegan, runtime cerrado por defecto, DDL de seguridad derivable, documentos coherentes y guardas del ejecutor.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handlePriceSmart, installPriceSmartHandler } from "../../../src/lib/integrations/pricesmart/runtime";
import { SEC_TABLES, securityDdlStatements, securitySeedStatements } from "./ddl.mjs";
import { API11_BRANCH, ACK_ENV, ACK_PHRASE, REQUIRED_CASES, assertGate, evaluateRun } from "./run-windows.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const DOC = "docs/integraciones/pricesmart/api11";

describe("API-11 runtime y rutas", () => {
  it("sin composición instalada responde 503 DISABLED, y una excepción del manejador también", async () => {
    installPriceSmartHandler(null);
    const r = await handlePriceSmart(new Request("http://localhost/api/integrations/pricesmart/v1/orders", { method: "POST", body: "{}" }));
    expect(r.status).toBe(503); expect(((await r.json()) as { code: string }).code).toBe("DISABLED");
    installPriceSmartHandler(async () => { throw new Error("boom con SQL"); });
    const e = await handlePriceSmart(new Request("http://localhost/x")); expect(e.status).toBe(503); expect(JSON.stringify(await e.json())).not.toContain("boom");
    installPriceSmartHandler(null);
    expect(() => installPriceSmartHandler("x" as never)).toThrow();
  });
  it("las tres rutas solo importan runtime.ts, no leen el entorno ni abren conexiones", () => {
    for (const f of ["orders/route.ts", "orders/[externalOrderId]/route.ts", "orders/[externalOrderId]/cancellation-requests/route.ts"]) {
      const text = read(`src/app/api/integrations/pricesmart/v1/${f}`);
      expect(text).toMatch(/^import \{ handlePriceSmart \} from "@\/lib\/integrations\/pricesmart\/runtime";/);
      expect(text).not.toMatch(/process\.env|mysql|getPool|OrderApplication|createIsolated|PRICESMART_ENABLED/);
    }
    const runtime = read("src/lib/integrations/pricesmart/runtime.ts"); expect(runtime).not.toMatch(/process\.env|mysql/); expect(runtime.match(/^import .* from '.*';/gm)).toEqual(["import { autoInstallLabDemo } from './lab-demo/autoinstall';", "import { installPriceSmartHandler, isPriceSmartHandlerInstalled, state, type PriceSmartHandler } from './runtime-state';"]);   // API-15: el estado del handler vive en runtime-state.ts (módulo puro)
  });
});

describe("API-11 DDL de seguridad y documentos", () => {
  it("el DDL propuesto conserva el SIGNAL de bloqueo y la copia de laboratorio tiene exactamente 4 tablas sin secretos", () => {
    const text = read(`${DOC}/staging-security.sql.in`);
    expect(text).toContain("API11_UNRATIFIED_DESIGN_DO_NOT_EXECUTE");
    expect(securityDdlStatements(text)).toHaveLength(4);
    expect(SEC_TABLES).toEqual(["ps_api11_integrations", "ps_api11_revocations", "ps_api11_rate_counters", "ps_api11_proof_claims"]);
    expect(() => securityDdlStatements(text.replace("SIGNAL SQLSTATE", "-- SIGNAL"))).toThrow();
    expect(securitySeedStatements().join("\n")).not.toMatch(/password|secret|token/i);
  });
  it("OpenAPI y Postman son JSON válido, no ejecutables, sin secretos y con lo pendiente declarado", () => {
    const spec = JSON.parse(read(`${DOC}/openapi.draft.json`)); const col = JSON.parse(read(`${DOC}/postman_collection.json`));
    expect(spec["x-default-enabled"]).toBe(false); expect(spec["x-executable"]).toBe(false); expect(spec["x-next-routes-installed"]).toBe(true); expect(spec.servers).toEqual([]);
    expect(spec.components.securitySchemes).toBeUndefined();
    expect(Object.keys(spec.paths)).toHaveLength(3); expect(spec["x-api11"].pending.length).toBeGreaterThanOrEqual(5);
    expect(col.item).toHaveLength(3); expect(JSON.stringify(col)).not.toMatch(/Bearers|password/i);
    expect(col.variable.find((v: { key: string }) => v.key === "evidence").value).toBe("");
  });
});

describe("API-11 ejecutor", () => {
  const ok = { argv: ["--run-isolated"], env: { [ACK_ENV]: ACK_PHRASE }, platform: "win32", branch: API11_BRANCH, envFilesInCwd: [] as string[] };
  it("exige modo, plataforma, rama, entorno limpio y confirmación", () => {
    expect(assertGate(ok)).toBe("--run-isolated");
    expect(() => assertGate({ ...ok, argv: [] })).toThrow(); expect(() => assertGate({ ...ok, platform: "linux" })).toThrow(); expect(() => assertGate({ ...ok, branch: "main" })).toThrow();
    expect(() => assertGate({ ...ok, env: {} })).toThrow(); expect(() => assertGate({ ...ok, envFilesInCwd: [".env"] })).toThrow();
  });
  it("evaluateRun solo da PASS con los 13 casos pasados y sin omitidos", () => {
    const mk = (skip?: string) => ({ testResults: [{ assertionResults: REQUIRED_CASES.map((c) => ({ title: `${c} x`, status: c === skip ? "skipped" : "passed" })) }], numTotalTests: 13 });
    expect(evaluateRun({ status: 0 }, mk()).state).toBe("PASS"); expect(evaluateRun({ status: 0 }, mk("API11.3")).state).not.toBe("PASS"); expect(evaluateRun(null, null).state).toBe("INCOMPLETO");
  });
});
