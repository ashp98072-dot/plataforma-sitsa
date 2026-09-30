import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(), conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }, audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: mocks.query, getPool: () => ({ getConnection: async () => mocks.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: mocks.audit }));
import { ErrorProveedorDuplicado, esDuplicadoProveedorUnico, guardarProveedor, listarProveedores, obtenerProveedor } from "./proveedores";
import { crearProveedorSchema, editarProveedorSchema } from "./proveedor-schema";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.conn.execute.mockResolvedValue([{ insertId: 7, affectedRows: 1 }]);
  // Por defecto: ninguna fila encontrada (ni "antes" al editar, ni duplicado) — los tests que necesitan una fila
  // real la configuran ellos mismos, en orden, con mockResolvedValueOnce.
  mocks.conn.query.mockResolvedValue([[]]);
});
describe("validación", () => {
  it("nombre requerido", () => { expect(crearProveedorSchema.safeParse({ nombre_comercial: " " }).success).toBe(false); });
  it("trim, null y NIT opcional", () => { expect(crearProveedorSchema.parse({ nombre_comercial: " A ", correo: " ", nit: " " })).toEqual({ nombre_comercial: "A", correo: null, nit: null }); expect(crearProveedorSchema.parse({ nombre_comercial: "A" })).not.toHaveProperty("nit"); });
  it.each([-1, 1.5, "3"])("rechaza días crédito %s", value => { expect(crearProveedorSchema.safeParse({ nombre_comercial: "A", dias_credito: value }).success).toBe(false); });
  it("acepta cero y rechaza campos tenant/auditoría", () => { expect(crearProveedorSchema.safeParse({ nombre_comercial: "A", dias_credito: 0 }).success).toBe(true); expect(editarProveedorSchema.safeParse({ empresa_id: 2 }).success).toBe(false); });
});
describe("modelo tenant + auditoría transaccional", () => {
  it("crea tenant A y audita sin cuenta bancaria", async () => {
    expect(await guardarProveedor(1, 8, "admin", { nombre_comercial: "A", numero_cuenta: "privada" })).toBe(7);
    expect(mocks.conn.execute.mock.calls[0][0]).toContain("INSERT INTO compras_proveedores");
    expect(mocks.conn.execute.mock.calls[0][1][0]).toBe(1);
    const audit = mocks.audit.mock.calls[0]; expect(audit[0]).toBe(mocks.conn); expect(audit[1]).toMatchObject({ empresaId: 1, usuario: "admin", accion: "crear_proveedor_compras" });
    expect(audit[1].detalle).not.toContain("privada"); expect(mocks.conn.commit).toHaveBeenCalledOnce();
  });
  it("lista tenant A con búsqueda parametrizada", async () => {
    mocks.query.mockResolvedValue([{ id: 7, empresa_id: 1, nombre_comercial: "A", activo: 1 }]);
    expect(await listarProveedores(1, "a%" )).toHaveLength(1);
    expect(mocks.query.mock.calls[0][0]).toContain("WHERE empresa_id = ?"); expect(mocks.query.mock.calls[0][1]).toEqual([1, "a%", "a%", "a%", "a%"]);
  });
  it("id de tenant B no encontrado", async () => {
    mocks.query.mockResolvedValue([]); expect(await obtenerProveedor(1, 20)).toBeNull(); expect(mocks.query.mock.calls[0][1]).toEqual([1, 20]);
    mocks.conn.query.mockResolvedValue([[]]); expect(await guardarProveedor(1, 8, "admin", { activo: false }, 20)).toBeNull(); expect(mocks.conn.execute).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.conn.query.mock.calls[0][1]).toEqual([1, 20]);
  });
  it.each([
    [true, { nombre_comercial: "Editado" }, "editar_proveedor_compras"],
    [true, { activo: false }, "inactivar_proveedor_compras"],
    [false, { activo: true }, "reactivar_proveedor_compras"],
  ] as const)("actualiza/audita %s %s", async (activo, datos, accion) => {
    mocks.conn.query
      .mockResolvedValueOnce([[{ id: 7, empresa_id: 1, nombre_comercial: "A", activo: activo ? 1 : 0, numero_cuenta: "privada" }]]) // SELECT ... FOR UPDATE (antes)
      .mockResolvedValueOnce([[]]); // anti-duplicados: sin coincidencia
    await guardarProveedor(1, 8, "admin", datos, 7);
    const [sql, params] = mocks.conn.execute.mock.calls[0]; expect(sql).toContain("WHERE empresa_id = ? AND id = ?"); expect(sql).not.toMatch(/DELETE/i); expect(params.slice(-2)).toEqual([1, 7]);
    expect(mocks.audit.mock.calls[0][1].accion).toBe(accion); expect(mocks.audit.mock.calls[0][1].detalle).not.toContain("privada"); expect(mocks.conn.query.mock.calls[0][0]).toContain("FOR UPDATE");
  });
  it("fallo de auditoría revierte sin commit", async () => { mocks.audit.mockRejectedValue(new Error("fallo")); await expect(guardarProveedor(1, 8, "admin", { nombre_comercial: "A" })).rejects.toThrow("fallo"); expect(mocks.conn.rollback).toHaveBeenCalledOnce(); expect(mocks.conn.commit).not.toHaveBeenCalled(); expect(mocks.conn.release).toHaveBeenCalledOnce(); });
});

