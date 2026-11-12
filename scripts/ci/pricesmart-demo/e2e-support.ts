// Soporte compartido de las pruebas E2E de API-13 (cliente de laboratorio con firma HMAC, sesión de Operaciones y acceso directo a la base desechable). Solo se usa desde demo.mjs.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";
import { requestBindingDigest } from "../../../src/lib/integrations/pricesmart/m2m-security";
import type { Operation } from "../../../src/lib/integrations/pricesmart/security-contracts";

type State = { app: { port: number }; demo: { labKey: string; empresas: Record<"a" | "b", { empresaId: number; clienteId: number; slug: string }>; staff: { id: number; username: string } } };
const runDir = String(process.env.PS_DEMO_RUNDIR);
export const state = JSON.parse(readFileSync(path.join(runDir, "state.json"), "utf8")) as State;
export const BASE = `http://127.0.0.1:${state.app.port}`;
export const API = `${BASE}/api/integrations/pricesmart/v1/orders`;
export const { labKey, empresas, staff } = state.demo;
export const INTEGRATION = "pricesmart-lab"; export const CLUB = "QA-CLUB";
export type Key = "a" | "b" | "c" | "d" | "rev" | "ghost";
export type Row = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
export const scopeOfKey = (k: Key) => ({ tenantId: k === "b" ? empresas.b.empresaId : empresas.a.empresaId, clientId: k === "c" ? 2 : k === "d" ? 3 : 1 });
export const scopeFull = (k: Key) => ({ environment: "sandbox" as const, ...scopeOfKey(k), integrationId: INTEGRATION });

export async function connect() {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const cookie = `${SESSION_COOKIE}=${await createSessionToken({ id: staff.id, username: staff.username, rol: "Admin", nombre: "Operaciones Ficticio", accesoTodas: true })}`;
  const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p))[0] as Row[];
  const count = async (sql: string, p: unknown[] = []) => Number((await rows(sql, p))[0].n);
  return { db, cookie, rows, count };
}

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
export type Over = { proofId?: string; tamper?: boolean };
function evidence(key: Key, op: Operation, externalId: string, body: Uint8Array, over: Over = {}) {
  const now = Date.now();
  const target = { environment: "sandbox" as const, ...scopeOfKey(key), integrationId: INTEGRATION, originClubReference: CLUB, externalOrderId: externalId };
  const proof = { id: over.proofId ?? `p${randomBytes(8).toString("hex")}`, issuedAtMs: now, expiresAtMs: now + 60000, bindingDigest: requestBindingDigest(op, target, body) };
  const payload = Buffer.from(JSON.stringify({ k: key, proof })).toString("base64url");
  const sig = over.tamper ? "00".repeat(32) : createHmac("sha256", labKey).update(`api12-lab:${payload}`).digest("hex");
  return `${payload}.${sig}`;
}
export type Sent = { status: number; json: Row };
export async function call(method: "GET" | "POST", url: string, op: Operation, key: Key | null, externalId: string, body?: unknown, over: Over = {}): Promise<Sent> {
  const bytes = body === undefined ? new Uint8Array(0) : enc(body);
  const headers: Record<string, string> = { accept: "application/json" }; if (method === "POST") headers["content-type"] = "application/json";
  if (key) headers["x-lab-evidence"] = evidence(key, op, externalId, bytes, over);
  const res = await fetch(url, { method, headers, body: method === "POST" ? Buffer.from(bytes) : undefined });
  return { status: res.status, json: (await res.json()) as Row };
}
export const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
export const uid = () => `PS${randomBytes(5).toString("hex")}`;
export const labOrder = (id: string, over: Record<string, unknown> = {}) => ({ schemaVersion: "lab-demo-1", externalOrderId: id, originClubReference: CLUB, recipient: { name: "Club Ficticio Zona 10" }, address: "Avenida Ficticia 12-34, Zona 10, Ciudad de Guatemala", deliveryDate: day(3), ...over });
export const post = (key: Key | null, id: string, body: unknown = labOrder(id), over?: Over) => call("POST", API, "orders:create", key, id, body, over);
export const get = (key: Key | null, id: string) => call("GET", `${API}/${id}`, "orders:read", key, id);
export const cancel = (key: Key | null, id: string, reason = "ORIGIN_REQUEST") => call("POST", `${API}/${id}/cancellation-requests`, "orders:cancel", key, id, { reason });
