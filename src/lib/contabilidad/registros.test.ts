import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { crearRegistro, errorRegistro, type TipoRegistro } from "./registros";
const conn = { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const cuenta = { codigo: " 001 ", nombre: " Caja ", tipo: "Activo" };
const obligacion = { cliente: "Cliente ficticio", proveedor: "Proveedor ficticio", fecha: "2026-08-28", monto: 0.1 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.execute.mockResolvedValue([{ insertId: 11 }]);
});
it.each(["cuentas", "cxc", "cxp"] as TipoRegistro[])("registra %s con tenant y auditoría en la misma transacción", async (tipo) => {
  expect(await crearRegistro(tipo, 7, "actor", { ...(tipo === "cuentas" ? cuenta : obligacion), empresaId: 99, usuario: "falso", saldo: 99 })).toBe(11);
  expect(conn.execute.mock.calls[0][1][0]).toBe(7);
  if (tipo === "cuentas") expect(conn.execute.mock.calls[0][1]).toEqual([7, "001", "Caja", "Activo", 1]);
  else expect(conn.execute.mock.calls[0][1].slice(-2)).toEqual(["0.10", "0.10"]);
  expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ empresaId: 7, usuario: "actor", accion: "crear_" + tipo }));
  expect(conn.commit).toHaveBeenCalledOnce();
  expect(conn.rollback).not.toHaveBeenCalled();
  expect(conn.release).toHaveBeenCalledOnce();
});
it.each([{ codigo: " " }, { nombre: "x".repeat(201) }, { codigo: "x".repeat(41) }, { nivel: 0 }, { nivel: 1.5 }, { tipo: "Otro" }])("valida cuenta %#", async (d) => {
  await expect(crearRegistro("cuentas", 7, "actor", { ...cuenta, ...d })).rejects.toThrow();
  expect(getPool).not.toHaveBeenCalled();
});
it.each(["cxc", "cxp"] as const)("valida fechas, límites e importes de %s", async (tipo) => {
  for (const d of [
    { fecha: "2026-02-30" }, { fecha: "2026-8-28" }, { vencimiento: "2026-08-27" },
    { vencimiento: "invalida" }, { monto: -1 }, { monto: 1.001 }, { monto: Infinity },
    { monto: 1000000000000 }, { documento: "x".repeat(81) }, { cliente: " ", proveedor: " " },
  ]) await expect(crearRegistro(tipo, 7, "actor", { ...obligacion, ...d })).rejects.toThrow();
  expect(getPool).not.toHaveBeenCalled();
});
it("admite fecha bisiesta, cero legado y vencimiento vacío como NULL", async () => {
  await crearRegistro("cxc", 7, "actor", { ...obligacion, fecha: "2024-02-29", monto: 0, vencimiento: "" });
  expect(conn.execute.mock.calls[0][1]).toEqual([7, "Cliente ficticio", null, "2024-02-29", null, "0.00", "0.00"]);
});
it.each(["cuentas", "cxc", "cxp"] as TipoRegistro[])("rollback completo de %s ante fallo de insert o auditoría", async (tipo) => {
  const body = tipo === "cuentas" ? cuenta : obligacion;
  conn.execute.mockRejectedValueOnce(new Error("insert"));
  await expect(crearRegistro(tipo, 7, "actor", body)).rejects.toThrow("insert");
  vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("audit"));
  await expect(crearRegistro(tipo, 7, "actor", body)).rejects.toThrow("audit");
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledTimes(2);
  expect(conn.release).toHaveBeenCalledTimes(2);
});
it.each(["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"])("conflicto controlado %s", async (code) => {
  const res = errorRegistro({ code, sql: "secreto" });
  expect(res.status).toBe(409);
  expect(await res.text()).not.toContain("secreto");
});
