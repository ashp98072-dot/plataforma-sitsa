import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn(), audit: vi.fn(), autorizar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
import { desactivarDuplicado, listarPlacasDuplicadas, revisarPlacaDuplicada } from "./vehiculos-duplicados";
const original = () => ({ id: 10, empresa_id: 1, placa: "C-001ABC", activo: 1, estado: "Activo", en_taller: 0, descripcion: "Registro ficticio", tipo_unidad: "VEHICULO" });
let vehiculos: ReturnType<typeof original>[], referencias: number, falloInventario: boolean, campo: string, tabla: string;
const ctx = { empresaId: 1, usuario: "ficticio", autorizar: m.autorizar };
beforeEach(() => {
  vi.resetAllMocks(); vehiculos = [original(), { ...original(), id: 20, placa: "C 001ABC" }]; referencias = 0; falloInventario = false; campo = "vehiculo_id"; tabla = "flota_viajes";
  m.query.mockImplementation(async (sql: string, args: number[]) => {
    if (sql.includes("information_schema.COLUMNS")) {
      if (falloInventario) throw Error("metadatos no disponibles");
      return [[{ TABLE_NAME: "flota_vehiculos", COLUMN_NAME: "id", ENGINE: "InnoDB", TABLE_TYPE: "BASE TABLE" }, ...["id", "empresa_id", campo].map(COLUMN_NAME => ({ TABLE_NAME: tabla, COLUMN_NAME, ENGINE: "InnoDB", TABLE_TYPE: "BASE TABLE" }))]];
    }
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [[]];
    if (sql.includes("COUNT(*)")) return [[{ n: referencias }]];
    if (sql.includes(`FROM \`${tabla}\``)) return [[{ id: 100 }]];
    if (sql.includes("FROM flota_vehiculos WHERE id IN")) return [vehiculos];
    if (sql.includes("FROM flota_vehiculos v WHERE v.id=?")) return [vehiculos.filter(v => v.id === args[0])];
    if (sql.includes("FROM flota_vehiculos v WHERE")) return [vehiculos];
    if (sql.startsWith("SET TRANSACTION")) return [[]];
    throw Error(`Consulta inesperada: ${sql}`);
  });
});
async function op() { return { id: 10, conservarId: 20, revision: (await revisarPlacaDuplicada(1, 10)).vehiculo.revision, motivo: "Revision administrativa ficticia" }; }
it("agrupa por placa comparable sin fusionar IDs; sucursal ausente no se inventa", async () => {
  const g = await listarPlacasDuplicadas(1); expect(g).toHaveLength(1); expect(g[0].vehiculos.map(v => v.id)).toEqual([10, 20]); expect(g[0].vehiculos[0].sucursal).toBe("No registrada"); expect(m.execute).not.toHaveBeenCalled();
});
it.each(["flota_viajes", "flota_combustible_cargas", "flota_cb2_consumos", "flota_vehiculo_acceso"])("%s con referencias bloquea sin borrar ni reasignar", async t => {
  tabla = t; referencias = 2;
  const r = await revisarPlacaDuplicada(1, 10); expect(r.puedeDesactivar).toBe(false); expect(r.referencias[0]).toMatchObject({ tabla: t, cantidad: 2, ids: [100] });
  await expect(desactivarDuplicado(ctx, await op())).rejects.toThrow("referencias"); expect(m.execute).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce();
});
it("snapshots CB2 conservan vínculos aunque el consumo ya use otro vehículo", async () => {
  tabla = "flota_cb2_asignaciones"; campo = "anterior"; referencias = 1;
  expect((await revisarPlacaDuplicada(1, 10)).puedeDesactivar).toBe(false);
  expect(m.query.mock.calls.some(([sql]) => sql.includes("JSON_VALUE(`anterior`"))).toBe(true);
});
it("solo desactiva el ID propio sin referencias y audita en la misma transaccion", async () => {
  expect(await desactivarDuplicado(ctx, await op())).toEqual({ id: 10, activo: false, conservado: 20 });
  expect(m.execute).toHaveBeenCalledExactlyOnceWith("UPDATE flota_vehiculos SET activo=0,estado='Inactivo' WHERE empresa_id=? AND id=? AND activo=1", [1, 10]);
  expect(m.audit).toHaveBeenCalledOnce(); expect(m.commit).toHaveBeenCalledOnce(); expect(m.autorizar).toHaveBeenCalledOnce();
  expect(m.query.mock.calls.some(([sql]) => /COUNT\(\*\).*FOR UPDATE/.test(sql))).toBe(true);
});
it("referencias agregadas despues de la revisión impiden desactivar", async () => {
  const datos = await op(); referencias = 1;
  await expect(desactivarDuplicado(ctx, datos)).rejects.toThrow("referencias"); expect(m.execute).not.toHaveBeenCalled();
});
it("revisión obsoleta, otro propietario, mismo ID o placa diferente bloquean", async () => {
  const datos = await op(); vehiculos[0].descripcion = "Cambio concurrente";
  await expect(desactivarDuplicado(ctx, datos)).rejects.toThrow("cambió");
  vehiculos[0] = original(); vehiculos[1].empresa_id = 2;
  await expect(desactivarDuplicado(ctx, datos)).rejects.toMatchObject({ status: 403 });
  vehiculos[1].empresa_id = 1; vehiculos[1].placa = "OTRA";
  await expect(desactivarDuplicado(ctx, datos)).rejects.toThrow("misma placa");
  await expect(desactivarDuplicado(ctx, { ...datos, conservarId: 10 })).rejects.toThrow("distintos"); expect(m.execute).not.toHaveBeenCalled();
});
it.each([{ en_taller: 1 }, { activo: 0 }, { estado: "Reservado" }])("estado no seguro %j bloquea", async cambio => {
  Object.assign(vehiculos[0], cambio); expect((await revisarPlacaDuplicada(1, 10)).puedeDesactivar).toBe(false);
  await expect(desactivarDuplicado(ctx, await op())).rejects.toThrow("activo"); expect(m.execute).not.toHaveBeenCalled();
});
it("inventario incompleto o error de consulta falla cerrado", async () => {
  const datos = await op(); falloInventario = true;
  await expect(desactivarDuplicado(ctx, datos)).rejects.toThrow("metadatos"); expect(m.execute).not.toHaveBeenCalled();
});
it("permiso revocado bloquea; rollback y dispose fallidos preservan error original", async () => {
  const datos = await op(), error = Error("permiso revocado"); m.autorizar.mockRejectedValue(error); m.rollback.mockRejectedValue(Error("rollback")); m.destroy.mockImplementation(() => { throw Error("destroy"); });
  await expect(desactivarDuplicado(ctx, datos)).rejects.toBe(error); expect(m.execute).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce(); expect(m.destroy).toHaveBeenCalled();
});
it("commit incierto descarta conexion y exige recargar; no repite escrituras", async () => {
  m.commit.mockRejectedValue(Error("respuesta perdida"));
  await expect(desactivarDuplicado(ctx, await op())).rejects.toMatchObject({ status: 503, incierto: true });
  expect(m.destroy).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce(); // solo la lectura previa
  expect(m.execute).toHaveBeenCalledOnce();
});
it("referencias de otra empresa bloquean sin revelar conteos ni IDs ajenos", async () => {
  referencias = 4;
  const query = m.query.getMockImplementation()!;
  m.query.mockImplementation(async (sql, args) => sql.includes("AND empresa_id=?") && sql.includes(`FROM \`${tabla}\``) ? sql.includes("COUNT(*)") ? [[{ n: 0 }]] : [[]] : query(sql, args));
  const r = await revisarPlacaDuplicada(1, 10);
  expect(r.puedeDesactivar).toBe(false); expect(r.referencias).toEqual([{ tabla: "Otros ámbitos o relaciones sin empresa directa", campo: "Referencia preservada", cantidad: null, ids: [] }]);
});
it("fuente no transaccional falla cerrada", async () => {
  const query = m.query.getMockImplementation()!;
  m.query.mockImplementation(async (sql, args) => {
    const res = await query(sql, args);
    if (sql.includes("information_schema.COLUMNS")) res[0].forEach((r: Record<string, unknown>) => { r.ENGINE = "MyISAM"; });
    return res;
  });
  await expect(revisarPlacaDuplicada(1, 10)).rejects.toThrow("transaccionales"); expect(m.execute).not.toHaveBeenCalled();
});
it("misma placa con tipo o chasis contradictorios no demuestra redundancia", async () => {
  let datos = await op(); vehiculos[1].tipo_unidad = "CABEZAL";
  await expect(desactivarDuplicado(ctx, datos)).rejects.toThrow("contradictorios");
  vehiculos[1].tipo_unidad = "VEHICULO";
  Object.assign(vehiculos[0], { chasis: "FICTICIO-A" }); Object.assign(vehiculos[1], { chasis: "FICTICIO-B" }); datos = await op();
  await expect(desactivarDuplicado(ctx, datos)).rejects.toThrow("contradictorios"); expect(m.execute).not.toHaveBeenCalled();
});
