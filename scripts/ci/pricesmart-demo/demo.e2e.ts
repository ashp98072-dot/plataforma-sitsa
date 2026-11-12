// PRICESMART-DEMO (API-12) — prueba COMPLETA de principio a fin contra la app real (`next dev`) y MariaDB 11.8.9 real, desechable, con datos ficticios:
// POST de orden → persistencia → bandeja operativa del TMS → GET del estado → idempotencia → aislamiento entre empresas → cancelación segura → concurrencia → autenticación.
// Solo se ejecuta desde demo.mjs (usa el mismo entorno sandbox que la app). El verificador de autenticación es el de LABORATORIO (HMAC con la clave del run), no el definitivo (D02).
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";
import { getPool } from "@/lib/db";
import { crearSolicitudCliente } from "@/lib/tms/solicitudes-cliente";
import { programarSolicitud, tomarEnRevisionSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";
import { mariaDbOrderRepository } from "../../../src/lib/integrations/pricesmart/mariadb-repository";
import { labContract } from "../../../src/lib/integrations/pricesmart/lab-demo/contract";
import { labCipher } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-crypto";
import { claimMarker, createTmsLinker } from "../../../src/lib/integrations/pricesmart/lab-demo/tms-link";
import { requestBindingDigest } from "../../../src/lib/integrations/pricesmart/m2m-security";
import type { Operation } from "../../../src/lib/integrations/pricesmart/security-contracts";

type State = { app: { port: number }; demo: { labKey: string; empresas: Record<"a" | "b", { empresaId: number; clienteId: number; slug: string }>; staff: { id: number; username: string } } };
const runDir = String(process.env.PS_DEMO_RUNDIR);
const state = JSON.parse(readFileSync(path.join(runDir, "state.json"), "utf8")) as State;
const BASE = `http://127.0.0.1:${state.app.port}`;
const API = `${BASE}/api/integrations/pricesmart/v1/orders`;
const { labKey, empresas, staff } = state.demo;
const INTEGRATION = "pricesmart-lab"; const CLUB = "QA-CLUB";
type Key = "a" | "b" | "c" | "d" | "rev" | "ghost";
/** Alcance (tenant, cliente) de cada credencial de laboratorio. c y d están en la empresa A y COMPARTEN cliente y usuario de servicio TMS con a. */
const scopeOf = (k: Key) => ({ tenantId: k === "b" ? empresas.b.empresaId : empresas.a.empresaId, clientId: k === "c" ? 2 : k === "d" ? 3 : 1 });
type Row = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

let db: mysql.Connection; let cookie = "";
beforeAll(async () => {
  db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  cookie = `${SESSION_COOKIE}=${await createSessionToken({ id: staff.id, username: staff.username, rol: "Admin", nombre: "Operaciones Ficticio", accesoTodas: true })}`;
});
afterAll(async () => { await db.end(); });
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p))[0] as Row[];
const count = async (sql: string, p: unknown[] = []) => Number((await rows(sql, p))[0].n);

