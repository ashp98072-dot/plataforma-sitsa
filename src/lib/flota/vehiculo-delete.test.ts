import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlota: vi.fn(), requireTenantFlotaAny: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(), asegurarSchemaFlotaLectura: vi.fn() }));
vi.mock("@/lib/flota/acceso", () => ({
  empresasAccesoPorVehiculos: vi.fn(), guardarAccesoVehiculo: vi.fn(),
  listarEmpresasActivasSimple: vi.fn(), listarVehiculosAccesibles: vi.fn(),
  obtenerVehiculoAccesible: vi.fn(),
}));
vi.mock("@/lib/flota/filtros", () => ({ guardarFiltrosVehiculo: vi.fn(), listarFiltrosPorVehiculos: vi.fn() }));

import { DELETE } from "@/app/api/empresas/[slug]/flota/vehiculos/route";
import { execute, getPool, query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";

const conn = {
  beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(),
  commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn(),
};
const getConnection = vi.fn();
const request = (modo = "eliminar") => DELETE(
  new Request(`http://localhost/api/empresas/kt/flota/vehiculos?id=7&modo=${modo}`, { method: "DELETE" }),
  { params: Promise.resolve({ slug: "kt" }) },
);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantFlota).mockResolvedValue({
    empresa: { id: 3 }, session: { id: 1 },
  } as Awaited<ReturnType<typeof requireTenantFlota>>);
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.query.mockResolvedValueOnce([[{ id: 7, placa: "PRUEBA" }], []]).mockResolvedValue([[], []]);
  conn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
});
afterEach(() => vi.restoreAllMocks());

describe("DELETE físico de vehículos", () => {
  it("bloquea primero la unidad del tenant y confirma todos los borrados en una conexión", async () => {
    expect((await request()).status).toBe(200);
    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain("empresa_id = ? LIMIT 1 FOR UPDATE");
    expect(conn.query.mock.calls[0][1]).toEqual([7, 3]);
    expect(conn.query.mock.calls[1][0]).toContain("FOR UPDATE");
    expect(conn.query.mock.calls[1][0]).toContain("ops_multas_revisiones");
    expect(conn.query.mock.calls[1][1]).toEqual([3, 7]);
    expect(conn.query.mock.calls[2][0]).toContain("flota_viajes");
    expect(conn.execute).toHaveBeenCalledTimes(9);
    expect(conn.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(conn.query.mock.invocationCallOrder[0]);
    expect(conn.query.mock.invocationCallOrder[1]).toBeLessThan(conn.execute.mock.invocationCallOrder[0]);
    expect(conn.execute.mock.invocationCallOrder[8]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    for (const [sql] of conn.execute.mock.calls) expect(sql).not.toMatch(/ops_multas|ops_multa_documentos/);
    expect(conn.execute.mock.calls[8][1]).toEqual([7, 3]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("revierte todo cuando falla el borrado %i, incluso la FK final", async (paso) => {
    conn.execute.mockReset();
    for (let i = 1; i < paso; i++) conn.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    conn.execute.mockRejectedValueOnce(new Error("Fallo simulado"));
    expect((await request()).status).toBe(500);
    expect(conn.execute).toHaveBeenCalledTimes(paso);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("no borra nada si la unidad no pertenece a la empresa", async () => {
    conn.query.mockReset().mockResolvedValueOnce([[], []]);
    expect((await request()).status).toBe(404);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("rechaza un viaje abierto antes de borrar dependencias", async () => {
    conn.query.mockReset().mockResolvedValueOnce([[{ id: 7, placa: "PRUEBA" }], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ id: 9 }], []]);
    expect((await request()).status).toBe(409);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("rechaza cualquier revisión histórica de multas antes de borrar dependencias", async () => {
    conn.query.mockReset().mockResolvedValueOnce([[{ id: 7, placa: "PRUEBA" }], []]).mockResolvedValueOnce([[{ id: 12 }], []]);
    const response = await request();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Dar de baja");
    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(conn.query.mock.calls[1][0]).not.toMatch(/estado|periodo/);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("falla cerrado sin borrados si aún no se aplicó la migración de Multas", async () => {
    conn.query.mockReset().mockResolvedValueOnce([[{ id: 7, placa: "PRUEBA" }], []])
      .mockRejectedValueOnce(Object.assign(new Error("Tabla inexistente"), { code: "ER_NO_SUCH_TABLE" }));
    expect((await request()).status).toBe(500);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("no adquiere conexión sin permiso eliminar", async () => {
    vi.mocked(requireTenantFlota).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFlota>>);
    expect((await request()).status).toBe(403);
    expect(requireTenantFlota).toHaveBeenCalledWith("kt", "flota_vehiculos", "eliminar");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("revierte si el DELETE final no afecta exactamente una unidad", async () => {
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, []]);
    expect((await request()).status).toBe(500);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("descarta la conexión si falla también el rollback", async () => {
    conn.execute.mockRejectedValueOnce(new Error("DELETE"));
    conn.rollback.mockRejectedValueOnce(new Error("ROLLBACK"));
    expect((await request()).status).toBe(500);
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("conserva Dar de baja sin utilizar la transacción de borrado físico", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 7, placa: "PRUEBA", activo: 1 }] as RowDataPacket[]).mockResolvedValueOnce([]);
    expect((await request("baja")).status).toBe(200);
    expect(requireTenantFlota).toHaveBeenCalledWith("kt", "flota_vehiculos", "editar");
    expect(getConnection).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("SET activo = 0"), [7, 3]);
  });
});
