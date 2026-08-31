import { beforeEach, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { rangoMes, resumenMensualPropio } from "./resumen-mensual";
beforeEach(() => vi.resetAllMocks());
it("rango mensual exclusivo, incluyendo diciembre y febrero", () => {
  expect(rangoMes("2026-12")).toEqual(["2026-12-01", "2027-01-01"]);
  expect(rangoMes("2028-02")).toEqual(["2028-02-01", "2028-03-01"]);
  expect(() => rangoMes("2026-13")).toThrow();
  expect(() => rangoMes("2026-01' OR 1=1")).toThrow();
});
it("consulta únicamente al empleado y empresa; separa fuentes sin sumar duplicados", async () => {
  vi.mocked(query).mockResolvedValueOnce([{ periodo_id: 1, codigo: "Q1", sueldo_base: "1000", bono_incentivo: "125", bono_herramientas: "0", otros_ingresos: "40", descuentos: "20", igss_laboral: "48.30", isr: "0", neto: "1096.70", estado_pago: "Pendiente" }] as RowDataPacket[])
    .mockResolvedValueOnce([{ estado: "ENTREGADO", monto: "100", cantidad: "1" }] as RowDataPacket[]);
  const r = await resumenMensualPropio(7, 10, "2026-08");
  expect(r.nomina[0]).toMatchObject({ adicionales: 40, neto: 1096.7, estado: "Pendiente" });
  expect(r.viaticos).toEqual([{ estado: "ENTREGADO", monto: 100 }]);
  // VIATICOS-RECHAZADO-1 (31) — sin fila RECHAZADO en el resultado -> contador en 0, nunca null (la consulta sí tuvo éxito).
  expect(r.viaticosRechazados).toBe(0);
  for (const [sql, params] of vi.mocked(query).mock.calls) {
    expect(sql.trim().startsWith("SELECT")).toBe(true);
    expect(params).toEqual([7, 10, "2026-08-01", "2026-09-01"]);
  }
  expect(vi.mocked(query).mock.calls[0][0]).toContain("p.estado IN ('Cerrada', 'Pagada')");
  expect(vi.mocked(query).mock.calls[1][0]).toContain("tp.id_empleado = ?");
});
it("VIATICOS-RECHAZADO-1 (31) — el monto RECHAZADO NUNCA se suma como dinero: se excluye de `viaticos`, se cuenta aparte en `viaticosRechazados`", async () => {
  vi.mocked(query).mockResolvedValueOnce([] as RowDataPacket[])
    .mockResolvedValueOnce([
      { estado: "ENTREGADO", monto: "100", cantidad: "1" },
      { estado: "RECHAZADO", monto: "500", cantidad: "2" },
    ] as RowDataPacket[]);
  const r = await resumenMensualPropio(7, 10, "2026-08");
  // Ni el monto (500) ni el estado "RECHAZADO" aparecen en el arreglo monetario.
  expect(r.viaticos).toEqual([{ estado: "ENTREGADO", monto: 100 }]);
  expect(r.viaticos?.some((v) => v.estado === "RECHAZADO")).toBe(false);
  // El conteo (2) sí se expone, pero como cantidad, nunca como monto.
  expect(r.viaticosRechazados).toBe(2);
});
it("viáticos no disponibles no equivalen a cero y conservan nómina", async () => {
  vi.mocked(query).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("DB"));
  expect(await resumenMensualPropio(7, 10, "2026-08")).toEqual({ nomina: [], viaticos: null, viaticosRechazados: null });
});
it("fallo de nómina no se presenta como mes sin pagos", async () => {
  vi.mocked(query).mockRejectedValueOnce(new Error("DB"));
  await expect(resumenMensualPropio(7, 10, "2026-08")).rejects.toThrow();
});
