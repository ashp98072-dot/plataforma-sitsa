import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { cuadrillaSchema, cuadrillaPayload, textoCuadrilla } from "./cuadrilla-contrato";
import { cuadrillaDePlanes, guardarCuadrillaPlan, resolverCuadrilla, validarCuadrillaRoles } from "./cuadrilla";

const interno = { tipo: "INTERNO" as const, empleadoId: 55, nombre: "Nombre servidor", identificacion: null, telefono: null };
const externo = { tipo: "EXTERNO" as const, empleadoId: null, nombre: "Externo", identificacion: "DPI", telefono: "123" };
const q = vi.fn(); const exec = vi.fn();
const conn = { query: q, execute: exec } as unknown as PoolConnection;
beforeEach(() => { vi.resetAllMocks(); q.mockResolvedValue([[]]); exec.mockResolvedValue([{ affectedRows: 1 }]); });

describe("Cuadrilla: contrato independiente", () => {
  it.each(["", "   "])("externo requiere nombre: %j", (nombre) => expect(cuadrillaSchema.safeParse([{ tipo: "EXTERNO", nombre }]).success).toBe(false));
  it("identificación/teléfono son opcionales", () => expect(cuadrillaSchema.safeParse([{ tipo: "EXTERNO", nombre: "Juan" }]).success).toBe(true));
  it("no acepta nombre interno del navegador", () => expect(cuadrillaSchema.safeParse([{ tipo: "INTERNO", empleadoId: 55, nombre: "Falso" }]).success).toBe(false));
  it("no acepta empleadoId externo", () => expect(cuadrillaSchema.safeParse([{ tipo: "EXTERNO", nombre: "Juan", empleadoId: 55 }]).success).toBe(false));
  it("rechaza internos duplicados", () => expect(cuadrillaSchema.safeParse([{ tipo: "INTERNO", empleadoId: 55 }, { tipo: "INTERNO", empleadoId: 55 }]).success).toBe(false));
  it("admite mezcla y convierte histórico sin reenviar nombre interno", () => expect(cuadrillaPayload([interno, externo])).toEqual([
    { tipo: "INTERNO", empleadoId: 55 }, { tipo: "EXTERNO", nombre: "Externo", identificacion: "DPI", telefono: "123" },
  ]));
  it("reporte distingue roles sin identificación/teléfono", () => expect(textoCuadrilla([interno, externo])).toBe("Nombre servidor (interno)\nExterno (externo)"));
});
describe("Cuadrilla: modelo tenant y transacción", () => {
  it("nombre interno viene del servidor", async () => {
    q.mockResolvedValueOnce([[{ id: 55, nombre: "Nombre servidor", estado: "Activo" }]]);
    expect(await resolverCuadrilla(7, [{ tipo: "INTERNO", empleadoId: 55 }], conn)).toEqual([interno]);
    expect(q.mock.calls[0][0]).toContain("empresa_id = ?"); expect(q.mock.calls[0][1]).toEqual([7, 55]);
  });
  it("rechaza empleado ajeno/inexistente", async () => expect(resolverCuadrilla(7, [{ tipo: "INTERNO", empleadoId: 55 }], conn)).rejects.toThrow("no pertenece"));
  it("rechaza inactivo nuevo", async () => {
    q.mockResolvedValueOnce([[{ id: 55, nombre: "Juan", estado: "Inactivo" }]]);
    await expect(resolverCuadrilla(7, [{ tipo: "INTERNO", empleadoId: 55 }], conn)).rejects.toThrow("no está activo");
  });
  it("conserva snapshot histórico/inactivo si no cambia identidad", async () => {
    q.mockResolvedValueOnce([[{ id: 55, nombre: "Nombre cambiado", estado: "Inactivo" }]]);
    expect(await resolverCuadrilla(7, [{ tipo: "INTERNO", empleadoId: 55 }], conn, [interno])).toEqual([interno]);
  });
  it("externo no consulta ni escribe RRHH/personal", async () => {
    expect(await resolverCuadrilla(7, [{ tipo: "EXTERNO", nombre: "Externo" }], conn)).toEqual([{ ...externo, identificacion: null, telefono: null }]);
    expect(q).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it("evita duplicar piloto/auxiliar por identidad física", async () => {
    q.mockResolvedValueOnce([[{ id_empleado: 55 }]]);
    await expect(validarCuadrillaRoles(7, [interno], [100], conn)).rejects.toThrow("también piloto o auxiliar");
  });
  it("sin cuadrilla interna no consulta roles", async () => { await validarCuadrillaRoles(7, [externo], [100], conn); expect(q).not.toHaveBeenCalled(); });
  it("guarda solamente la asignación separada con 8 columnas/valores", async () => {
    q.mockResolvedValueOnce([[{ id: 40 }]]);
    await guardarCuadrillaPlan(7, 40, [interno, externo], conn);
    expect(exec.mock.calls[0]).toEqual(["DELETE FROM tms_plan_cuadrilla WHERE empresa_id = ? AND plan_id = ?", [7, 40]]);
    expect(exec.mock.calls[1][1]).toEqual([7, 40, 1, "INTERNO", 55, "Nombre servidor", null, null]);
    expect(exec.mock.calls[2][1]).toEqual([7, 40, 2, "EXTERNO", null, "Externo", "DPI", "123"]);
    expect(exec.mock.calls.every(([sql]) => !/tms_viaticos|tms_plan_auxiliares|INSERT INTO empleados|INSERT INTO tms_personal/.test(String(sql)))).toBe(true);
  });
  it("quitar todos borra solo asignaciones propias", async () => { q.mockResolvedValueOnce([[{ id: 40 }]]); await guardarCuadrillaPlan(7, 40, [], conn); expect(exec).toHaveBeenCalledTimes(1); });
  it("no escribe si el plan no pertenece al tenant", async () => { await expect(guardarCuadrillaPlan(7, 40, [interno], conn)).rejects.toThrow("esta empresa"); expect(exec).not.toHaveBeenCalled(); });
  it("lectura carga por empresa, plan y orden", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ plan_id: 40, tipo: "INTERNO", id_empleado: 55, nombre: "Nombre servidor", identificacion: null, telefono: null }] as never);
    expect((await cuadrillaDePlanes(7, [40])).get(40)).toEqual([interno]);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, 40]); expect(vi.mocked(query).mock.calls[0][0]).toContain("p.empresa_id = c.empresa_id");
  });
  it("fallos de escritura propagan para rollback del caller", async () => { q.mockResolvedValueOnce([[{ id: 40 }]]); exec.mockRejectedValueOnce(new Error("fallo")); await expect(guardarCuadrillaPlan(7, 40, [interno], conn)).rejects.toThrow("fallo"); });
});