describe("ANTI-DUPLICADOS (secciones 6-11 del ticket) — guardarProveedor", () => {
  it("7/8) crea normalmente cuando no hay coincidencia (tenant correcto en el INSERT)", async () => {
    const id = await guardarProveedor(3, 8, "admin", { nombre_comercial: "Repuestos López" });
    expect(id).toBe(7);
    const [sql, params] = mocks.conn.execute.mock.calls[0];
    expect(sql).toContain("nombre_normalizado");
    expect(sql).toContain("nit_normalizado");
    expect(params[0]).toBe(3); // empresa_id
  });

  it("escribe nombre_normalizado/nit_normalizado calculados por el backend (nunca los que mande el cliente)", async () => {
    await guardarProveedor(1, 8, "admin", { nombre_comercial: "  Repuestos   López  ", nit: " 1234-56789-0101 " });
    const [, params] = mocks.conn.execute.mock.calls[0];
    expect(params).toContain("REPUESTOS LOPEZ");
    expect(params).toContain("1234567890101");
  });

  it("9) mismo nombre normalizado ya ACTIVO -> ErrorProveedorDuplicado PROVEEDOR_DUPLICADO, no inserta", async () => {
    mocks.conn.query.mockResolvedValueOnce([[{ id: 99, nombre_comercial: "Repuestos López", nit: null, activo: 1 }]]);
    const err = await guardarProveedor(1, 8, "admin", { nombre_comercial: "REPUESTOS LOPEZ" }).catch(e => e);
    expect(err).toBeInstanceOf(ErrorProveedorDuplicado);
    expect(err.codigo).toBe("PROVEEDOR_DUPLICADO");
    expect(err.proveedorExistente).toMatchObject({ id: 99, activo: true });
    expect(mocks.conn.execute).not.toHaveBeenCalled();
    expect(mocks.conn.rollback).toHaveBeenCalledOnce();
  });

  it("10) mismo NIT normalizado ya ACTIVO -> PROVEEDOR_DUPLICADO", async () => {
    mocks.conn.query.mockResolvedValueOnce([[{ id: 55, nombre_comercial: "Otro Nombre", nit: "1234567890101", activo: 1 }]]);
    const err = await guardarProveedor(1, 8, "admin", { nombre_comercial: "Nombre nuevo", nit: "1234-56789-0101" }).catch(e => e);
    expect(err).toBeInstanceOf(ErrorProveedorDuplicado);
    expect(err.codigo).toBe("PROVEEDOR_DUPLICADO");
    expect(err.proveedorExistente.id).toBe(55);
  });

  it("11) mismo nombre normalizado pero INACTIVO -> PROVEEDOR_DUPLICADO_INACTIVO", async () => {
    mocks.conn.query.mockResolvedValueOnce([[{ id: 99, nombre_comercial: "Repuestos López", nit: null, activo: 0 }]]);
    const err = await guardarProveedor(1, 8, "admin", { nombre_comercial: "REPUESTOS LOPEZ" }).catch(e => e);
    expect(err).toBeInstanceOf(ErrorProveedorDuplicado);
    expect(err.codigo).toBe("PROVEEDOR_DUPLICADO_INACTIVO");
  });

  it("12) mismo NIT normalizado pero INACTIVO -> PROVEEDOR_DUPLICADO_INACTIVO", async () => {
    mocks.conn.query.mockResolvedValueOnce([[{ id: 55, nombre_comercial: "Otro", nit: "1234567890101", activo: 0 }]]);
    const err = await guardarProveedor(1, 8, "admin", { nombre_comercial: "Nombre nuevo", nit: "1234567890101" }).catch(e => e);
    expect(err.codigo).toBe("PROVEEDOR_DUPLICADO_INACTIVO");
  });

  it("13) mismo nombre en OTRA empresa está permitido (el chequeo siempre filtra por empresa_id)", async () => {
    // El mock no distingue empresa_id realmente, pero verificamos que el SQL SIEMPRE filtra por empresa_id = ?
    // (el guard de tenant real es quien garantiza el aislamiento; aquí confirmamos que el parámetro se envía).
    await guardarProveedor(2, 8, "admin", { nombre_comercial: "Nombre" });
    const dupCall = mocks.conn.query.mock.calls[0];
    expect(String(dupCall[0])).toContain("WHERE empresa_id = ?");
    expect(dupCall[1][0]).toBe(2);
  });

  it("15) editar entrevistador/nombre no se duplica contra sí mismo: la consulta anti-duplicados excluye el propio id", async () => {
    mocks.conn.query
      .mockResolvedValueOnce([[{ id: 7, empresa_id: 1, nombre_comercial: "Repuestos López", nit: null, activo: 1 }]]) // FOR UPDATE
      .mockResolvedValueOnce([[]]); // sin duplicado (se excluyó a sí mismo)
    const id = await guardarProveedor(1, 8, "admin", { nombre_comercial: "Repuestos López SA" }, 7);
    expect(id).toBe(7);
    const [dupSql, dupParams] = mocks.conn.query.mock.calls[1];
    expect(String(dupSql)).toContain("AND id <> ?");
    expect(dupParams).toContain(7);
  });

  it("16/17) editar SOLO teléfono (sin tocar nombre/nit) no reescribe nombre_normalizado/nit_normalizado", async () => {
    mocks.conn.query
      .mockResolvedValueOnce([[{ id: 7, empresa_id: 1, nombre_comercial: "A", nit: null, activo: 1 }]])
      .mockResolvedValueOnce([[]]);
    await guardarProveedor(1, 8, "admin", { telefono: "5555-0000" }, 7);
    const [sql] = mocks.conn.execute.mock.calls[0];
    expect(sql).not.toContain("nombre_normalizado = ?");
    expect(sql).not.toContain("nit_normalizado = ?");
  });

  it("editar SÍ reescribe nombre_normalizado/nit_normalizado cuando el patch toca nombre_comercial o nit", async () => {
    mocks.conn.query
      .mockResolvedValueOnce([[{ id: 7, empresa_id: 1, nombre_comercial: "A", nit: null, activo: 1 }]])
      .mockResolvedValueOnce([[]]);
    await guardarProveedor(1, 8, "admin", { nombre_comercial: "B" }, 7);
    const [sql] = mocks.conn.execute.mock.calls[0];
    expect(sql).toContain("nombre_normalizado = ?");
    expect(sql).toContain("nit_normalizado = ?");
  });

  it("14) NIT vacío/null nunca participa en la unicidad: no bloquea aunque otro proveedor también tenga NIT vacío", async () => {
    await guardarProveedor(1, 8, "admin", { nombre_comercial: "Sin NIT uno" });
    const [dupSql, dupParams] = mocks.conn.query.mock.calls[0];
    expect(String(dupSql)).toContain("? IS NOT NULL"); // la condición de NIT solo aplica si nitNormalizado no es null
    expect(dupParams).toContain(null);
  });
});