// ---- cliente de laboratorio (firma HMAC + prueba ligada a la solicitud)
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
type Over = { proofId?: string; tamper?: boolean };
function evidence(key: Key, op: Operation, externalId: string, body: Uint8Array, over: Over = {}) {
  const now = Date.now();
  const target = { environment: "sandbox" as const, ...scopeOf(key), integrationId: INTEGRATION, originClubReference: CLUB, externalOrderId: externalId };
  const proof = { id: over.proofId ?? `p${randomBytes(8).toString("hex")}`, issuedAtMs: now, expiresAtMs: now + 60000, bindingDigest: requestBindingDigest(op, target, body) };
  const payload = Buffer.from(JSON.stringify({ k: key, proof })).toString("base64url");
  const sig = over.tamper ? "00".repeat(32) : createHmac("sha256", labKey).update(`api12-lab:${payload}`).digest("hex");
  return `${payload}.${sig}`;
}
type Sent = { status: number; json: Row };
async function call(method: "GET" | "POST", url: string, op: Operation, key: Key | null, externalId: string, body?: unknown, over: Over = {}): Promise<Sent> {
  const bytes = body === undefined ? new Uint8Array(0) : enc(body);
  const headers: Record<string, string> = { accept: "application/json" }; if (method === "POST") headers["content-type"] = "application/json";
  if (key) headers["x-lab-evidence"] = evidence(key, op, externalId, bytes, over);
  const res = await fetch(url, { method, headers, body: method === "POST" ? Buffer.from(bytes) : undefined });
  return { status: res.status, json: (await res.json()) as Row };
}
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const uid = () => `PS${randomBytes(5).toString("hex")}`;
const labOrder = (id: string, over: Record<string, unknown> = {}) => ({ schemaVersion: "lab-demo-1", externalOrderId: id, originClubReference: CLUB, recipient: { name: "Club Ficticio Zona 10" }, address: "Avenida Ficticia 12-34, Zona 10, Ciudad de Guatemala", deliveryDate: day(3), ...over });
const post = (key: Key | null, id: string, body: unknown = labOrder(id), over?: Over) => call("POST", API, "orders:create", key, id, body, over);
const get = (key: Key | null, id: string) => call("GET", `${API}/${id}`, "orders:read", key, id);
const cancel = (key: Key | null, id: string, reason = "ORIGIN_REQUEST") => call("POST", `${API}/${id}/cancellation-requests`, "orders:cancel", key, id, { reason });
const solicitudOf = (id: string, empresaId = empresas.a.empresaId) => rows("SELECT id, estado, plan_id, version, fecha_solicitada, referencia_cliente, observaciones, cliente_id FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresaId, id]);
const inbox = async (slug: string) => { const r = await fetch(`${BASE}/api/empresas/${slug}/tms/solicitudes-clientes`, { headers: { cookie } }); return { status: r.status, json: (await r.json()) as { solicitudes: Row[] } }; };

describe("API-12 circuito completo", () => {
  let id = ""; let solicitudId = 0;

  it("DEMO.1 POST de una orden sintética → 202 y persistencia real (orden cifrada, evento, outbox, auditoría) sin viajes ni asignaciones", async () => {
    id = uid(); const planesAntes = await count("SELECT COUNT(*) n FROM tms_planes_viaje");
    const r = await post("a", id); expect(r.status).toBe(202); expect(r.json).toMatchObject({ externalOrderId: id, provisionalStatus: "RECEIVED", processingStatus: "PENDING", version: 1 });
    const [o] = await rows("SELECT HEX(id) AS id, tms_linked, payload_version, payload_ciphertext LIKE ? AS plain, OCTET_LENGTH(payload_ciphertext) AS len FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", ["%Avenida Ficticia%", empresas.a.empresaId, Buffer.from(id)]);
    expect(String(o.payload_version)).toBe("lab-demo-1"); expect(Number(o.plain)).toBe(0); expect(Number(o.len)).toBeGreaterThan(40); expect(Number(o.tms_linked)).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM ps_api01_events WHERE order_id = UNHEX(?)", [o.id])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM ps_api01_outbox WHERE order_id = UNHEX(?) AND status = 'PENDING'", [o.id])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM ps_api01_audit WHERE order_id = UNHEX(?)", [o.id])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM tms_planes_viaje")).toBe(planesAntes);   // no se creó ningún viaje/plan
  });

  it("DEMO.2 la orden aparece en la bandeja operativa del TMS como solicitud SOLICITADA, con sus datos logísticos, y no está programada", async () => {
    const s = await solicitudOf(id); expect(s).toHaveLength(1); solicitudId = Number(s[0].id);
    expect(s[0]).toMatchObject({ estado: "SOLICITADA", plan_id: null, referencia_cliente: id, cliente_id: empresas.a.clienteId }); expect(String(s[0].observaciones)).toContain("Club Ficticio Zona 10");
    const paradas = await rows("SELECT orden, tipo, lugar_nombre, referencia FROM tms_solicitud_paradas WHERE empresa_id = ? AND solicitud_id = ? ORDER BY orden", [empresas.a.empresaId, solicitudId]);
    expect(paradas.map((p) => p.tipo)).toEqual(["Carga", "Entrega", "Descarga"]); expect(paradas[1]).toMatchObject({ lugar_nombre: "Club Ficticio Zona 10", referencia: "Avenida Ficticia 12-34, Zona 10, Ciudad de Guatemala" });
    const list = await inbox(empresas.a.slug); expect(list.status).toBe(200);
    expect(list.json.solicitudes.some((x) => x.referenciaCliente === id && x.estado === "SOLICITADA")).toBe(true);
    const page = await fetch(`${BASE}/e/${empresas.a.slug}/tms/solicitudes-clientes`, { headers: { cookie }, redirect: "manual" }); expect(page.status).toBe(200);
  });

  it("DEMO.3 GET devuelve el estado real: recibido (SOLICITADA), sin afirmar nunca entrega", async () => {
    const r = await get("a", id); expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ externalOrderId: id, provisionalStatus: "RECEIVED", proposedStatus: "RECEIVED", confirmsDelivery: false, labProposal: true, tms: { linked: true, requestState: "SOLICITADA", scheduled: false } });
    expect(JSON.stringify(r.json)).not.toMatch(/DELIVERED|ENTREGAD/i);
  });

  it("DEMO.4 reenviar la misma orden no la duplica (mismo recibo, una orden, una solicitud); mismo id con otros datos → 409", async () => {
    const again = await post("a", id); expect(again.status).toBe(202); expect(again.json.externalOrderId).toBe(id); expect(again.json.version).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [empresas.a.empresaId, Buffer.from(id)])).toBe(1);
    expect(await solicitudOf(id)).toHaveLength(1);
    const changed = await post("a", id, labOrder(id, { address: "Otra dirección ficticia 99" })); expect(changed.status).toBe(409); expect(changed.json.code).toBe("CONFLICT");
    expect(await solicitudOf(id)).toHaveLength(1);
  });

  it("DEMO.5 aislamiento entre empresas: otra empresa no ve, no consulta ni cancela la orden ajena; la misma referencia en otra empresa es otra orden y otra solicitud", async () => {
    expect((await get("b", id)).status).toBe(404); expect((await cancel("b", id)).status).toBe(404);
    expect((await inbox(empresas.b.slug)).json.solicitudes.some((x) => x.referenciaCliente === id)).toBe(false);
    expect((await post("b", id)).status).toBe(202);
    expect(await solicitudOf(id, empresas.b.empresaId)).toHaveLength(1); expect(await solicitudOf(id, empresas.a.empresaId)).toHaveLength(1);
    expect((await inbox(empresas.b.slug)).json.solicitudes.filter((x) => x.referenciaCliente === id)).toHaveLength(1);
    expect((await get("a", id)).json.tms.requestState).toBe("SOLICITADA");
  });

  it("DEMO.6 Operaciones toma en revisión y programa (acción humana del TMS); GET refleja IN_REVIEW y luego SCHEDULED, sin confirmar entrega", async () => {
    const [s] = await solicitudOf(id); const t = await tomarEnRevisionSolicitud(empresas.a.empresaId, Number(s.id), Number(s.version), "ops.lab"); expect(t.ok).toBe(true);
    expect((await get("a", id)).json).toMatchObject({ proposedStatus: "IN_REVIEW", tms: { requestState: "EN_REVISION", scheduled: false }, confirmsDelivery: false });
    const perfil = (await db.query("INSERT INTO tms_cotizacion_costeo_perfiles (empresa_id, codigo, nombre, dias_operacion_mes, vida_util_aceite_km, vida_util_llantas_km, rendimiento_km_galon) VALUES (?, ?, 'Camión 5T ficticio', 26, 5000, 50000, 10)", [empresas.a.empresaId, `LAB-${uid()}`]))[0] as { insertId: number };
    const [s2] = await solicitudOf(id); const p = await programarSolicitud(empresas.a.empresaId, Number(s2.id), Number(s2.version), "ops.lab", perfil.insertId); expect(p.ok, JSON.stringify(p)).toBe(true);
    const g = await get("a", id); expect(g.json).toMatchObject({ proposedStatus: "SCHEDULED", tms: { requestState: "PROGRAMADA", scheduled: true }, confirmsDelivery: false });
    expect(await count("SELECT COUNT(*) n FROM tms_planes_viaje WHERE empresa_id = ? AND id = ?", [empresas.a.empresaId, (await solicitudOf(id))[0].plan_id])).toBe(1);
  });

  it("DEMO.7 la cancelación pedida por PriceSmart queda trazada y NO cancela solicitudes, planes ni viajes; se informa que requiere decisión de Operaciones", async () => {
    const antes = await solicitudOf(id); const r = await cancel("a", id); expect(r.status).toBe(202); expect(r.json).toMatchObject({ provisionalStatus: "CANCELLATION_REQUESTED", version: 2 });
    const despues = await solicitudOf(id); expect(despues[0].estado).toBe("PROGRAMADA"); expect(despues[0].plan_id).toBe(antes[0].plan_id);
    const [plan] = await rows("SELECT estado FROM tms_planes_viaje WHERE empresa_id = ? AND id = ?", [empresas.a.empresaId, antes[0].plan_id]); expect(plan.estado).toBe("Programado");
    expect(await count("SELECT COUNT(*) n FROM ps_api12_tms_links WHERE empresa_id = ? AND solicitud_id = ? AND cancellation_requested_at IS NOT NULL", [empresas.a.empresaId, Number(despues[0].id)])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM auditoria WHERE empresa_id = ? AND accion = 'pricesmart_cancelacion_solicitada'", [empresas.a.empresaId])).toBeGreaterThanOrEqual(1);
    const g = await get("a", id); expect(g.json).toMatchObject({ provisionalStatus: "CANCELLATION_REQUESTED", proposedStatus: "SCHEDULED", cancellation: { requested: true, automatic: false, assessment: "OPERATIONS_MAY_CANCEL_PLAN" } });
    expect((await cancel("a", id)).status).toBe(202); expect((await cancel("a", id, "DUPLICATE")).status).toBe(409);
  });

  it("DEMO.8 concurrencia: 6 POST simultáneos de la misma orden nueva → todos 202, UNA orden y UNA solicitud", async () => {
    const cid = uid(); const all = await Promise.all(Array.from({ length: 6 }, () => post("a", cid)));
    expect(all.map((r) => r.status)).toEqual(Array(6).fill(202));
    expect(await count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [empresas.a.empresaId, Buffer.from(cid)])).toBe(1);
    expect(await solicitudOf(cid)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM ps_api12_tms_links l JOIN ps_api01_orders o ON o.id = l.order_id WHERE o.external_order_id = ? AND l.tenant_id = ?", [Buffer.from(cid), empresas.a.empresaId])).toBe(1);
  });

  it("DEMO.9 autenticación: sin evidencia, firma alterada, credencial revocada o desconocida → 401; prueba repetida → 409; datos inválidos → 400 sin filtrar internos", async () => {
    const x = uid();
    expect((await post(null, x)).status).toBe(401); expect((await post("a", x, labOrder(x), { tamper: true })).status).toBe(401);
    expect((await post("rev", x)).status).toBe(401); expect((await post("ghost", x)).status).toBe(401);
    const proofId = `fixed${randomBytes(6).toString("hex")}`; expect((await post("a", x, labOrder(x), { proofId })).status).toBe(202);
    const replay = await post("a", x, labOrder(x), { proofId }); expect(replay.status).toBe(409); expect(replay.json.code).toBe("REPLAY_REJECTED");
    const y = uid(); const bad = await post("a", y, labOrder(y, { deliveryDate: "2026-02-31" })); expect(bad.status).toBe(400); expect(Object.keys(bad.json).sort()).toEqual(["code", "correlationId"]);
    const extra = await post("a", y, { ...labOrder(y), campoNoDefinido: "x" }); expect(extra.status).toBe(400);
  });

  it("DEMO.10 si el TMS rechaza la vinculación (fecha pasada) la orden queda RECIBIDA y sin vincular, sin simular una solicitud inexistente", async () => {
    const old = uid(); const r = await post("a", old, labOrder(old, { deliveryDate: "2020-01-01" })); expect(r.status).toBe(202);
    expect(await solicitudOf(old)).toHaveLength(0);
    const g = await get("a", old); expect(g.json).toMatchObject({ provisionalStatus: "RECEIVED", proposedStatus: "RECEIVED", tms: { linked: false }, confirmsDelivery: false });
    expect(await count("SELECT COUNT(*) n FROM ps_api12_tms_links l JOIN ps_api01_orders o ON o.id = l.order_id WHERE o.external_order_id = ? AND l.solicitud_id IS NOT NULL", [Buffer.from(old)])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM ps_api12_tms_links l JOIN ps_api01_orders o ON o.id = l.order_id WHERE o.external_order_id = ? AND l.solicitud_id IS NULL AND l.linked_at IS NULL", [Buffer.from(old)])).toBe(1);   // reclamo pendiente, sin solicitud
  });

  const markerOf = async (orderExternal: string, clientId: number) => {
    const [l] = await rows("SELECT claim_token, solicitud_id FROM ps_api12_tms_links l JOIN ps_api01_orders o ON o.environment = l.environment AND o.tenant_id = l.tenant_id AND o.client_id = l.client_id AND o.integration_id = l.integration_id AND o.id = l.order_id WHERE l.tenant_id = ? AND l.client_id = ? AND o.external_order_id = ?", [empresas.a.empresaId, clientId, Buffer.from(orderExternal)]);
    return l ? { marker: claimMarker(l.claim_token as Buffer), solicitudId: l.solicitud_id == null ? null : Number(l.solicitud_id) } : null;
  };

  it("DEMO.11 colisión entre integraciones/alcances que comparten cliente y usuario de servicio: cada orden se vincula a SU solicitud, nunca a la del otro por tener la misma referencia", async () => {
    const x = uid();
    expect((await post("a", x)).status).toBe(202); expect((await post("c", x)).status).toBe(202);
    const sols = await solicitudOf(x); expect(sols).toHaveLength(2);   // misma empresa, mismo cliente, mismo usuario y MISMA referencia: dos solicitudes distintas
    const la = await markerOf(x, 1); const lc = await markerOf(x, 2);
    expect(la?.solicitudId).not.toBeNull(); expect(lc?.solicitudId).not.toBeNull(); expect(la?.solicitudId).not.toBe(lc?.solicitudId); expect(la?.marker).not.toBe(lc?.marker);
    for (const l of [la!, lc!]) expect(String((await rows("SELECT observaciones FROM tms_solicitudes_cliente WHERE empresa_id = ? AND id = ?", [empresas.a.empresaId, l.solicitudId]))[0].observaciones).startsWith(l.marker)).toBe(true);
    const sa = sols.find((r) => Number(r.id) === la!.solicitudId)!; expect((await tomarEnRevisionSolicitud(empresas.a.empresaId, Number(sa.id), Number(sa.version), "ops.lab")).ok).toBe(true);
    expect((await get("a", x)).json.tms.requestState).toBe("EN_REVISION"); expect((await get("c", x)).json.tms.requestState).toBe("SOLICITADA");   // el estado de una no se filtra a la otra
    expect((await post("c", x)).status).toBe(202); expect(await solicitudOf(x)).toHaveLength(2);   // reenvío idempotente: no crea una tercera
  });

  it("DEMO.12 una solicitud preexistente con la misma referencia (y mismo cliente/usuario) NO se reutiliza: la orden crea y vincula la suya", async () => {
    const y = uid(); const A = empresas.a;
    const [usr] = await rows("SELECT id FROM tms_cliente_usuarios WHERE empresa_id = ? AND cliente_id = ? ORDER BY id LIMIT 1", [A.empresaId, A.clienteId]);
    const pre = await crearSolicitudCliente({ empresaId: A.empresaId, clienteId: A.clienteId, usuarioClienteId: Number(usr.id) },
      { fechaSolicitada: day(5), referenciaCliente: y, observaciones: "solicitud preexistente ajena a PriceSmart", origen: { lugarNombre: "Origen X" }, entregas: [{ lugarNombre: "Entrega X" }], destino: { lugarNombre: "Destino X" } });
    expect(pre.ok).toBe(true); const preId = pre.ok ? pre.solicitud.id : 0;
    expect((await post("a", y)).status).toBe(202);
    expect(await solicitudOf(y)).toHaveLength(2);
    const l = await markerOf(y, 1); expect(l?.solicitudId).not.toBe(preId); expect(l?.solicitudId).not.toBeNull();
    expect((await rows("SELECT observaciones FROM tms_solicitudes_cliente WHERE empresa_id = ? AND id = ?", [A.empresaId, preId]))[0].observaciones).toBe("solicitud preexistente ajena a PriceSmart");   // la ajena quedó intacta
  });

  it("DEMO.13 caídas entre operaciones (API-13): antes de crear no queda nada; después de crear el vínculo ya es atómico; los reclamos pendientes de API-12 se recuperan por token", async () => {
    const A = empresas.a.empresaId; const schema = String(process.env.DB_NAME); const pool = getPool();
    const repository = mariaDbOrderRepository(pool, { schema, runtimeUser: String(process.env.DB_USER), cipher: labCipher(labKey), contract: labContract });
    const scope = { environment: "sandbox" as const, tenantId: A, clientId: 3, integrationId: INTEGRATION };
    const received = async (id: string) => {   // la orden se recibe sin mapeo (sin vinculación); el mapeo se restaura enseguida
      const [map] = await rows("SELECT * FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = 3", [A]);
      await db.query("DELETE FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = 3", [A]);
      try { expect((await post("d", id)).status).toBe(202); } finally {
        await db.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (?,?,?,?,?,?,?,?,?)",
          [map.environment, map.tenant_id, map.client_id, map.integration_id, map.empresa_id, map.tms_cliente_id, map.tms_usuario_cliente_id, map.pickup_place, map.dropoff_place]);
      }
    };
    // a) Caída ANTES de crear la solicitud: no hay solicitud; queda un reclamo pendiente que no se presenta como vínculo.
    const z = uid(); await received(z);
    const antes = (async () => { throw new Error("caída simulada antes de crear"); }) as unknown as typeof crearSolicitudCliente;
    await expect(createTmsLinker({ pool, schema, repository, createRequest: antes }).link(scope, z)).rejects.toThrow("caída simulada");
    expect(await solicitudOf(z)).toHaveLength(0); expect((await markerOf(z, 3))?.solicitudId).toBeNull(); expect((await get("d", z)).json.tms.linked).toBe(false);
    // b) Caída DESPUÉS de crear: el vínculo se escribió en la MISMA transacción que la solicitud, así que ya está completo; el reintento no crea otra.
    const crashAfter = (async (sc: Parameters<typeof crearSolicitudCliente>[0], inp: Parameters<typeof crearSolicitudCliente>[1], g: Parameters<typeof crearSolicitudCliente>[2]) => { await crearSolicitudCliente(sc, inp, g); throw new Error("caída simulada después de crear"); }) as typeof crearSolicitudCliente;
    await expect(createTmsLinker({ pool, schema, repository, createRequest: crashAfter }).link(scope, z)).rejects.toThrow("caída simulada");
    const created = await solicitudOf(z); expect(created).toHaveLength(1); expect((await markerOf(z, 3))?.solicitudId).toBe(Number(created[0].id)); expect((await get("d", z)).json.tms.linked).toBe(true);
    const linker = createTmsLinker({ pool, schema, repository });
    expect(await linker.link(scope, z)).toMatchObject({ state: "ALREADY_LINKED", solicitudId: Number(created[0].id) }); expect(await solicitudOf(z)).toHaveLength(1);
    // c) Compatibilidad: un reclamo pendiente del formato API-12 (solicitud creada SIN gancho, con el token en observaciones) se completa por token, sin duplicar.
    const w = uid(); await received(w);
    const legacy = (async (sc: Parameters<typeof crearSolicitudCliente>[0], inp: Parameters<typeof crearSolicitudCliente>[1]) => { await crearSolicitudCliente(sc, inp); throw new Error("caída simulada (formato API-12)"); }) as typeof crearSolicitudCliente;
    await expect(createTmsLinker({ pool, schema, repository, createRequest: legacy }).link(scope, w)).rejects.toThrow("caída simulada");
    const old = await solicitudOf(w); const pending = await markerOf(w, 3); expect(old).toHaveLength(1); expect(pending?.solicitudId).toBeNull(); expect(String(old[0].observaciones).startsWith(pending!.marker)).toBe(true);
    expect(await linker.link(scope, w)).toMatchObject({ state: "LINKED", solicitudId: Number(old[0].id) }); expect(await solicitudOf(w)).toHaveLength(1);
  });
});
