import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { registrarAsiento } from "./asientos";

const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const datos = () => ({ numero: "PRUEBA-1", fecha: "2026-08-28", lineas: [{ cuentaId: 2, debe: 0.3 }, { cuentaId: 1, haber: 0.1 }, { cuentaId: 1, haber: 0.2 }] });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.query.mockResolvedValue([[{ id: 1, empresa_id: 7, activa: 1 }, { id: 2, empresa_id: 7, activa: 1 }]]);
  conn.execute.mockResolvedValue([{ insertId: 10, affectedRows: 1 }]);
});
it("registra cabecera, detalle y auditoría en la misma conexión, con importes exactos", async () => {
  expect(await registrarAsiento(7, "prueba", datos())).toBe(10);
  expect(conn.beginTransaction).toHaveBeenCalledOnce();
  expect(conn.query).toHaveBeenCalledWith(expect.stringMatching(/empresa_id = \?[\s\S]*ORDER BY id FOR UPDATE/), [7, 1, 2]);
  expect(conn.execute.mock.calls[1][1]).toEqual([10, 2, "0.30", "0.00"]);
  expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ empresaId: 7, usuario: "prueba" }));
  expect(conn.commit).toHaveBeenCalledOnce();
  expect(conn.rollback).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledOnce();
});
it.each([
  { fecha: "2026-02-30" }, { fecha: "no-fecha" }, { numero: " " }, { numero: "x".repeat(41) },
  { glosa: "x".repeat(501) }, { lineas: [] },
  { lineas: [{ cuentaId: 1, debe: -1 }, { cuentaId: 2, haber: -1 }] },
  { lineas: [{ cuentaId: 1, debe: 1.001 }, { cuentaId: 2, haber: 1.001 }] },
  { lineas: [{ cuentaId: 1, debe: 0 }, { cuentaId: 2, haber: 0 }] },
  { lineas: [{ cuentaId: 1, debe: 1, haber: 1 }, { cuentaId: 2, haber: 1 }] },
  { lineas: [{ cuentaId: 1, debe: 1000000000000 }, { cuentaId: 2, haber: 1000000000000 }] },
  { lineas: [{ cuentaId: 0, debe: 1 }, { cuentaId: 2, haber: 1 }] },
])("rechaza datos inválidos antes de adquirir conexión %#", async (cambio) => {
  await expect(registrarAsiento(7, "prueba", { ...datos(), ...cambio })).rejects.toThrow("Datos inválidos");
  expect(getPool).not.toHaveBeenCalled();
});
it("rechaza descuadre de un centavo sin escribir", async () => {
  const d = datos(); d.lineas[0].debe = 0.31;
  await expect(registrarAsiento(7, "prueba", d)).rejects.toThrow("no cuadra");
  expect(getPool).not.toHaveBeenCalled();
});
it.each([
  [], [{ id: 1, empresa_id: 7, activa: 1 }],
  [{ id: 1, empresa_id: 8, activa: 1 }, { id: 2, empresa_id: 7, activa: 1 }],
  [{ id: 1, empresa_id: 7, activa: 0 }, { id: 2, empresa_id: 7, activa: 1 }],
])("rechaza cuenta ausente, ajena o inactiva %#", async (...args) => {
  // each expande los arrays; reconstruir las filas para este caso.
  conn.query.mockResolvedValue([args]);
  await expect(registrarAsiento(7, "prueba", datos())).rejects.toThrow("Todas las cuentas");
  expect(conn.execute).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
});
it.each(["cabecera", "detalle", "auditoria"])("rollback si falla %s", async (paso) => {
  if (paso === "cabecera") conn.execute.mockRejectedValueOnce(new Error("fallo"));
  if (paso === "detalle") conn.execute.mockResolvedValueOnce([{ insertId: 10 }]).mockResolvedValueOnce([{ affectedRows: 1 }]).mockRejectedValueOnce(new Error("fallo"));
  if (paso === "auditoria") vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("fallo"));
  await expect(registrarAsiento(7, "prueba", datos())).rejects.toThrow("fallo");
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledOnce();
});
it("preserva el error de número duplicado y revierte", async () => {
  conn.execute.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });
  await expect(registrarAsiento(7, "prueba", datos())).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  expect(conn.rollback).toHaveBeenCalledOnce();
});
it("acepta totales mayores al entero seguro sin perder centavos", async () => {
  const lineas = Array.from({ length: 250 }, () => [
    { cuentaId: 1, debe: 999999999999.99, haber: 0 },
    { cuentaId: 2, debe: 0, haber: 999999999999.99 },
  ]).flat();
  await registrarAsiento(7, "prueba", { ...datos(), lineas });
  expect(conn.execute.mock.calls[1][1]).toEqual([10, 1, "999999999999.99", "0.00"]);
  expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ detalle: expect.stringContaining("24999999999999750") }));
});
it("si falla el bloqueo no escribe y libera la conexión", async () => {
  conn.query.mockRejectedValueOnce({ code: "ER_LOCK_DEADLOCK" });
  await expect(registrarAsiento(7, "prueba", datos())).rejects.toMatchObject({ code: "ER_LOCK_DEADLOCK" });
  expect(conn.execute).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.release).toHaveBeenCalledOnce();
});
