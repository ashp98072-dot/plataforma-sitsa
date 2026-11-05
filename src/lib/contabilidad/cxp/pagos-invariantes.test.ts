import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getConnection: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.getConnection }), query: vi.fn() }));
import { registrarPago } from "./pagos";

beforeEach(() => vi.resetAllMocks());
it.each(["0.00", "107.01"])("el servicio de escritura rechaza exceso con aplicado previo %s antes de INSERT", async previo => {
  const conn = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT activa")) return [[{ activa: 1 }]];
      if (sql.includes("SELECT id, huella")) return [[]];
      if (sql.includes("FROM cxp_facturas")) return [[{ id: 1, proveedor_id: 3, estado_admin: "REGISTRADA", total_neto_pagar: "107.00", serie: "A", numero: "1" }]];
      if (sql.includes("SUM(a.monto)")) return [[{ factura_id: 1, pagado: previo }]];
      if (sql.startsWith("SET TRANSACTION")) return [[]];
      throw new Error("Consulta inesperada en la prueba");
    }),
    beginTransaction: vi.fn(), rollback: vi.fn(), commit: vi.fn(), release: vi.fn(), execute: vi.fn(),
  };
  m.getConnection.mockResolvedValue(conn);
  const attempt = registrarPago(1, 5, { id: 91, username: "qa" }, {
    proveedorId: 3, fechaPago: "2026-11-05", medioPago: "Sintético", referencia: "QA", claveIdempotencia: "integridad-qa-01",
    aplicaciones: [{ facturaId: 1, monto: "107.01" }],
  });
  if (previo === "0.00") await expect(attempt).rejects.toMatchObject({ status: 409, codigo: "SOBREAPLICACION" });
  else await expect(attempt).rejects.toBeInstanceOf(RangeError);
  expect(conn.execute).not.toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.release).toHaveBeenCalledOnce();
});
