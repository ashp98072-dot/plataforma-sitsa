import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ version: 1, analizar: vi.fn(), tx: vi.fn(), rows: vi.fn(), leer: vi.fn(), release: vi.fn() }));
vi.mock("./model", async original => ({ ...await original<typeof import("./model")>(), analizar: m.analizar }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => ({ release: m.release }) }) }));
vi.mock("./repository", async original => ({ ...await original<typeof import("./repository")>(), tx: m.tx, rows: m.rows, anterior: async () => null }));
vi.mock("./storage", () => ({ leer: m.leer }));
import { reanudarArchivo } from "./service";
const ctx = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: async () => {} };
beforeEach(() => {
    m.version = 1; m.analizar.mockResolvedValue([]); m.leer.mockResolvedValue(Buffer.from("archivo privado sintético"));
    m.rows.mockImplementation(async (_c, sql: string) => sql.includes("FROM flota_cb2_importaciones")
        ? [{ version_contrato: 2, version_parser: m.version, perfil: "HALEL", archivo_ruta: "privado", archivo_sha256: "hash" }]
        : [{ empresa_id: 7, proveedor_id: 3, importacion_id: 5, tipo: "ORIGEN", revision: 1, marca_origen: 1, origen_fila_id: null, operacion_tipo: "CONFIRMAR", hoja_indice: 1, hoja_nombre: "Demo", fila_excel: 2, datos_origen: JSON.stringify({ hoja: "Demo", fila: 2 }), decision: JSON.stringify({ version: 1, moneda: "GTQ", candidato: null, vehiculoId: null, errores: [] }) }]);
    // Primera transacción: consulta de reintento. Detener antes de cualquier escritura real.
    m.tx.mockImplementationOnce(async (_ctx, fn) => fn({})).mockRejectedValueOnce(new Error("fin de verificación de versión"));
});
describe("reanudación despacha la versión persistida del parser", () => {
    it.each([1, 2])("evidencia parser %s se reanaliza con esa misma versión", async version => {
        m.version = version;
        await expect(reanudarArchivo(ctx, { importacionId: 5, revision: 1, seleccion: [], clave: "clave-sintetica-001", motivo: "Prueba" })).rejects.toThrow("fin de verificación");
        expect(m.analizar).toHaveBeenCalledExactlyOnceWith(Buffer.from("archivo privado sintético"), "HALEL", "GTQ", version);
        expect(m.leer).toHaveBeenCalledWith(7, "privado", "hash"); expect(m.release).toHaveBeenCalledOnce();
    });
    it("versiones desconocidas no reinterpretan ni leen el archivo", async () => {
        m.version = 99;
        await expect(reanudarArchivo(ctx, { importacionId: 5, revision: 1, seleccion: [], clave: "clave-sintetica-001", motivo: "Prueba" })).rejects.toThrow("Version de evidencia no soportada");
        expect(m.leer).not.toHaveBeenCalled(); expect(m.analizar).not.toHaveBeenCalled();
    });
});
