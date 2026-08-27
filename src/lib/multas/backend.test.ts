import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantMultas: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { requireTenantMultas } from "@/lib/tenant";
import { GET, POST } from "@/app/api/empresas/[slug]/operaciones/multas/route";
import { PATCH } from "@/app/api/empresas/[slug]/operaciones/multas/[id]/route";
import { GET as getRevisiones, POST as postRevision } from "@/app/api/empresas/[slug]/operaciones/multas/revisiones/route";
import { nuevaMulta } from "./reglas";

const input = { revision_id: 2, vehiculo_id: 3, fecha_infraccion: "2026-08-01", tipo_multa: "Prueba",
  descripcion: "Caso sintético", monto_total: "100.00", tipo_responsabilidad: "POR_DEFINIR", resolucion_economica: "PENDIENTE" };
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const idCtx = { params: Promise.resolve({ slug: "prueba", id: "9" }) };
const req = (data: unknown, method = "POST") => new Request("http://localhost/api/empresas/prueba/operaciones/multas", { method, body: JSON.stringify(data) });
const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() };
const getConnection = vi.fn();
const revision = { vehiculo_id: 3, anio: 2026, mes: 8 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantMultas).mockResolvedValue({ empresa: { id: 7 }, session: { id: 8, username: "prueba" } } as Awaited<ReturnType<typeof requireTenantMultas>>);
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("flota_vehiculos")) return [[{ id: 3, placa: "TEST-001" }], []];
    if (sql.includes("ops_multas_revisiones")) return [sql.includes("periodo_anio") ? [] : [{ id: 2 }], []];
    if (sql.includes("empleados")) return [[{ id: 5 }], []];
    if (sql.includes("ops_multas")) return [[{ ...nuevaMulta(input), id: 9, empresa_id: 7, placa_historica: "TEST-001" }], []];
    throw new Error("Consulta inesperada");
  });
  conn.execute.mockResolvedValue([{ affectedRows: 1, insertId: 9 }, []]);
  vi.mocked(query).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());
