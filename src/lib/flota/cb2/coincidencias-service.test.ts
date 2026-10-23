import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt, SignJWT } from "jose";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), insert: vi.fn(), diario: vi.fn(), guardar: vi.fn(), compensar: vi.fn(), release: vi.fn(), empresaVehiculo: 7 }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => ({ query: m.query, execute: m.execute, release: m.release }) }) }));
vi.mock("./repository", async original => ({ ...await original<typeof import("./repository")>(),
    tx: async (_ctx: unknown, fn: (c: unknown, p: unknown) => unknown) => fn({ query: m.query, execute: m.execute }, { nombre_comercial: "Proveedor sintético" }),
    insert: m.insert, diario: m.diario, anterior: async () => null,
}));
vi.mock("./storage", () => ({ guardar: m.guardar, compensar: m.compensar }));
import { preview, confirmarArchivo } from "./service";
import { analizar } from "./model";
import { libro, row } from "./fixture";
import { getAuthSecretBytes } from "@/lib/auth-secret";
const ctx = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: async () => {} };
beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "synthetic-only-no-real-db-service-511"); m.empresaVehiculo = 7;
    m.query.mockImplementation(async (sql: string) => [sql.includes("FROM compras_proveedores") ? [{ id: 3 }]
        : sql.includes("FROM flota_vehiculos") ? [{ id: 1, empresa_id: m.empresaVehiculo, placa: "C-001ABC", estado: "Activo", activo: 1 }] : [], []]);
    m.insert.mockResolvedValue(10); m.guardar.mockResolvedValue("solo-memoria"); m.compensar.mockResolvedValue(undefined);
    m.diario.mockImplementation(async (_c, _ctx, _tipo, _clave, _digest, eventos) => eventos);
});
afterEach(() => vi.unstubAllEnvs());
async function preparar(placa: string, repetido = false) {
    const r = row(); r[2] = placa;
    const file = await libro(repetido ? [r, r] : [r]);
    const lineas = await analizar(file, "HALEL", "GTQ");
    const entrada = { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: [{ candidato: lineas[1].clave!, vehiculoId: 1 }] };
    return { file, entrada, recibo: await preview(ctx, file, entrada) };
}
describe("confirmación real del servicio con BD y almacenamiento simulados", () => {
    it("acepta abreviada única y consulta únicamente el catálogo autorizado bajo bloqueo", async () => {
        const { file, entrada, recibo } = await preparar("001 ABC");
        await confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "abreviada-unica-513", recibo.token);
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(1);
        const consulta = m.query.mock.calls.find(([sql]) => String(sql).includes("REGEXP_REPLACE"));
        expect(consulta).toBeDefined();
        expect(consulta![0]).toContain("FOR UPDATE");
        expect(consulta![0]).toContain("empresa_id");
        expect(consulta![1]).toEqual([7, 7, "001ABC"]);
    });
    it("rechaza abreviada ambigua aunque el cliente fuerce un ID", async () => {
        const { file, entrada, recibo } = await preparar("001 ABC");
        const original = m.query.getMockImplementation()!;
        m.query.mockImplementation(async (...args) => String(args[0]).includes("REGEXP_REPLACE")
            ? [[{ id: 1, placa: "C-001ABC" }, { id: 2, placa: "P-001ABC" }], []] : original(...args));
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "abreviada-ambigua-513", recibo.token)).rejects.toThrow("no coincide con la placa");
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(0);
    });
    it("acepta separadores conservadores, conserva original y crea un consumo por candidato", async () => {
        const { file, entrada, recibo } = await preparar("C 001 ABC", true);
        await confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", recibo.token);
        const consumos = m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos");
        expect(consumos).toHaveLength(1); expect(consumos[0][2]).toMatchObject({ empresa_id: 7, proveedor_id: 3, placa_original: "C 001 ABC", placa_normalizada: "C 001 ABC", vehiculo_id: 1 });
        expect(m.insert.mock.calls.find(([, table]) => table === "flota_cb2_importaciones")![2].version_parser).toBe(2);
    });
    it.each(["P-001ABC", "C-001AB7"])("selección manual no permite placa diferente: %s", async placa => {
        const { file, entrada, recibo } = await preparar(placa);
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", recibo.token)).rejects.toThrow("no coincide con la placa");
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(0);
    });
    it("revalida acceso de empresa aunque el cliente envíe el ID", async () => {
        const { file, entrada, recibo } = await preparar("C-001ABC"); m.empresaVehiculo = 99;
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", recibo.token)).rejects.toThrow("sin acceso vigente");
        expect(m.insert.mock.calls.filter(([, table]) => table === "flota_cb2_consumos")).toHaveLength(0);
    });
    it("un recibo firmado de parser anterior exige preview nuevo antes de escribir", async () => {
        const { file, entrada, recibo } = await preparar("C-001ABC");
        const token = await new SignJWT({ ...decodeJwt(recibo.token) as Record<string, unknown>, parser: 1 }).setProtectedHeader({ alg: "HS256" }).sign(getAuthSecretBytes());
        await expect(confirmarArchivo(ctx, file, "sintetico.xlsx", entrada, "clave-sintetica-511", token)).rejects.toThrow("Recibo invalido");
        expect(m.guardar).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
    });
});
