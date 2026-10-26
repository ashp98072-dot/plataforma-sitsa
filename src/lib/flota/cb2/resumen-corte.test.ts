import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
// Nunca se importa ni conecta el pool real; todas las consultas son simuladas.
vi.mock("@/lib/db", () => ({ query: m.query }));
import { consolidarMes, resumenIntegrado, type OperacionResumen } from "./resumen-mensual";

const historico: OperacionResumen = {
    id: 1, origen: "HISTORICO", vehiculo_id: 2, placa: "C-001ABC", proveedor_id: 3,
    numero_vale: "0001", fecha_consumo: "2026-08-15", creado_at: "2026-09-02",
    galones: "10.123456", precio: "20", monto: "202.469120", moneda: "GTQ", combustible: "DIESEL",
};
const cb2: OperacionResumen = { ...historico, id: 9, origen: "CB2" };
const cantidad = { galones: "10.123456", monto: "202.46912" };
beforeEach(() => m.query.mockReset());

describe("corte temporal del resumen integrado", () => {
    it.each([
        ["2026-08-15", "2026-09-02", "2026-08-01", "2026-09-01"],
        ["2026-09-15", "2026-10-02", "2026-09-01", "2026-10-01"],
    ])("conserva CB2 consumido %s cuando el histórico se registra %s", (consumo, registro, desde, hasta) => {
        const h = { ...historico, fecha_consumo: consumo, creado_at: registro };
        const c = { ...cb2, fecha_consumo: consumo, creado_at: registro };
        for (const operaciones of [[h, c], [c, h]]) {
            expect(consolidarMes(operaciones, desde, hasta)).toMatchObject({
                totalGTQ: cantidad, subtotales: { "CB2:GTQ": cantidad },
                excluidas: [], ambiguas: [], provisional: false,
            });
            expect(consolidarMes(operaciones, desde, hasta).subtotales).not.toHaveProperty("HISTORICO:GTQ");
        }
        // En el mes de registro solo contribuye el histórico; no se traslada a consumo.
        const finRegistro = registro.slice(0, 5) + String(Number(registro.slice(5, 7)) + 1).padStart(2, "0") + "-01";
        const siguiente = consolidarMes([h, c], registro.slice(0, 7) + "-01", finRegistro);
        expect(siguiente).toMatchObject({ totalGTQ: cantidad, subtotales: { "HISTORICO:GTQ": cantidad }, excluidas: [], ambiguas: [], provisional: false });
        expect(siguiente.subtotales).not.toHaveProperty("CB2:GTQ");
    });

    it("deduplica una pareja exacta del mismo mes con Decimal y evidencia", () => {
        const r = consolidarMes([{ ...historico, creado_at: "2026-08-31" }, cb2], "2026-08-01", "2026-09-01");
        expect(r.totalGTQ).toEqual(cantidad);
        expect(r.subtotales).toEqual({ "HISTORICO:GTQ": cantidad });
        expect(r.excluidas).toEqual([{ consumoId: 9, cargaId: 1, firma: JSON.stringify([3, 2, "0001", "2026-08-15", "10.123456", "20", "202.46912"]) }]);
        expect(r.ambiguas).toEqual([]);
        expect(r.provisional).toBe(false);
    });

    it.each(["HISTORICO", "CB2"] as const)("preserva coincidencias múltiples de %s como provisionales", origen => {
        const h = { ...historico, creado_at: "2026-08-01" };
        const extra = { ...(origen === "HISTORICO" ? h : cb2), id: 20 };
        const r = consolidarMes([h, cb2, extra], "2026-08-01", "2026-09-01");
        expect(r.totalGTQ).toEqual({ galones: "30.370368", monto: "607.40736" });
        expect(r.excluidas).toEqual([]);
        expect(r.ambiguas).toEqual(origen === "CB2" ? [9, 20] : [9]);
        expect(r.provisional).toBe(true);
        expect(r.subtotales["CB2:GTQ"]).toEqual(origen === "CB2" ? { galones: "20.246912", monto: "404.93824" } : cantidad);
    });

    it("un histórico fuera del mes no convierte una pareja válida en múltiple", () => {
        const r = consolidarMes([historico, { ...historico, id: 2, creado_at: "2026-08-01" }, cb2], "2026-08-01", "2026-09-01");
        expect(r.totalGTQ).toEqual(cantidad);
        expect(r.excluidas).toMatchObject([{ consumoId: 9, cargaId: 2 }]);
        expect(r.ambiguas).toEqual([]);
        expect(r.provisional).toBe(false);
    });

    it.each([{ precio: null }, { numero_vale: null }, { proveedor_id: null }, { fecha_consumo: null }])("sin firma suficiente conserva los importes: %j", datos => {
        const h = { ...historico, ...datos, creado_at: "2026-08-01" };
        const r = consolidarMes([h, cb2], "2026-08-01", "2026-09-01");
        expect(r.totalGTQ).toEqual({ galones: "20.246912", monto: "404.93824" });
        expect(r.subtotales).toEqual({ "HISTORICO:GTQ": cantidad, "CB2:GTQ": cantidad });
        expect(r.excluidas).toEqual([]);
        expect(r.ambiguas).toEqual(datos.precio === null ? [9] : []);
        expect(r.provisional).toBe(datos.precio === null);
    });

    it.each([{ proveedor_id: 4 }, { vehiculo_id: 5 }, { moneda: "USD" }])("no deduplica otro proveedor, vehículo o moneda: %j", datos => {
        const r = consolidarMes([{ ...historico, creado_at: "2026-08-01" }, { ...cb2, ...datos }], "2026-08-01", "2026-09-01");
        expect(r.excluidas).toEqual([]);
        expect(r.totalGTQ).toEqual(datos.moneda ? cantidad : { galones: "20.246912", monto: "404.93824" });
        expect(r.subtotales[datos.moneda ? "CB2:USD" : "CB2:GTQ"]).toEqual(cantidad);
        expect(r.ambiguas).toEqual(datos.moneda ? [9] : []);
        expect(r.provisional).toBe(!!datos.moneda);
    });

    it("incluye el inicio y excluye el fin según la fecha de cada origen", () => {
        const r = consolidarMes([
            { ...historico, creado_at: "2026-08-01" },
            { ...historico, id: 2, creado_at: "2026-09-01" },
            { ...cb2, fecha_consumo: "2026-08-01", creado_at: "2026-12-01" },
            { ...cb2, id: 10, fecha_consumo: "2026-09-01" },
            { ...cb2, id: 11, fecha_consumo: null },
        ], "2026-08-01", "2026-09-01");
        expect(r.totalGTQ).toEqual({ galones: "20.246912", monto: "404.93824" });
        expect(r.excluidas).toEqual([]);
        expect(r.ambiguas).toEqual([]);
        expect(r.provisional).toBe(false);
    });

    it.each([7, 8])("resumenIntegrado conserva el ámbito de empresa %i y los cortes mediante consultas simuladas", async empresa => {
        const consumo = { ...cb2, id: empresa * 100, producto_clasificado: "DIESEL" };
        m.query.mockResolvedValueOnce([{ ...historico, tipo_combustible: "diesel" }]).mockResolvedValueOnce([consumo]);
        const r = await resumenIntegrado(empresa, "2026-08");
        expect(r).toMatchObject({ totalGTQ: cantidad, subtotales: { "CB2:GTQ": cantidad }, excluidas: [], ambiguas: [], provisional: false });
        expect(m.query).toHaveBeenCalledTimes(2);
        const [[sqlHistorico, argsHistorico], [sqlCB2, argsCB2]] = m.query.mock.calls;
        expect(sqlHistorico).toContain("c.empresa_id=? AND c.estado='APROBADO'");
        expect(argsHistorico).toEqual([empresa, "2026-08-01", "2026-09-01", "2026-08-01", "2026-09-01"]);
        expect(sqlCB2).toContain("c.empresa_id=? AND c.fecha_consumo>=? AND c.fecha_consumo<?");
        expect(argsCB2).toEqual([empresa, "2026-08-01", "2026-09-01"]);
        for (const [sql] of m.query.mock.calls) expect(sql).toMatch(/^SELECT /);
    });
});