describe("ANTI-DUPLICADOS — red de seguridad ER_DUP_ENTRY (sección 12, carrera)", () => {
  it("15) ER_DUP_ENTRY del índice de nombre -> 409 estructurado, nunca 500 (reconsulta para dar detalle)", async () => {
    mocks.conn.execute.mockRejectedValueOnce(Object.assign(new Error("Duplicate entry 'REPUESTOS LOPEZ' for key 'uq_cb_proveedor_nombre'"), { code: "ER_DUP_ENTRY", errno: 1062 }));
    mocks.query.mockResolvedValueOnce([{ id: 99, nombre_comercial: "Repuestos López", nit: null, activo: 1 }]);
    const err = await guardarProveedor(1, 8, "admin", { nombre_comercial: "Repuestos López" }).catch(e => e);
    expect(err).toBeInstanceOf(ErrorProveedorDuplicado);
    expect(err.proveedorExistente.id).toBe(99);
  });

  it("un ER_DUP_ENTRY de OTRO índice (no de proveedores) se propaga tal cual, no se confunde con duplicado de proveedor", async () => {
    const otro = Object.assign(new Error("Duplicate entry for key 'otro_indice_cualquiera'"), { code: "ER_DUP_ENTRY", errno: 1062 });
    mocks.conn.execute.mockRejectedValueOnce(otro);
    await expect(guardarProveedor(1, 8, "admin", { nombre_comercial: "X" })).rejects.toBe(otro);
  });

  it("esDuplicadoProveedorUnico distingue por nombre del índice, no solo por código de error", () => {
    expect(esDuplicadoProveedorUnico({ code: "ER_DUP_ENTRY", message: "... uq_cb_proveedor_nombre ..." })).toBe(true);
    expect(esDuplicadoProveedorUnico({ code: "ER_DUP_ENTRY", message: "... uq_cb_proveedor_nit ..." })).toBe(true);
    expect(esDuplicadoProveedorUnico({ code: "ER_DUP_ENTRY", message: "... otro_indice ..." })).toBe(false);
    expect(esDuplicadoProveedorUnico({ code: "ER_OTHER_ERROR", message: "uq_cb_proveedor_nombre" })).toBe(false);
    expect(esDuplicadoProveedorUnico(null)).toBe(false);
    expect(esDuplicadoProveedorUnico(new Error("no relacionado"))).toBe(false);
  });
});
