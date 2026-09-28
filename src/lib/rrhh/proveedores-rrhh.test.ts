import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(), conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }, audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: mocks.query, getPool: () => ({ getConnection: async () => mocks.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: mocks.audit }));
import { guardarProveedorRrhh, listarProveedoresRrhh, obtenerProveedorRrhh } from "./proveedores";
import { crearProveedorRrhhSchema, editarProveedorRrhhSchema } from "./proveedor-schema";

beforeEach(() => { vi.resetAllMocks(); mocks.conn.execute.mockResolvedValue([{ insertId: 7, affectedRows: 1 }]); });

describe("RRHH proveedores — schema", () => {
  it("nombre comercial obligatorio", () => { expect(crearProveedorRrhhSchema.safeParse({ nombre_comercial: " " }).success).toBe(false); });
  it("trim y nulos", () => { expect(crearProveedorRrhhSchema.parse({ nombre_comercial: " A ", nit: " " })).toMatchObject({ nombre_comercial: "A", nit: null }); });
  it("no acepta empresa_id ni id (tenant/identidad del servidor)", () => {
    expect(crearProveedorRrhhSchema.safeParse({ nombre_comercial: "A", empresa_id: 2 }).success).toBe(false);
    expect(editarProveedorRrhhSchema.safeParse({ id: 5 }).success).toBe(false);
  });
});

describe("1) crear proveedor tenant A", () => {
  it("crea y audita sin cuenta bancaria en el detalle", async () => {
    expect(await guardarProveedorRrhh(1, 8, "admin", { nombre_comercial: "Clínica X", numero_cuenta: "privada" } as never)).toBe(7);
    expect(mocks.conn.execute.mock.calls[0][0]).toContain("INSERT INTO rrhh_proveedores");
    expect(mocks.conn.execute.mock.calls[0][1][0]).toBe(1);
    const audit = mocks.audit.mock.calls[0];
    expect(audit[1]).toMatchObject({ empresaId: 1, usuario: "admin", accion: "crear_proveedor_rrhh", modulo: "rrhh_proveedores" });
    expect(audit[1].detalle).not.toContain("privada");
    expect(mocks.conn.commit).toHaveBeenCalledOnce();
  });
});

describe("2) no acceder proveedor tenant B", () => {
  it("obtenerProveedorRrhh filtra por empresa_id en el WHERE", async () => {
    mocks.query.mockResolvedValue([]);
    expect(await obtenerProveedorRrhh(1, 99)).toBeNull();
    expect(mocks.query.mock.calls[0][0]).toContain("WHERE empresa_id = ? AND id = ?");
    expect(mocks.query.mock.calls[0][1]).toEqual([1, 99]);
  });
  it("guardarProveedorRrhh (editar) de otro tenant devuelve null sin escribir", async () => {
    mocks.conn.query.mockResolvedValue([[]]);
    expect(await guardarProveedorRrhh(1, 8, "admin", { nombre_comercial: "X" }, 99)).toBeNull();
    expect(mocks.conn.rollback).toHaveBeenCalledOnce();
  });
});

describe("3) editar proveedor", () => {
  it("solo actualiza los campos enviados", async () => {
    mocks.conn.query.mockResolvedValue([[{ id: 7, empresa_id: 1, nombre_comercial: "Vieja", activo: 1 }]]);
    await guardarProveedorRrhh(1, 8, "admin", { telefono: "555-1234" }, 7);
    expect(mocks.conn.execute.mock.calls[0][0]).toContain("SET telefono = ?");
    expect(mocks.conn.execute.mock.calls[0][0]).not.toContain("nombre_comercial");
  });
});

describe("4-5) desactivar proveedor / histórico sigue visible", () => {
  it("desactivar audita inactivar (nunca DELETE)", async () => {
    mocks.conn.query.mockResolvedValue([[{ id: 7, empresa_id: 1, nombre_comercial: "X", activo: 1 }]]);
    await guardarProveedorRrhh(1, 8, "admin", { activo: false }, 7);
    expect(mocks.audit.mock.calls[0][1].accion).toBe("inactivar_proveedor_rrhh");
    expect(mocks.conn.execute.mock.calls.some((c: unknown[]) => String(c[0]).includes("DELETE"))).toBe(false);
  });
  it("listarProveedoresRrhh no filtra por activo (histórico visible desde requerimientos)", async () => {
    mocks.query.mockResolvedValue([]);
    await listarProveedoresRrhh(1, "");
    expect(mocks.query.mock.calls[0][0]).not.toContain("activo = 1");
  });
});

describe("6) búsqueda nombre/NIT/contacto (AJUSTE PR #372 punto 4: sin tildes/mayúsculas, multi-token, filtrarPersonas)", () => {
  const fila = (over: Partial<Record<string, unknown>>) => ({
    id: over.id, empresa_id: 1, nombre_comercial: "", razon_social: null, nit: null, contacto_nombre: null,
    telefono: null, email: null, direccion: null, metodo_pago_habitual: null, banco: null, numero_cuenta: null,
    tipo_cuenta: null, dias_credito: null, observaciones: null, activo: 1, ...over,
  });
  beforeEach(() => {
    mocks.query.mockResolvedValue([
      fila({ id: 1, nombre_comercial: "Clínica Médica Central" }),
      fila({ id: 2, nombre_comercial: "Clínica del Norte" }),
      fila({ id: 3, nombre_comercial: "Papelería XYZ", nit: "123456" }),
      fila({ id: 4, nombre_comercial: "Álvarez Consultores", contacto_nombre: "Ana Muñoz" }),
    ]);
  });
  it("el universo se acota en SQL solo por empresa_id (sin LOCATE)", async () => {
    await listarProveedoresRrhh(1, "");
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toBe("SELECT id, empresa_id, nombre_comercial, razon_social, nit, contacto_nombre, telefono, email, direccion, metodo_pago_habitual, banco, numero_cuenta, tipo_cuenta, dias_credito, observaciones, activo FROM rrhh_proveedores WHERE empresa_id = ? ORDER BY nombre_comercial, id");
    expect(params).toEqual([1]);
  });
  it("multi-token: 'clinica central' encuentra 'Clínica Médica Central' pero no 'Clínica del Norte'", async () => {
    const r = await listarProveedoresRrhh(1, "clinica central");
    expect(r.map(p => p.id)).toEqual([1]);
  });
  it("sin tildes ni mayúsculas: 'alvarez' encuentra 'Álvarez Consultores'; 'MUNOZ' encuentra por contacto", async () => {
    expect((await listarProveedoresRrhh(1, "alvarez")).map(p => p.id)).toEqual([4]);
    expect((await listarProveedoresRrhh(1, "MUNOZ")).map(p => p.id)).toEqual([4]);
  });
  it("busca también por NIT", async () => {
    expect((await listarProveedoresRrhh(1, "123456")).map(p => p.id)).toEqual([3]);
  });
});
