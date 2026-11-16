// PRICESMART-API-27 — el contrato de la orden COMPILADO desde un diccionario declarativo (D06: mecanismo, no contrato definitivo) contra MariaDB 11.8.9 real, con la composición de homologación y las cuentas de MÍNIMO
// privilegio de API-26 (`demo.mjs prepare-homologation`). Prueba el circuito completo (recepción → outbox → solicitud del TMS) con `lab-demo-1` expresado como datos, la idempotencia por identidad de contenido
// normalizada, los límites en el borde (nada se escribe cuando se rechaza) y el aislamiento entre credenciales. Verificador/cifrado son dobles de prueba; no hay acceso externo. Solo se ejecuta desde demo.mjs.
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sandboxPool } from "@/lib/sandbox-db";
import { createHomologationRuntime, fileKillSwitch, type HomologationRuntime } from "../../../src/lib/integrations/pricesmart/homologation/runtime";
import { installControlledRuntime } from "../../../src/lib/integrations/pricesmart/runtime-assembly";
import { handlePriceSmart, installPriceSmartHandler } from "../../../src/lib/integrations/pricesmart/runtime";
import { ENABLE_ACK } from "../../../src/lib/integrations/pricesmart/runtime-config";
import { labObservations } from "../../../src/lib/integrations/pricesmart/lab-demo/contract";
import { labCipher, labEvidencePort, labVerifier } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-crypto";
import { compileContractDictionary, LAB_DEMO_DICTIONARY } from "../../../src/lib/integrations/pricesmart/order-contract-dictionary";
import { TMS_LIMITS } from "../../../src/lib/integrations/pricesmart/tms-contract-proposal";
import { BASE, CLUB, connect, empresas, evidence, labKey, labOrder, state, uid, type Key, type Row } from "./e2e-support";

type Account = { user: string; password: string };
const homolog = (state.demo as unknown as { homolog: { names: { schema: string }; app: Account; worker: Account } }).homolog;
const schema = homolog.names.schema; const API = "/api/integrations/pricesmart/v1/orders";
let ctx: Awaited<ReturnType<typeof connect>>; let runtime: HomologationRuntime; const raws: mysql.Pool[] = [];
const rawPool = (a: Account) => { const p = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: a.user, password: a.password, database: schema, connectionLimit: 10 }); raws.push(p); return sandboxPool(p); };
const compiled = compileContractDictionary(LAB_DEMO_DICTIONARY, { ratifiedDecisions: [], refinements: [{ message: "los datos no caben en las observaciones de la solicitud del TMS", test: (o) => labObservations(`[PS:${"0".repeat(32)}]`, o as never).length <= TMS_LIMITS.notesMax }] });
const env = { NODE_ENV: "production", NOVALVION_ENV: "sandbox", PRICESMART_RUNTIME_MODE: "ENABLED", PRICESMART_RUNTIME_ACK: ENABLE_ACK, PRICESMART_RUNTIME_ENVIRONMENT: "sandbox", PRICESMART_ORIGIN_CLUB: CLUB, PRICESMART_DB_SCHEMA: schema,
  PRICESMART_DB_RUNTIME_USER: homolog.app.user, PRICESMART_RATIFIED_DECISIONS: "D02,D06,D08,D09,D12", PRICESMART_RATE_PER_WINDOW: "5000", PRICESMART_RATE_WINDOW_MS: "60000" };

async function sendRaw(method: "GET" | "POST", p: string, op: "orders:create" | "orders:read", key: Key | string, id: string, bytes: Uint8Array): Promise<{ status: number; json: Row }> {
  const headers: Record<string, string> = { accept: "application/json" }; if (method === "POST") headers["content-type"] = "application/json";
  headers["x-lab-evidence"] = evidence(key as Key, op, id, bytes);
  const res = await handlePriceSmart(new Request(`${BASE}${p}`, { method, headers, body: method === "POST" ? Buffer.from(bytes) : undefined }));
  return { status: res.status, json: (await res.json()) as Row };
}
const post = (key: Key | string, id: string, body: unknown) => sendRaw("POST", API, "orders:create", key, id, new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body)));
const get = (key: Key | string, id: string) => sendRaw("GET", `${API}/${id}`, "orders:read", key, id, new Uint8Array(0));
const A = () => empresas.a.empresaId;
const cycle = async (c: { runOnce(): Promise<unknown> }) => { try { await c.runOnce(); } catch (e) { if (!["RETRYABLE", "UNAVAILABLE"].includes((e as { code?: string }).code ?? String((e as Error).message))) throw e; } };
const orders = (id: string) => ctx.count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [A(), Buffer.from(id)]);
const solicitudes = (id: string) => ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id]);
async function drain(ids: string[]) {
  for (let i = 0; i < 40; i++) {
    await cycle(runtime.consumer);
    const open = await ctx.count("SELECT COUNT(*) n FROM ps_api01_outbox o JOIN ps_api01_orders r ON r.id = o.order_id WHERE r.external_order_id IN (?) AND o.status IN ('PENDING','LEASED')", [ids.map((x) => Buffer.from(x))]); if (!open) return;
    await ctx.db.query("UPDATE ps_api01_outbox SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING'").catch(() => undefined); await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING' AND lease_until IS NULL").catch(() => undefined);
  }
}
beforeAll(async () => {
  ctx = await connect(); const kill = path.join(mkdtempSync(path.join(os.tmpdir(), "ps-dict-")), "killswitch"); writeFileSync(kill, "ON\n");
  runtime = createHomologationRuntime({ pool: rawPool(homolog.app), workerPool: rawPool(homolog.worker), schema, runtimeUser: homolog.app.user, workerUser: homolog.worker.user, evidence: labEvidencePort(), verifier: labVerifier(labKey), cipher: labCipher(labKey), contract: compiled.contract, killSwitch: fileKillSwitch(kill) });
  const report = await installControlledRuntime(env, runtime.ports); if (!report.ready) throw new Error(JSON.stringify(report));
});
afterAll(async () => { runtime?.consumer.stop(); installPriceSmartHandler(null); await ctx.db.end(); for (const r of raws) await r.end(); });

