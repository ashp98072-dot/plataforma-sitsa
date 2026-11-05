import { beforeEach, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
const m = vi.hoisted(() => ({ query: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }) }));
import { bancoVisible, consultarBancos, SQL_BANCOS } from "./bancos";
import { textoBanco } from "./bancos-shared";
const ambito = { entidadId: 5, usuarioId: 91, admin: false };
beforeEach(() => { vi.clearAllMocks(); m.query.mockResolvedValue([[]]); });
it("DTO mínimo sin referencia ni campos arbitrarios; no inventa valores", () => {
  const r = bancoVisible({ id: 1, banco: " ", alias: "1234-5678-9012", moneda: "", activa: 0, referencia: "123456789012", password: "privado", cuenta_id: null } as RowDataPacket);
  expect(r).toMatchObject({ banco: null, alias: "[dato bancario omitido]", moneda: null, activa: false, cuenta: null });
  expect(JSON.stringify(r)).not.toMatch(/123456789012|referencia|password|privado/);
  expect(r.advertencias).toContain("Cuenta contable no disponible en esta entidad.");
  expect(SQL_BANCOS).not.toMatch(/referencia|SELECT\s+\*/);
});
it("cuenta inactiva/incompleta y estado desconocido tienen advertencias explícitas", () => {
  const r = bancoVisible({ id: 1, banco: "Banco QA", alias: "QA", moneda: "GTQ", activa: 4, cuenta_id: 8, cuenta_codigo: "11103002", cuenta_nombre: "Bancos", cuenta_activa: 0 } as RowDataPacket);
  expect(r.cuenta?.codigo).toBe("11103002"); expect(r.activa).toBeNull();
  expect(r.advertencias).toContain("Cuenta contable inactiva.");
  expect(r.advertencias).toContain("Estado bancario sin configurar.");
  expect(textoBanco("Cuenta 1234 5678 9000")).toBe("Cuenta [dato bancario omitido]");
});
it("consulta sólo lectura scoped, orden determinista y conexión liberada", async () => {
  m.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT id,activa") ? [[{ id: 5, activa: 1 }]] : [[]]);
  expect(await consultarBancos(7, ambito)).toEqual([]);
  expect(m.query).toHaveBeenCalledWith(SQL_BANCOS, [7, 5]);
  expect(m.query).toHaveBeenCalledWith("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
  expect(SQL_BANCOS).toContain("c.empresa_id=b.empresa_id AND c.entidad_id=b.entidad_id");
  expect(m.commit).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce();
});
it.each([{ entidades: [] }, { entidades: [{ id: 5, activa: 0 }] }])("entidad ausente/ajena o inactiva no consulta bancos", async ({ entidades }) => {
  m.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT id,activa") ? [entidades] : [[]]);
  await expect(consultarBancos(7, ambito)).rejects.toMatchObject({ status: 404 });
  expect(m.query).not.toHaveBeenCalledWith(SQL_BANCOS, expect.anything());
  expect(m.rollback).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce();
});
it("Admin puede consultar historia de una entidad inactiva de su empresa", async () => {
  m.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT id,activa") ? [[{ id: 5, activa: 0 }]] : [[]]);
  expect(await consultarBancos(7, { ...ambito, admin: true })).toEqual([]);
});
