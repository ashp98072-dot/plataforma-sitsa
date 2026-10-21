import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), auditar: vi.fn(), validar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }) }));
vi.mock("./combustible-fondos", () => ({ validarLineaFondoCombustibleTx: m.validar }));
vi.mock("./acceso", () => ({ obtenerVehiculoAccesibleTx: async () => ({ id: 7, activo: 1 }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: async () => ({ relative: "empresas/1/flota/a.pdf", original: "a.pdf", size: 1 }), contentTypeFor: () => "application/pdf", validarRutaArchivoEmpresa: () => true, borrarUpload: vi.fn() }));
import { guardarCombustibleStaff } from "./combustible-staff";
import { combustibleStaffSchema } from "./combustible-staff-schema";
const input = { estacionId: 55, vehiculoId: 7, numeroVale: "A", fechaConsumo: "2026-10-15", tipoCombustible: "diesel" as const, galones: "1", monto: "30", km: null, gasolinera: "", observaciones: "" };
const actor = { usuarioId: 8, username: "op" };
let actual: object;
beforeEach(() => {
  vi.resetAllMocks(); actual = { id: 11, estado: "PENDIENTE", vehiculo_id: 7, proveedor_id: 3, estacion_id: 55, solicitud_fondo_linea_id: 42, ruta_relativa: "empresas/1/flota/a.pdf" };
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM compras_proveedores")) return [[{ id: 3, activo: 1 }]];
    if (sql.includes("SELECT proveedor_id, estacion_id FROM flota_combustible_cargas")) return [[{ proveedor_id: 3, estacion_id: 55 }]];
    if (sql.includes("SELECT proveedor_id FROM flota_combustible_estaciones")) return [[{ proveedor_id: 3 }]];
    if (sql.includes("LOCK IN SHARE MODE")) return [[{ id: 55, nombre: "Shell Roosevelt", activo: 1 }]];
    if (sql.includes("SELECT id, estado")) return [[actual]];
    return [[]];
  });
  m.execute.mockResolvedValue([{ insertId: 11 }]);
});
it("edición omitiendo conserva vínculo validado", async () => {
  await guardarCombustibleStaff(1, actor, input, null, 11);
  expect(m.validar).toHaveBeenCalledWith(m, 1, 42, 7);
  expect(m.execute.mock.calls.at(-1)?.[1]).toEqual([42, 1, 11]);
});
it("edición cambia vínculo y audita anterior/nuevo", async () => {
  await guardarCombustibleStaff(1, actor, { ...input, solicitudFondoLineaId: 43 }, null, 11);
  expect(m.execute.mock.calls.at(-1)?.[1]).toEqual([43, 1, 11]);
  expect(m.auditar.mock.calls[0][1].detalle).toContain("42 -> 43"); expect(m.commit).toHaveBeenCalledOnce();
});
it("edición NULL quita sin resolver otra línea", async () => {
  await guardarCombustibleStaff(1, actor, { ...input, solicitudFondoLineaId: null }, null, 11);
  expect(m.validar).not.toHaveBeenCalled(); expect(m.execute.mock.calls.at(-1)?.[1]).toEqual([null, 1, 11]);
});
it("vale sin solicitud sigue válido y múltiples vales admiten misma línea", async () => {
  const file = { name: "a.pdf", size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
  await guardarCombustibleStaff(1, actor, input, file);
  expect(m.validar).not.toHaveBeenCalled();
  for (const numeroVale of ["B", "C"]) await guardarCombustibleStaff(1, actor, { ...input, numeroVale, solicitudFondoLineaId: 42 }, file);
  expect(m.validar).toHaveBeenCalledTimes(2); expect(m.commit).toHaveBeenCalledTimes(3);
});
it("rechazo de línea revierte antes de persistir o auditar", async () => {
  m.validar.mockRejectedValue(new Error("Línea no elegible"));
  await expect(guardarCombustibleStaff(1, actor, input, null, 11)).rejects.toThrow("no elegible");
  expect(m.rollback).toHaveBeenCalledOnce(); expect(m.execute).not.toHaveBeenCalled(); expect(m.auditar).not.toHaveBeenCalled();
});
it.each(["APROBADO", "RECHAZADO"])("%s no amplía edición", async estado => {
  actual = { ...actual, estado };
  await expect(guardarCombustibleStaff(1, actor, { ...input, solicitudFondoLineaId: 43 }, null, 11)).rejects.toThrow("pendientes");
  expect(m.validar).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
});
it("un vale solo admite una referencia escalar válida, no una lista", () => {
  for (const solicitudFondoLineaId of [[42, 43], "42,43", 0, -1, "otro"]) {
    expect(combustibleStaffSchema.safeParse({ ...input, solicitudFondoLineaId }).success).toBe(false);
  }
});
