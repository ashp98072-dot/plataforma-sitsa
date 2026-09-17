import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn(), conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() } }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ getConnection: async () => m.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
import { catalogosCompra, CONFLICTO_COMPRA, guardarRequerimiento, listarRequerimientos, obtenerRequerimiento } from "./requerimientos";
import { crearRequerimientoSchema, editarRequerimientoSchema, filtrosCompraSchema, type RequerimientoDatos } from "./requerimiento-schema";

const linea = { fecha: "2026-09-17", proveedor_id: 3, vehiculo_id: null, repuesto_descripcion: "Filtro", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "10.25" };
const payload = { fecha_requerimiento: "2026-09-17", entidad_requirente_id: 4, requirente_usuario_id: 9, lineas: [linea] };
let proveedor: Record<string, unknown>, cabecera: Record<string, unknown> | null, existentes: Record<string, unknown>[], documento: boolean;
beforeEach(() => {
  vi.resetAllMocks(); cabecera = { id: 12, codigo: "RC-2026-000012", estado: "Pendiente", version: 2, total: "20.50" };
  proveedor = { id: 3, activo: 1, nombre_comercial: "Proveedor real", razon_social: "Sociedad", nit: "123", banco: "Banco real", numero_cuenta: "privada", dias_credito: 30 };
  existentes = [{ ...linea, id: 21, proveedor_nombre_snapshot: "Histórico", proveedor_razon_social_snapshot: null, proveedor_nit_snapshot: null, banco_snapshot: null, numero_cuenta_snapshot: null, dias_credito_snapshot: null }, { ...linea, id: 22 }]; documento = false;
  m.conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM compras_linea_documentos")) return [documento ? [{ id: 44 }] : []];
    if (sql.includes("FROM compras_requerimientos")) return [cabecera ? [cabecera] : []];
    if (sql.includes("FROM compras_requerimiento_lineas")) return [existentes];
    if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Entidad real" }]];
    if (sql.includes("FROM usuarios")) return [[{ nombre: "Usuario real", rol_global: "Operaciones" }]];
    if (sql.includes("FROM compras_proveedores")) return [proveedor ? [proveedor] : []];
    if (sql.includes("FROM flota_vehiculos")) return [[{ id: 5, activo: 1, placa: "C-123ABC", descripcion: "Cabezal" }]];
    throw new Error(`SQL inesperado: ${sql}`);
  });
  m.conn.execute.mockResolvedValue([{ insertId: 12, affectedRows: 1 }]); m.query.mockResolvedValue([]);
});
const crear = () => guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse(payload), false);

