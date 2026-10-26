import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.connection }) }));
import { consultarDocumental, consumosDocumentales } from "./conciliacion-documental";
import { balanceDocumental, DecimalDocumental } from "./conciliacion-documental-model";
const factura = { id: 10, proveedor_id: 3, proveedor: "HALEL", serie: "A", numero: "0001", fecha: "2026-10-01", moneda: "GTQ", total_documental: "0.600003", cantidad: 3, galones: "0.123456", monto: "0.600003" };
beforeEach(() => { m.query.mockReset(); m.connection.mockResolvedValue({ query: m.query, release: m.release }); });

describe("balance documental Decimal sin persistencia", () => {
    it("varios consumos y seis decimales coinciden sin redondeo acumulativo", () => {
        const suma = ["0.100001", "0.200001", "0.300001"].reduce((a, b) => a.plus(b), new DecimalDocumental(0));
        expect(balanceDocumental("0.600003", 3, suma.toFixed(), "0.123456")).toEqual({ estado: "CUADRADA", diferencia: "0", montoConsumos: "0.600003", galones: "0.123456" });
    });
    it.each([
        ["100.02", "100", "CON_DIFERENCIA", "0.02"],
        ["99.98", "100", "CON_DIFERENCIA", "-0.02"],
        ["100.01", "100", "CUADRADA", "0.01"],
        ["99.99", "100", "CUADRADA", "-0.01"],
        ["100.010001", "100", "CON_DIFERENCIA", "0.010001"],
        ["100.009999", "100", "CUADRADA", "0.009999"],
    ])("total %s, consumos %s: %s", (total, monto, estado, diferencia) => {
        expect(balanceDocumental(total, 2, monto, "12.123456")).toMatchObject({ estado, diferencia });
    });
    it("sin total tiene precedencia sobre sin consumos", () => {
        for (const n of [0, 2]) expect(balanceDocumental(null, n, "0", "0")).toMatchObject({ estado: "SIN_TOTAL_DOCUMENTAL", diferencia: null });
    });
    it("sin consumos nunca se presenta cuadrada aunque total sea cero", () => {
        expect(balanceDocumental("0", 0, "0", "0")).toMatchObject({ estado: "SIN_CONSUMOS", diferencia: "0" });
        expect(balanceDocumental("20", 0, "0", "0")).toMatchObject({ estado: "SIN_CONSUMOS", diferencia: "20" });
    });
    it("mantiene precisión con sumas mayores que un consumo individual", () => {
        expect(balanceDocumental("9999999999999999.999999", 10000, "9999999999999999.99", "1000000000000.123456")).toMatchObject({ estado: "CUADRADA", diferencia: "0.009999", galones: "1000000000000.123456" });
    });
});

describe("consulta documental con conexión simulada (sin SQL real)", () => {
    it.each([7, 8])("limita agregación a empresa %i y enlaza proveedor/factura/moneda sin evidencia ni N+1", async empresa => {
        m.query.mockResolvedValue([[factura, { ...factura, id: 11, proveedor_id: 4, moneda: "USD", proveedor: "SHELL" }], []]);
        const r = await consultarDocumental(empresa, {}, 25, 0);
        expect(r.filas.map(f => [f.proveedorId, f.moneda, f.estado])).toEqual([[3, "GTQ", "CUADRADA"], [4, "USD", "CUADRADA"]]);
        expect(r.siguiente).toBeNull(); expect(m.query).toHaveBeenCalledTimes(1);
        const [sql, args] = m.query.mock.calls[0];
        expect(args).toEqual([empresa, 0, 26]);
        expect(sql).toContain("f.empresa_id=?");
        for (const condicion of ["c.empresa_id=f.empresa_id", "c.proveedor_id=f.proveedor_id", "c.factura_id=f.id", "c.moneda=f.moneda"]) expect(sql).toContain(condicion);
        expect(sql).toContain("SUM(c.monto)"); expect(sql).toContain("SUM(c.galones)");
        expect(sql).not.toMatch(/flota_cb2_filas|importacion_origen_id|FLOAT|DOUBLE|UPDATE|INSERT|DELETE/);
        expect(sql.indexOf("GROUP BY")).toBeLessThan(sql.lastIndexOf("LIMIT"));
        expect(m.release).toHaveBeenCalled();
    });
    it("filtra antes de paginar sin recortar consumos del total documental", async () => {
        m.query.mockResolvedValue([[factura, { ...factura, id: 11 }], []]);
        const r = await consultarDocumental(7, { proveedorId: 3, desde: "2026-10-01", hasta: "2026-10-31", fecha: "CON_FECHA", estado: "CUADRADA", buscar: "A%_'" }, 1, 9);
        expect(r.filas).toHaveLength(1); expect(r.siguiente).toBe(10);
        expect(r.filas[0]).toMatchObject({ cantidad: 3, galones: "0.123456", montoConsumos: "0.600003" });
        const [sql, args] = m.query.mock.calls[0];
        expect(args).toEqual([7, 9, 3, "2026-10-01", "2026-10-31", "A%_'", "A%_'", "CUADRADA", 2]);
        expect(sql).not.toContain("A%_'"); expect(sql).toContain("f.fecha_factura>=?"); expect(sql).toContain("f.fecha_factura<=?");
        expect(sql).not.toContain("c.fecha_consumo"); expect(sql).toContain("ABS(a.total_documental-a.monto)<=0.01");
        expect(sql.indexOf("GROUP BY")).toBeLessThan(sql.indexOf("WHERE CASE"));
    });
    it("sin fecha y sin total/no consumos se conservan", async () => {
        m.query.mockResolvedValue([[{ ...factura, fecha: null, total_documental: null, cantidad: 0, galones: "0", monto: "0" }], []]);
        expect((await consultarDocumental(7, { fecha: "SIN_FECHA" }, 25, 0)).filas[0]).toMatchObject({ fecha: null, totalDocumental: null, cantidad: 0, estado: "SIN_TOTAL_DOCUMENTAL", diferencia: null });
        expect(m.query.mock.calls[0][0]).toContain("f.fecha_factura IS NULL");
    });
    it("detalle pagina consumos de diferentes importaciones usando asociación vigente", async () => {
        const c = { id: 21, importacion_origen_id: 5, numero_vale: "001", placa_original: "001ABC", fecha: "2026-09-01", moneda: "GTQ", galones: "1.123456", monto: "20.123456" };
        m.query.mockResolvedValue([[c, { ...c, id: 22, importacion_origen_id: 6 }, { ...c, id: 23 }], []]);
        const r = await consumosDocumentales(7, 3, 10, 2, 20);
        expect(r.filas.map(c => c.importacionId)).toEqual([5, 6]); expect(r.siguiente).toBe(22);
        expect(r.filas[0]).toMatchObject({ galones: "1.123456", monto: "20.123456" });
        const [sql, args] = m.query.mock.calls[0]; expect(args).toEqual([7, 3, 10, 20, 3]);
        expect(sql).toContain("f.empresa_id=? AND f.proveedor_id=? AND f.id=? AND c.id>?");
        expect(sql).toContain("c.moneda=f.moneda"); expect(sql).not.toContain("flota_cb2_filas");
    });
    it("libera la conexión al fallar; no devuelve un balance cero inventado", async () => {
        m.query.mockRejectedValue(new Error("fallo simulado"));
        await expect(consultarDocumental(7, {}, 25, 0)).rejects.toThrow("fallo simulado");
        expect(m.release).toHaveBeenCalled();
    });
});
