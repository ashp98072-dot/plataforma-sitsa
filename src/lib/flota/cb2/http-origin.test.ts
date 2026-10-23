import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), query: vi.fn(), release: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.connection }) }));
import { cb2Http, type Accion } from "./http";
import { decodeJwt } from "jose";
import { fixtureHalelV2, fixtureShellV2 } from "../combustible-importacion-v2.fixture";
const actions: Accion[] = ["preview", "confirmar", "reanudar", "asociar", "importaciones", "consumos", "facturas", "filas", "archivo"];
const writes = actions.slice(0, 4);
const url = "http://internal:3000/api/empresas/kt-monaco/flota/cb2";
beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CB2_PUBLIC_ORIGIN", undefined);
    vi.stubEnv("AUTH_SECRET", "synthetic-test-secret-not-used-in-production-510");
    m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 9, username: "demo", rol: "Admin" } });
    m.connection.mockResolvedValue({ query: m.query, release: m.release });
    m.query.mockResolvedValue([[{ id: 3 }], []]);
});
afterEach(() => vi.unstubAllEnvs());
describe("HTTP CB2: origen y guard de los nueve endpoints", () => {
    it.each([["HALEL", fixtureHalelV2], ["SHELL", fixtureShellV2]] as const)("preview %s legítimo detrás de proxy analiza el Excel real, sin escrituras", async (perfil, fixture) => {
        const form = new FormData();
        form.set("file", new File([new Uint8Array(await fixture())], "sintetico.xlsx"));
        form.set("perfil", perfil); form.set("proveedorId", "3"); form.set("moneda", "GTQ"); form.set("seleccion", "[]");
        const response = await cb2Http(new Request(`${url}/preview`, { method: "POST", headers: { origin: "https://novalvion.com" }, body: form }), "kt-monaco", "preview");
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.filas.length).toBeGreaterThan(20);
        const original = data.filas.find((f: { candidato: string | null }) => f.candidato);
        expect(original).toHaveProperty("lote"); expect(original).toHaveProperty("kilometraje");
        expect(Object.keys(original.origen)).toEqual(expect.arrayContaining(["galones", "km", "monto", "precio", "producto", "serie", "factura", "fecha", "lote"]));
        expect(Object.values(original.origen).every(v => typeof v === "string")).toBe(true);
        expect(data.sha256).toMatch(/^[a-f0-9]{64}$/); expect(data.token.split(".")).toHaveLength(3);
        expect(decodeJwt(data.token).parser).toBe(2);
        expect(data.filas.every((r: { moneda: string }) => r.moneda === "GTQ")).toBe(true);
        expect(m.guard).toHaveBeenCalledWith("kt-monaco", "conciliar", { soloLectura: true });
        expect(m.query).toHaveBeenCalledExactlyOnceWith("SELECT id FROM compras_proveedores WHERE empresa_id=? AND id=? AND activo=1", [7, 3]);
        expect(m.release).toHaveBeenCalledOnce();
        expect(response.headers.get("cache-control")).toBe("private, no-store");
    });
    it.each(actions)("%s conserva sesión, permiso y aislamiento por empresa antes de cualquier acceso", async action => {
        for (const status of [401, 403, 404]) {
            m.guard.mockResolvedValue({ error: new Response(null, { status }) });
            const r = await cb2Http(new Request(url, { method: "POST", headers: { origin: "https://novalvion.com" }, body: "{}" }), "otra-empresa", action, "1");
            expect(r.status).toBe(status);
        }
        const read = !writes.includes(action);
        expect(m.guard).toHaveBeenCalledWith("otra-empresa", read ? "ver" : "conciliar", { soloLectura: read || action === "preview" });
        expect(m.connection).not.toHaveBeenCalled();
    });
    it.each(writes)("%s bloquea origen externo y cabeceras ausentes sin leer datos", async action => {
        for (const headers of [{ origin: "https://externo.example" }, {}] as Record<string, string>[]) {
            const r = await cb2Http(new Request(url, { method: "POST", headers, body: "{}" }), "kt-monaco", action);
            expect(r.status).toBe(403); expect((await r.json()).error).toContain("desde la plataforma");
        }
        expect(m.connection).not.toHaveBeenCalled();
    });
    it("preview autorizado no permite proveedor ajeno", async () => {
        m.query.mockResolvedValue([[], []]);
        const form = new FormData(); form.set("file", new File([new Uint8Array(await fixtureHalelV2())], "sintetico.xlsx"));
        form.set("perfil", "HALEL"); form.set("proveedorId", "3"); form.set("moneda", "GTQ");
        const r = await cb2Http(new Request(url, { method: "POST", headers: { origin: "https://novalvion.com" }, body: form }), "kt-monaco", "preview");
        expect(r.status).toBe(403); expect(m.release).toHaveBeenCalledOnce();
    });
});