describe("requirentes exclusivamente Operaciones", () => {
  it("encargado no Operaciones permitido; requirente sí exige Operaciones", async () => {
    const original = m.conn.query.getMockImplementation()!;
    m.conn.query.mockImplementation(async (sql: string, params: unknown[]) => sql.includes("FROM usuarios") && params[1] === 20
      ? [[{ nombre: "Encargada Contabilidad", rol_global: "Contabilidad" }]] : original(sql, params));
    await guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse({ ...payload, encargado_compras_usuario_id: 20 }), false);
    expect(m.conn.execute.mock.calls[0][1]).toContain("Encargada Contabilidad");
    expect(m.conn.commit).toHaveBeenCalledOnce();
  });
  it("catálogo separa requirentes y encargado sin duplicar consultas ni exponer roles", async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes("FROM usuarios") ? [
      { id: 9, nombre: "Operador", rol_global: "Operaciones" },
      { id: 10, nombre: "Contadora", rol_global: "Contabilidad" },
    ] : []);
    const c = await catalogosCompra(1);
    expect(c.requirentesOperaciones).toEqual([{ id: 9, nombre: "Operador" }]);
    expect(c.usuarios).toEqual([{ id: 9, nombre: "Operador" }, { id: 10, nombre: "Contadora" }]);
    expect(m.query).toHaveBeenCalledTimes(4);
  });
  it.each(["Contabilidad", "Admin", "Gerencia", null])("rechaza rol %s nuevo sin escrituras", async rol => {
    const original = m.conn.query.getMockImplementation()!;
    m.conn.query.mockImplementation(async (sql: string, params: unknown[]) => sql.includes("FROM usuarios")
      ? [[{ nombre: "Ajeno a Operaciones", rol_global: rol }]] : original(sql, params));
    await expect(crear()).rejects.toThrow("La persona que requiere debe ser un usuario de Operaciones.");
    expect(m.conn.execute).not.toHaveBeenCalled(); expect(m.conn.rollback).toHaveBeenCalledOnce();
  });
  it.each(["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones"])("acepta rol %s", async rol => {
    const original = m.conn.query.getMockImplementation()!;
    m.conn.query.mockImplementation(async (sql: string, params: unknown[]) => sql.includes("FROM usuarios")
      ? [[{ nombre: "Servidor", rol_global: rol }]] : original(sql, params));
    await crear(); expect(m.conn.commit).toHaveBeenCalledOnce();
  });
  it.each([9, null])("conserva requirente histórico %s sin consultar su rol ni reemplazar nombre", async id => {
    cabecera = { ...cabecera, requirente_usuario_id: id, requirente_nombre: "Snapshot anterior" };
    await editar({ requirente_usuario_id: id, observaciones: "Otra edición" });
    expect(m.conn.query.mock.calls.some(([sql]) => sql.includes("FROM usuarios"))).toBe(false);
    const [, params] = m.conn.execute.mock.calls.find(([sql]) => sql.startsWith("UPDATE compras_requerimientos"))!;
    expect(params).toContain("Snapshot anterior"); expect(params[3]).toBe(id);
  });
  it("cambio de histórico revalida Operaciones sin afectar encargado ni solicitante", async () => {
    cabecera = { ...cabecera, requirente_usuario_id: 10, requirente_nombre: "Anterior" };
    const original = m.conn.query.getMockImplementation()!;
    m.conn.query.mockImplementation(async (sql: string, params: unknown[]) => sql.includes("FROM usuarios")
      ? [[{ nombre: "Contadora", rol_global: "Contabilidad" }]] : original(sql, params));
    await expect(editar()).rejects.toThrow("La persona que requiere debe ser un usuario de Operaciones.");
    expect(m.conn.execute).not.toHaveBeenCalled();
  });
});
const editar = (datos: Partial<RequerimientoDatos> = {}, eliminar = true) => guardarRequerimiento(1, 8, "editor", editarRequerimientoSchema.parse({ ...payload, version: 2, lineas: [{ ...linea, id: 21 }, { ...linea, total: "0.10" }], ...datos }), eliminar, 12);