describe("backend Multas transaccional", () => {
  it("revisión verificada y auditoría usan una conexión y commit final", async () => {
    expect((await postRevision(req(revision), ctx)).status).toBe(201);
    expect(requireTenantMultas).toHaveBeenCalledWith("prueba", "crear");
    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(conn.query.mock.calls[0][1]).toEqual([7, 3]);
    expect(conn.execute.mock.calls[0][0]).toContain("NOW()");
    expect(conn.execute.mock.calls[0][1]).toEqual([7, 3, 2026, 8, 8, null]);
    expect(conn.execute.mock.calls[1][0]).toContain("INSERT INTO auditoria");
    expect(conn.execute.mock.calls[1][1]).toContain("revision_multa_creada");
    expect(conn.execute.mock.invocationCallOrder[1]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
    expect(conn.commit).toHaveBeenCalledTimes(1); expect(conn.release).toHaveBeenCalledTimes(1);
  });
  it("revisión mensual duplicada devuelve 409 y no inserta", async () => {
    conn.query.mockResolvedValue([[{ id: 3 }], []]);
    expect((await postRevision(req(revision), ctx)).status).toBe(409);
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
  it("duplicado detectado por UNIQUE devuelve 409 y rollback", async () => {
    conn.execute.mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });
    expect((await postRevision(req(revision), ctx)).status).toBe(409);
    expect(conn.rollback).toHaveBeenCalledTimes(1); expect(conn.commit).not.toHaveBeenCalled();
  });
  it.each(["revision", "multa"])("%s rechaza unidad ajena/compartida sin propiedad", async (tipo) => {
    conn.query.mockResolvedValueOnce([[], []]);
    const response = tipo === "revision" ? await postRevision(req(revision), ctx) : await POST(req(input), ctx);
    expect(response.status).toBe(404);
    expect(conn.query.mock.calls[0][1]).toEqual([7, 3]);
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
  it("rechaza revisión de otra empresa/vehículo", async () => {
    conn.query.mockResolvedValueOnce([[{ id: 3, placa: "TEST-001" }], []]).mockResolvedValueOnce([[], []]);
    expect((await POST(req(input), ctx)).status).toBe(404);
    expect(conn.query.mock.calls[1][1]).toEqual([7, 2, 3]);
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it.each(["alta", "edicion"])("rechaza empleado ajeno en %s", async (operacion) => {
    const original = conn.query.getMockImplementation()!;
    conn.query.mockImplementation((sql: string, ...args: unknown[]) => sql.includes("empleados") ? Promise.resolve([[], []]) : original(sql, ...args));
    const response = operacion === "alta"
      ? await POST(req({ ...input, tipo_responsabilidad: "PILOTO", empleado_responsable_id: 5 }), ctx)
      : await PATCH(req({ accion: "responsable", tipo_responsabilidad: "PILOTO", empleado_responsable_id: 5 }, "PATCH"), idCtx);
    expect(response.status).toBe(400);
    expect(conn.query.mock.calls.find(([sql]) => sql.includes("empleados"))?.[1]).toEqual([7, 5]);
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
  it("alta copia placa desde Flota y atribuye auditoría al usuario autenticado", async () => {
    expect((await POST(req(input), ctx)).status).toBe(201);
    expect(conn.execute.mock.calls[0][1].slice(0, 4)).toEqual([7, "TEST-001", 8, 8]);
    expect(conn.execute.mock.calls[1][1].slice(0, 4)).toEqual([7, "prueba", "multa_creada", "multas"]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
  it.each(["revision", "alta", "patch"])("auditoría fallida revierte %s", async (operacion) => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("auditoria")) throw new Error("Auditoría no disponible");
      return [{ affectedRows: 1, insertId: 9 }, []];
    });
    const response = operacion === "revision" ? await postRevision(req(revision), ctx)
      : operacion === "alta" ? await POST(req(input), ctx)
        : await PATCH(req({ accion: "pagar" }, "PATCH"), idCtx);
    expect(response.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalledTimes(1); expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
  it("PATCH bloquea fila propia, UPDATE condicional y auditado", async () => {
    expect((await PATCH(req({ accion: "pagar" }, "PATCH"), idCtx)).status).toBe(200);
    expect(requireTenantMultas).toHaveBeenCalledWith("prueba", "editar");
    expect(conn.query.mock.calls[0][0]).toContain("empresa_id = ? AND id = ? FOR UPDATE");
    expect(conn.query.mock.calls[0][1]).toEqual([7, 9]);
    expect(conn.execute.mock.calls[0][0]).toContain("AND estado = ? AND estado_pago = ? AND estado_descuento = ?");
    expect(conn.execute.mock.calls[1][1]).toContain("multa_pagada");
  });
  it("PATCH rechaza multa ajena antes de escribir", async () => {
    conn.query.mockResolvedValueOnce([[], []]);
    expect((await PATCH(req({ accion: "pagar" }, "PATCH"), idCtx)).status).toBe(404);
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("affectedRows=0 no confirma ni audita", async () => {
    conn.execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    expect((await PATCH(req({ accion: "pagar" }, "PATCH"), idCtx)).status).toBe(409);
    expect(conn.execute).toHaveBeenCalledTimes(1); expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
  it("rollback fallido descarta conexión", async () => {
    conn.execute.mockRejectedValueOnce(new Error("Insert")); conn.rollback.mockRejectedValueOnce(new Error("Rollback"));
    expect((await postRevision(req(revision), ctx)).status).toBe(500);
    expect(conn.destroy).toHaveBeenCalledTimes(1); expect(conn.release).not.toHaveBeenCalled();
  });
  it("GET pendientes no restringe período ni escribe; filtra tenant", async () => {
    expect((await GET(new Request("http://localhost/?vista=pendientes&anio=2026&mes=8"), ctx)).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([7]); expect(sql).not.toContain("r.periodo_mes = ?");
    expect(sql).toContain("m.estado <> 'ANULADA'"); expect(getConnection).not.toHaveBeenCalled();
  });
  it("GET actividad usa período de revisión y vehículo con paginación", async () => {
    expect((await GET(new Request("http://localhost/?anio=2026&mes=8&vehiculo_id=3&pagina=2"), ctx)).status).toBe(200);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, 2026, 8, 3]);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("OFFSET 100");
  });
  it("GET revisiones deriva conteos/importes sin anuladas", async () => {
    expect((await getRevisiones(new Request("http://localhost/?anio=2026&mes=8"), ctx)).status).toBe(200);
    const sql = vi.mocked(query).mock.calls[0][0];
    expect(sql).toContain("COUNT(*)"); expect(sql).toContain("SUM(m.monto_total)");
    expect(sql.match(/m.estado <> 'ANULADA'/g)).toHaveLength(2);
    expect(getConnection).not.toHaveBeenCalled();
  });
  it.each(["GET", "POST", "PATCH", "REVISION_GET", "REVISION_POST"])("%s sin permiso retorna 403 antes de DB", async (method) => {
    vi.mocked(requireTenantMultas).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantMultas>>);
    const response = method === "GET" ? await GET(new Request("http://localhost/"), ctx)
      : method === "POST" ? await POST(req(input), ctx)
        : method === "PATCH" ? await PATCH(req({ accion: "pagar" }, "PATCH"), idCtx)
          : method === "REVISION_GET" ? await getRevisiones(new Request("http://localhost/"), ctx)
            : await postRevision(req(revision), ctx);
    expect(response.status).toBe(403); expect(getConnection).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });
});