describe("API-27 contrato compilado desde diccionario (MariaDB real, cuentas mínimas)", () => {
  it("C1 circuito completo: 12 órdenes SIMULTÁNEAS con el contrato declarativo se reciben (202), el consumidor crea UNA solicitud del TMS por orden con el destinatario y la dirección completos", async () => {
    const ids = Array.from({ length: 12 }, () => uid()); const sent = await Promise.all(ids.map((id) => post("a", id, labOrder(id, { recipient: { name: `Destinatario ${id}` }, notes: "entregar por el portón" }))));
    expect(sent.map((s) => s.status), JSON.stringify(sent.find((s) => s.status !== 202)?.json)).toEqual(Array(12).fill(202)); await drain(ids);
    for (const id of ids) { expect(await solicitudes(id), id).toBe(1); const [row] = await ctx.rows("SELECT observaciones FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id]); expect(String(row.observaciones)).toContain(`destinatario Destinatario ${id}`); expect(String(row.observaciones)).toContain("entregar por el portón"); }
  }, 240000);

  it("C2 idempotencia por identidad de contenido NORMALIZADA: reenviar con espacios sobrantes y acento descompuesto es la MISMA orden (1 orden, 1 solicitud); otro contenido → 409; el estado no cambia", async () => {
    const id = uid(); expect((await post("a", id, labOrder(id, { recipient: { name: "José Pérez" } }))).status).toBe(202);
    const same = await Promise.all([post("a", id, labOrder(id, { recipient: { name: "  Jose\u0301 Pe\u0301rez  " } })), post("a", id, labOrder(id, { recipient: { name: "José Pérez" } }))]); expect(same.map((r) => r.status)).toEqual([202, 202]);
    await drain([id]); expect(await orders(id)).toBe(1); expect(await solicitudes(id)).toBe(1);
    for (const patch of [{ address: "Otra dirección ficticia 9" }, { deliveryDate: "2031-01-01" }, { notes: "otra" }, { recipient: { name: "Otra Persona" } }]) expect((await post("a", id, labOrder(id, patch))).status, JSON.stringify(patch)).toBe(409);
    expect(await orders(id)).toBe(1);
  }, 120000);

  it("C3 LÍMITES en el borde: campos desconocidos, controles, caracteres de suplantación, longitudes (puntos de código), fecha inexistente, claves duplicadas y cuerpo sobredimensionado → 400/413 y NO se escribe NADA", async () => {
    const cases: Array<[string, unknown, number]> = [
      ["campo desconocido", labOrder("x", { extra: 1 }), 400], ["destinatario con control", labOrder("x", { recipient: { name: "A\u0000B" } }), 400], ["destinatario con salto de línea", labOrder("x", { recipient: { name: "A\nB" } }), 400],
      ["destinatario con inversión bidi", labOrder("x", { recipient: { name: "A\u202EB" } }), 400], ["destinatario de 201", labOrder("x", { recipient: { name: "a".repeat(201) } }), 400], ["destinatario de 201 emojis", labOrder("x", { recipient: { name: "😀".repeat(201) } }), 400],
      ["dirección de 301", labOrder("x", { address: "d".repeat(301) }), 400], ["fecha inexistente", labOrder("x", { deliveryDate: "2027-02-29" }), 400], ["fecha con formato libre", labOrder("x", { deliveryDate: "01/12/2026" }), 400],
      ["versión de esquema distinta", labOrder("x", { schemaVersion: "lab-demo-2" }), 400],
    ];
    for (const [name, body, status] of cases) {
      const id = uid(); const b = { ...(body as Record<string, unknown>), externalOrderId: id };
      const r = await post("a", id, b); expect(r.status, name).toBe(status); expect(await orders(id), name).toBe(0); expect(await solicitudes(id), name).toBe(0);
    }
    const dup = uid(); const dupBody = `{"schemaVersion":"lab-demo-1","externalOrderId":"${dup}","externalOrderId":"${dup}","originClubReference":"${CLUB}","recipient":{"name":"A"},"address":"x","deliveryDate":"2031-01-01"}`;
    expect((await post("a", dup, dupBody)).status).toBe(400); expect(await orders(dup)).toBe(0);
    const big = uid(); const bigResult = await post("a", big, labOrder(big, { notes: "n".repeat(70000) })).then((r) => r.status, (e: { code?: string }) => e.code ?? "THROWN"); expect([400, 413, "TOO_LARGE"]).toContain(bigResult); expect(await orders(big)).toBe(0);   // el cuerpo de 70 kB se corta ya al firmar/recibir: nunca llega a la base
  }, 120000);

  it("C4 aislamiento: la orden creada con la credencial «a» no es visible con la credencial «b» (404) ni crea nada en su empresa, y la respuesta no confirma entrega", async () => {
    const id = uid(); expect((await post("a", id, labOrder(id))).status).toBe(202); await drain([id]);
    const own = await get("a", id); expect(own.status).toBe(200); expect(own.json).toMatchObject({ confirmsDelivery: false }); const other = await get("b", id); expect([403, 404]).toContain(other.status);
    expect(await ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.b.empresaId, id])).toBe(0);
  }, 120000);
});