describe("contrato estricto", () => {
  it.each(["empresa_id", "estado", "total", "creado_por", "version", "solicitante_usuario_id", "entidad_requirente_nombre", "codigo"])("rechaza %s del cliente", key => expect(crearRequerimientoSchema.safeParse({ ...payload, [key]: 2 }).success).toBe(false));
  it("no acepta snapshots, ID en creación, IDs duplicados ni cero líneas", () => {
    expect(crearRequerimientoSchema.safeParse({ ...payload, lineas: [{ ...linea, proveedor_nombre_snapshot: "falso" }] }).success).toBe(false);
    expect(crearRequerimientoSchema.safeParse({ ...payload, lineas: [{ ...linea, id: 21 }] }).success).toBe(false);
    expect(crearRequerimientoSchema.safeParse({ ...payload, lineas: [] }).success).toBe(false);
    expect(editarRequerimientoSchema.safeParse({ ...payload, version: 2, lineas: [{ ...linea, id: 21 }, { ...linea, id: 21 }] }).success).toBe(false);
  });
  it.each([0, -1, NaN, Infinity, "0.001", "99999999999", "1e3", "-0.50"])("rechaza monto %s", total => expect(crearRequerimientoSchema.safeParse({ ...payload, lineas: [{ ...linea, total }] }).success).toBe(false));
  it("valida fecha real, IDs y total acumulado", () => {
    expect(crearRequerimientoSchema.safeParse({ ...payload, fecha_requerimiento: "2026-02-30" }).success).toBe(false);
    expect(crearRequerimientoSchema.safeParse({ ...payload, requirente_usuario_id: 1.5 }).success).toBe(false);
    expect(crearRequerimientoSchema.safeParse({ ...payload, lineas: [{ ...linea, total: "9999999999.99" }, linea] }).success).toBe(false);
  });
});
describe("lectura tenant-safe", () => {
  it("listado y filtros parametrizados usan tenant, incluyendo proveedor", async () => {
    await listarRequerimientos(1, filtrosCompraSchema.parse({ codigo: "%", proveedor_id: "3" }));
    const [sql, params] = m.query.mock.calls[0]; expect(sql).toContain("WHERE empresa_id = ?"); expect(sql).toContain("p.empresa_id = r.empresa_id"); expect(params[0]).toBe(1); expect(params.slice(-2)).toEqual([3, 3]);
  });
  it("ID de tenant B no devuelve cabecera ni consulta líneas", async () => {
    expect(await obtenerRequerimiento(1, 99)).toBeNull(); expect(m.query).toHaveBeenCalledOnce(); expect(m.query.mock.calls[0][1]).toEqual([1, 99]);
  });
  it("detalle ordenado conserva IDs y filtra tenant/parent", async () => {
    m.query.mockResolvedValueOnce([cabecera]).mockResolvedValueOnce(existentes);
    expect((await obtenerRequerimiento(1, 12))?.lineas.map(l => l.id)).toEqual([21, 22]); expect(m.query.mock.calls[1][1]).toEqual([1, 12]);
  });
  it("catálogos propios/activos, usuarios globales con acceso, sin vehículos compartidos", async () => {
    await catalogosCompra(1); expect(m.query).toHaveBeenCalledTimes(4);
    for (const [, params] of m.query.mock.calls) expect(params).toEqual([1]);
    expect(m.query.mock.calls[0][0]).toContain("activo = 1"); expect(m.query.mock.calls[1][0]).toContain("WHERE empresa_id = ? AND activo = 1"); expect(m.query.mock.calls[3][0]).toContain("u.acceso_todas_empresas = 1");
  });
});
describe("mutaciones transaccionales", () => {
  it("creación genera código seguro, solicitante sesión, Pendiente, snapshots servidor y suma exacta", async () => {
    const datos = crearRequerimientoSchema.parse({ ...payload, lineas: [linea, { ...linea, total: "0.10", vehiculo_id: 5 }] });
    expect(await guardarRequerimiento(1, 8, "registrador", datos, false)).toEqual({ id: 12, codigo: "RC-2026-000012", version: 1 });
    const [sql, params] = m.conn.execute.mock.calls[0]; expect(sql).toContain("'Pendiente'"); expect(params[0]).toBe(1); expect(params[1]).toMatch(/^TMP-[\da-f-]{36}$/); expect(params[7]).toBe(8); expect(params[9]).toBe("10.35"); expect(params[11]).toBe(8);
    const inserts = m.conn.execute.mock.calls.filter(([s]) => s.includes("INSERT INTO compras_requerimiento_lineas"));
    expect(inserts[0][1]).toContain("Proveedor real"); expect(inserts[0][1]).toContain("privada"); expect(inserts[1][1]).toContain("C-123ABC · Cabezal");
    expect(m.audit.mock.calls[0][0]).toBe(m.conn); expect(m.audit.mock.calls[0][1].detalle).not.toContain("privada"); expect(m.conn.commit).toHaveBeenCalledOnce();
  });
  it.each(["compras_proveedores", "flota_vehiculos", "cont_entidades", "usuarios"])("rechaza referencia fuera del tenant o inválida %s sin escrituras", async tabla => {
    const original = m.conn.query.getMockImplementation()!;
    m.conn.query.mockImplementation((sql: string, params: unknown[]) => sql.includes(`FROM ${tabla}`) ? Promise.resolve([[]]) : original(sql, params));
    await expect(guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse({ ...payload, lineas: [{ ...linea, vehiculo_id: 5 }] }), false)).rejects.toThrow();
    expect(m.conn.execute).not.toHaveBeenCalled(); expect(m.conn.rollback).toHaveBeenCalledOnce();
    const llamada = m.conn.query.mock.calls.find(([sql]) => sql.includes(`FROM ${tabla}`))!;
    expect(llamada[0]).toContain("empresa_id = ?"); expect(llamada[1]).toContain(1);
  });
  it("proveedor inactivo rechazado en nueva línea", async () => { proveedor.activo = 0; await expect(crear()).rejects.toThrow("activo"); expect(m.conn.execute).not.toHaveBeenCalled(); });
  it("proveedor inactivo existente conserva snapshot y permite edición", async () => {
    proveedor.activo = 0; await editar({ lineas: [{ ...linea, id: 21 }] } as Partial<RequerimientoDatos>);
    expect(m.conn.execute.mock.calls.find(([s]) => s.startsWith("UPDATE compras_requerimiento_lineas"))![1]).toContain("Histórico");
  });
  it("PATCH UPDATE estable + INSERT nuevo + DELETE individual, version+1, auditoría", async () => {
    expect(await editar()).toMatchObject({ id: 12, version: 3 });
    expect(m.conn.query.mock.calls[0][0]).toContain("FOR UPDATE");
    const calls = m.conn.execute.mock.calls;
    expect(calls[0][0]).toContain("version = version + 1"); expect(calls[0][1].slice(-3)).toEqual([1, 12, 2]);
    const updates = calls.filter(([s]) => s.startsWith("UPDATE compras_requerimiento_lineas")); expect(updates).toHaveLength(1); expect(updates[0][1].slice(-3)).toEqual([1, 12, 21]);
    expect(calls.filter(([s]) => s.includes("INSERT INTO compras_requerimiento_lineas"))).toHaveLength(1);
    expect(calls.filter(([s]) => s.startsWith("DELETE"))).toEqual([["DELETE FROM compras_requerimiento_lineas WHERE empresa_id = ? AND requerimiento_id = ? AND id = ?", [1, 12, 22]]]);
    const audit = JSON.parse(m.audit.mock.calls[0][1].detalle); expect(audit).toMatchObject({ totalAnterior: "20.50", totalNuevo: "10.35", agregadas: [12], editadas: [21], eliminadas: [22] });
  });
  it("no permite ID de línea ajeno", async () => { await expect(editar({ lineas: [{ ...linea, id: 99 }] } as Partial<RequerimientoDatos>)).rejects.toThrow("no pertenece"); expect(m.conn.execute).not.toHaveBeenCalled(); });
  it("eliminar exige permiso propio", async () => { await expect(editar({}, false)).rejects.toMatchObject({ status: 403 }); expect(m.conn.execute).not.toHaveBeenCalled(); });
  it("cualquier documento impide eliminar, incluso retirado (sin filtro estado)", async () => {
    documento = true; await expect(editar()).rejects.toThrow("documentos"); expect(m.conn.execute).not.toHaveBeenCalled();
    const [sql, params] = m.conn.query.mock.calls.find(([s]) => s.includes("FROM compras_linea_documentos"))!;
    expect(params).toEqual([1, 12, 22]); expect(sql).not.toMatch(/activo|retirado/);
  });
  it("version obsoleta 409 sin escrituras", async () => { await expect(editar({ version: 1 })).rejects.toMatchObject({ status: 409, message: CONFLICTO_COMPRA }); expect(m.conn.execute).not.toHaveBeenCalled(); });
  it("UPDATE condicionado también verifica affectedRows", async () => { m.conn.execute.mockResolvedValue([{ affectedRows: 0 }]); await expect(editar()).rejects.toThrow(CONFLICTO_COMPRA); expect(m.audit).not.toHaveBeenCalled(); expect(m.conn.rollback).toHaveBeenCalledOnce(); });
  it.each(["Autorizada", "Rechazada"])("%s solo lectura", async estado => { cabecera!.estado = estado; await expect(editar()).rejects.toThrow("Pendiente"); expect(m.conn.execute).not.toHaveBeenCalled(); });
  it("PATCH ajeno retorna 404", async () => { cabecera = null; await expect(editar()).rejects.toMatchObject({ status: 404 }); expect(m.conn.execute).not.toHaveBeenCalled(); });
  it.each([false, true])("fallo auditoría revierte crear/editar %s", async edicion => { m.audit.mockRejectedValue(new Error("fallo auditoría")); await expect(edicion ? editar() : crear()).rejects.toThrow("fallo auditoría"); expect(m.conn.rollback).toHaveBeenCalledOnce(); expect(m.conn.commit).not.toHaveBeenCalled(); expect(m.conn.release).toHaveBeenCalledOnce(); });
  it("creación valida encargado del tenant y guarda snapshot servidor separado de solicitante", async () => {
    const original = m.conn.query.getMockImplementation()!;
    m.conn.query.mockImplementation((sql: string, params: unknown[]) => sql.includes("FROM usuarios") && params[1] === 10 ? Promise.resolve([[{ nombre: "Encargado real" }]]) : original(sql, params));
    await guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse({ ...payload, encargado_compras_usuario_id: 10 }), false);
    expect(m.conn.execute.mock.calls[0][1].slice(-2)).toEqual([10, "Encargado real"]);
    expect(m.conn.query.mock.calls.find(([, params]) => params?.[1] === 10)?.[1]).toEqual([1, 10]);
    expect(crearRequerimientoSchema.safeParse({ ...payload, encargado_compras_nombre: "Falso" }).success).toBe(false);
  });
  it.each([false, true])("encargado ajeno rechazado sin escrituras al crear/editar %s", async edicion => {
    const original = m.conn.query.getMockImplementation()!;
    m.conn.query.mockImplementation((sql: string, params: unknown[]) => sql.includes("FROM usuarios") && params[1] === 99 ? Promise.resolve([[]]) : original(sql, params));
    await expect(edicion ? editar({ encargado_compras_usuario_id: 99 }) : guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse({ ...payload, encargado_compras_usuario_id: 99 }), false)).rejects.toThrow("encargado de compras");
    expect(m.conn.execute).not.toHaveBeenCalled(); expect(m.conn.rollback).toHaveBeenCalledOnce();
  });
  it("PATCH omitido conserva encargado/snapshot, seleccionarlo cambia y null desasigna", async () => {
    cabecera!.encargado_compras_usuario_id = 10; cabecera!.encargado_compras_nombre = "Snapshot anterior";
    await editar(); expect(m.conn.execute.mock.calls[0][1].slice(-5, -3)).toEqual([10, "Snapshot anterior"]);
    m.conn.execute.mockClear(); await editar({ encargado_compras_usuario_id: 11 }); expect(m.conn.execute.mock.calls[0][1].slice(-5, -3)).toEqual([11, "Usuario real"]);
    m.conn.execute.mockClear(); await editar({ encargado_compras_usuario_id: null }); expect(m.conn.execute.mock.calls[0][1].slice(-5, -3)).toEqual([null, null]);
  });
  it("servidor normaliza método nuevo pero respeta override manual y banco viene del proveedor", async () => {
    await guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse({ ...payload, lineas: [{ ...linea, metodo_pago: "TARJETA DE CREDITO" }, { ...linea, metodo_pago: "Cheque" }] }), false);
    const inserts = m.conn.execute.mock.calls.filter(([s]) => s.includes("INSERT INTO compras_requerimiento_lineas"));
    expect(inserts[0][1]).toContain("Tarjeta de crédito"); expect(inserts[1][1]).toContain("Cheque"); expect(inserts[0][1]).toContain("Banco real");
  });
  it("servidor conserva método histórico intacto en PATCH sin cambio de proveedor/método", async () => {
    existentes[0].metodo_pago = "Tarjeta";
    await editar({ lineas: [{ ...linea, id: 21, metodo_pago: "Tarjeta" }] } as Partial<RequerimientoDatos>);
    const [, params] = m.conn.execute.mock.calls.find(([s]) => s.startsWith("UPDATE compras_requerimiento_lineas"))!;
    expect(params).toContain("Tarjeta"); expect(params).not.toContain("Tarjeta de crédito");
  });
});
