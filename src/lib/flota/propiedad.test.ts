import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), audit: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.get }), query: m.query, execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
import { guardarPropiedad, propiedadSchema, propiedadesVehiculos } from "./propiedad";
import { vehiculos } from "./cb2/repository";
const own = { tipoPropiedad: "EMPRESA", empresaPropietariaId: 2, propietarioExterno: "", tipoVehiculo: "" };
const external = { tipoPropiedad: "EXTERNO", empresaPropietariaId: null, propietarioExterno: "Mensajero particular", tipoVehiculo: "Motocicleta" };
const row = { id: 5, empresa_id: 1, placa: "C-558BSJ", tipo_propiedad: "EMPRESA", empresa_propietaria_id: null, revision_propiedad: 0, km_actual: 12345, activo: 1, estado: "Activo" };
function connection() {
  return { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("SELECT *")) return [params[1] === 1 ? [{ ...row }] : []];
      if (sql.includes("FROM empresas")) return [[{ id: 2 }]];
      return [{ insertId: 6, affectedRows: 1 }];
    }) };
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("FLOTA_PROPIEDAD_EXTERNA", "1"); });
it("cambia dueño de C-558BSJ conservando identidad, km, servicios y empresa gestora", async () => {
  const c = connection(); m.get.mockResolvedValue(c);
  await expect(guardarPropiedad(1, "operador", { ...own, id: 5, revision: 0 })).resolves.toMatchObject({ id: 5 });
  const [sql, params] = c.execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE"))!;
  expect(sql).not.toMatch(/SET empresa_id|placa =|km_actual =|servicios|cb2/);
  expect(params.slice(-2)).toEqual([5, 1]); expect(c.commit).toHaveBeenCalledOnce();
  const audit = m.audit.mock.calls[0][1]; expect(audit.usuario).toBe("operador");
  expect(JSON.parse(audit.detalle)).toMatchObject({ vehiculoId: 5, antes: { empresaPropietariaId: 1 }, despues: { empresaPropietariaId: 2 } });
});
it("registra una única moto externa con empresa administradora y sin empresa propietaria", async () => {
  const c = connection(); m.get.mockResolvedValue(c);
  expect(await guardarPropiedad(1, "actor", { ...external, placa: "m-123", odometroFuncional: false }, true)).toMatchObject({ id: 6 });
  const [sql, p] = c.execute.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO flota_vehiculos"))!;
  expect(sql).toContain("empresa_id, placa"); expect(p[0]).toBe(1); expect(p[1]).toBe("M-123");
  expect(p[7]).toBeNull(); expect(p.slice(-4)).toEqual(["EXTERNO", null, "Mensajero particular", "Motocicleta"]);
});
it("permite ambos cambios de tipo sin modificar asociaciones", async () => {
  const c = connection(); m.get.mockResolvedValue(c);
  await guardarPropiedad(1, "a", { ...external, id: 5, revision: 0 });
  expect(c.execute.mock.calls.every(([s]) => !s.includes("flota_cb2") && !s.includes("flota_vehiculo_acceso"))).toBe(true);
  c.execute.mockResolvedValueOnce([[{ ...row, tipo_propiedad: "EXTERNO", propietario_externo: "Persona" }]] as never);
  await guardarPropiedad(1, "a", { ...own, id: 5, revision: 0 });
  expect(c.commit).toHaveBeenCalledTimes(2);
});
it("rechaza tenant ajeno aunque el vehículo esté compartido", async () => {
  const c = connection(); m.get.mockResolvedValue(c);
  await expect(guardarPropiedad(9, "a", { ...own, id: 5, revision: 0 })).rejects.toMatchObject({ status: 403 });
  expect(m.audit).not.toHaveBeenCalled(); expect(c.rollback).toHaveBeenCalledOnce();
});
it("rechaza revisión obsoleta y reintentos con la misma revisión", async () => {
  const c = connection(); m.get.mockResolvedValue(c);
  c.execute.mockResolvedValueOnce([[{ ...row, revision_propiedad: 2 }]] as never);
  await expect(guardarPropiedad(1, "a", { ...own, id: 5, revision: 0 })).rejects.toMatchObject({ status: 409 });
  expect(c.commit).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
it.each(["update", "audit", "commit"])("hace rollback si falla %s", async stage => {
  const c = connection(); m.get.mockResolvedValue(c);
  if (stage === "audit") m.audit.mockRejectedValueOnce(Error("audit"));
  if (stage === "commit") c.commit.mockRejectedValueOnce(Error("commit"));
  if (stage === "update") c.execute.mockResolvedValueOnce([[row]] as never).mockResolvedValueOnce([[{ id: 2 }]] as never).mockRejectedValueOnce(Error("write"));
  await expect(guardarPropiedad(1, "a", { ...own, id: 5, revision: 0 })).rejects.toThrow();
  expect(c.rollback).toHaveBeenCalledOnce(); expect(c.release).toHaveBeenCalledOnce();
});
it("valida datos externos y empresa propietaria", () => {
  expect(propiedadSchema.safeParse({ ...external, propietarioExterno: " " }).success).toBe(false);
  expect(propiedadSchema.safeParse({ ...external, empresaPropietariaId: 1 }).success).toBe(false);
  expect(propiedadSchema.safeParse({ ...external, tipoVehiculo: "" }).success).toBe(false);
  expect(propiedadSchema.safeParse({ ...own, empresaPropietariaId: null }).success).toBe(false);
});
it("rechaza una empresa inexistente/inactiva y revierte el alta si fallan filtros", async () => {
  const c = connection(); m.get.mockResolvedValue(c);
  c.execute.mockResolvedValueOnce([[row]] as never).mockResolvedValueOnce([[]] as never);
  await expect(guardarPropiedad(1, "a", { ...own, id: 5, revision: 0 })).rejects.toThrow("activa");
  c.execute.mockResolvedValueOnce([{ insertId: 6 }] as never).mockRejectedValueOnce(Error("filtros"));
  await expect(guardarPropiedad(1, "a", { ...external, placa: "M-123" }, true)).rejects.toThrow("filtros");
  expect(c.rollback).toHaveBeenCalledTimes(2); expect(c.commit).not.toHaveBeenCalled();
});
it("apagada por defecto: no abre conexión", async () => {
  vi.stubEnv("FLOTA_PROPIEDAD_EXTERNA", "");
  await expect(guardarPropiedad(1, "a", {})).rejects.toMatchObject({ status: 503 }); expect(m.get).not.toHaveBeenCalled();
});
it("enriquece solo ids accesibles en un único lote parametrizado", async () => {
  m.query.mockResolvedValue([{ ...row }]); expect((await propiedadesVehiculos([5])).has(5)).toBe(true);
  expect(m.query).toHaveBeenCalledWith(expect.stringContaining("WHERE v.id IN (?)"), [5]);
  await propiedadesVehiculos([]); expect(m.query).toHaveBeenCalledOnce();
});
it("CB2 admite la moto externa por empresa gestora, sin permisos de otras empresas", async () => {
  const c = { query: vi.fn(async () => [[{ ...row, tipo_propiedad: "EXTERNO", empresa_propietaria_id: null }]]) };
  const result = await vehiculos(c as never, { empresaId: 1 } as never, [5]);
  expect(result.get(5)).toBeDefined(); expect(c.query).toHaveBeenCalledOnce();
});
