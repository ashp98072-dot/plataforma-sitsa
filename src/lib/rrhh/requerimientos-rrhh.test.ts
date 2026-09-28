import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn(), conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() } }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ getConnection: async () => m.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
import {
  autorizarRequerimientoRrhh, catalogosRequerimientoRrhh, CONFLICTO_RRHH_REQ, ErrorRequerimientoRrhh, guardarRequerimientoRrhh,
  listarRequerimientosRrhh, MENSAJE_AUTOAUTORIZACION_RRHH, MSG_TRANSFERENCIA_SIN_CUENTA, rechazarRequerimientoRrhh,
} from "./requerimientos";
import { crearRequerimientoRrhhSchema, editarRequerimientoRrhhSchema } from "./requerimiento-schema";

const lineaBase = { proveedor_id: 3, descripcion: "Uniformes", cantidad: "2", precio_unitario: "150", metodo_pago: "Transferencia", condicion_pago: "Contado" };
const payloadBase = { fecha_requerimiento: "2026-09-28", entidad_requirente_id: 4, requirente_usuario_id: 9, lineas: [lineaBase] };
let proveedor: Record<string, unknown> | null;
let cabecera: Record<string, unknown> | null;
let existentes: Record<string, unknown>[];

beforeEach(() => {
  vi.resetAllMocks();
  cabecera = { id: 12, codigo: "RH-2026-000012", estado: "Pendiente", version: 2, total: "300.00" };
  proveedor = { id: 3, activo: 1, nombre_comercial: "Clínica X", razon_social: "Clínica X SA", nit: "123", banco: "Banco Industrial", numero_cuenta: "111222", tipo_cuenta: "Monetaria", dias_credito: 30 };
  existentes = [];
  m.conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM rrhh_requerimientos")) return [cabecera ? [cabecera] : []];
    if (sql.includes("FROM rrhh_requerimiento_lineas")) return [existentes];
    if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Entidad real" }]];
    if (sql.includes("FROM usuarios")) return [[{ nombre: "Usuario real", rol_global: "RRHH" }]];
    if (sql.includes("FROM rrhh_proveedores")) return [proveedor ? [proveedor] : []];
    throw new Error(`SQL inesperado: ${sql}`);
  });
  m.conn.execute.mockResolvedValue([{ insertId: 12, affectedRows: 1 }]);
  m.query.mockResolvedValue([]);
});
const crear = (overrides: Partial<typeof payloadBase> = {}) => guardarRequerimientoRrhh(1, 8, "registrador", crearRequerimientoRrhhSchema.parse({ ...payloadBase, ...overrides }));
const editar = (overrides: Record<string, unknown> = {}) => guardarRequerimientoRrhh(1, 8, "registrador", editarRequerimientoRrhhSchema.parse({ ...payloadBase, version: 2, ...overrides }), 12);

describe("7) crear requerimiento con una línea", () => {
  it("inserta cabecera + línea, genera código RH-<año>-<id> y audita", async () => {
    const r = await crear();
    expect(r).toEqual({ id: 12, codigo: "RH-2026-000012", version: 1 });
    expect(m.conn.execute.mock.calls[0][0]).toContain("INSERT INTO rrhh_requerimientos");
    expect(m.conn.execute.mock.calls.some((c: unknown[]) => String(c[0]).includes("UPDATE rrhh_requerimientos SET codigo"))).toBe(true);
    expect(m.conn.execute.mock.calls.some((c: unknown[]) => String(c[0]).includes("INSERT INTO rrhh_requerimiento_lineas"))).toBe(true);
    expect(m.audit).toHaveBeenCalledWith(m.conn, expect.objectContaining({ accion: "crear_requerimiento_rrhh", modulo: "rrhh_requerimientos" }));
    expect(m.conn.commit).toHaveBeenCalledOnce();
  });
});

describe("8) varias líneas y 9) varios proveedores", () => {
  it("suma cantidad × precio_unitario por línea y sostiene distintos proveedores", async () => {
    const proveedor2 = { id: 5, activo: 1, nombre_comercial: "Lab Y", banco: "Banco G&T", numero_cuenta: "999", tipo_cuenta: "Monetaria", dias_credito: null };
    m.conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM rrhh_requerimientos")) return [[]];
      if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Entidad real" }]];
      if (sql.includes("FROM usuarios")) return [[{ nombre: "Usuario real" }]];
      if (sql.includes("FROM rrhh_proveedores")) return [(params as number[])[1] === 5 ? [proveedor2] : [proveedor]];
      throw new Error(sql);
    });
    await crear({ lineas: [lineaBase, { ...lineaBase, proveedor_id: 5, descripcion: "Exámenes médicos", cantidad: "1", precio_unitario: "80" }] } as never);
    const inserts = m.conn.execute.mock.calls.filter((c: unknown[]) => String(c[0]).includes("INSERT INTO rrhh_requerimiento_lineas"));
    expect(inserts).toHaveLength(2);
    const insertCab = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO rrhh_requerimientos"))!;
    expect(insertCab[1][insertCab[1].length - 3]).toBe("380.00"); // total = 2*150 + 1*80
  });
});

describe("10) código RH persistido y 11) concurrencia no duplica códigos", () => {
  it("usa placeholder TMP- único antes del AUTO_INCREMENT (nunca MAX(id)+1)", async () => {
    await crear();
    const insertCab = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO rrhh_requerimientos"))!;
    expect(String(insertCab[1][1])).toMatch(/^TMP-[0-9a-f-]{36}$/);
  });
  it("el código final se escribe en un UPDATE separado, con el id ya asignado por AUTO_INCREMENT", async () => {
    await crear();
    const upd = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("UPDATE rrhh_requerimientos SET codigo"))!;
    expect(upd[1]).toEqual(["RH-2026-000012", 1, 12]);
  });
});

describe("12) total recalculado por el backend", () => {
  it("cantidad y precio_unitario del cliente nunca incluyen un total manipulable (el schema no lo acepta)", () => {
    expect(crearRequerimientoRrhhSchema.safeParse({ ...payloadBase, lineas: [{ ...lineaBase, total: "0.01" }] }).success).toBe(false);
  });
});

describe("13) empresa requirente del tenant / 26) tenant isolation", () => {
  it("entidad inexistente o de otra empresa rechaza antes de escribir", async () => {
    m.conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM cont_entidades")) return [[]];
      return [[]];
    });
    await expect(crear()).rejects.toThrow("La empresa requirente no es válida");
    expect(m.conn.commit).not.toHaveBeenCalled();
  });
});

describe("14) proveedor del tenant", () => {
  it("proveedor inexistente en esta empresa rechaza", async () => {
    proveedor = null;
    await expect(crear()).rejects.toThrow("El proveedor no pertenece a esta empresa.");
  });
});

describe("15) usuario/requirente del tenant", () => {
  it("requirente sin acceso a la empresa rechaza", async () => {
    m.conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Entidad real" }]];
      if (sql.includes("FROM usuarios")) return [[]];
      if (sql.includes("FROM rrhh_proveedores")) return [[proveedor]];
      if (sql.includes("FROM rrhh_requerimientos")) return [[]];
      throw new Error(sql);
    });
    await expect(crear()).rejects.toThrow("La persona que requiere no tiene acceso a esta empresa.");
  });
});

describe("16-17) snapshot del proveedor y cambiar proveedor después no cambia histórico", () => {
  it("guarda snapshot del proveedor en la línea al crear", async () => {
    await crear();
    const insertLinea = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO rrhh_requerimiento_lineas"))!;
    expect(insertLinea[1]).toContain("Clínica X");
    expect(insertLinea[1]).toContain("Banco Industrial");
    expect(insertLinea[1]).toContain("111222");
  });

  // AJUSTE PR #372 (punto 1) — la línea existente (id: 21) SIEMPRE conserva su snapshot mientras conserve el mismo
  // proveedor_id, sin importar si el proveedor sigue ACTIVO y sin importar qué otro dato del proveedor haya cambiado.
  const lineaVieja = { id: 21, proveedor_id: 3, proveedor_nombre_snapshot: "Clínica X", proveedor_razon_social_snapshot: "Clínica X SA",
    proveedor_nit_snapshot: "123", banco_snapshot: "Banco Industrial", numero_cuenta_snapshot: "111222", tipo_cuenta_snapshot: "Monetaria",
    dias_credito_snapshot: 30, descripcion: "Uniformes", cantidad: "2", precio_unitario: "150", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "300.00" };

  it("1) proveedor ACTIVO cambia banco/cuenta/nombre/NIT/razón social/días de crédito después de crear el requerimiento", async () => {
    existentes = [lineaVieja];
    proveedor = { ...proveedor, activo: 1, nombre_comercial: "Clínica X (renombrada)", razon_social: "Otra SA", nit: "999",
      banco: "Banco G&T", numero_cuenta: "987654", tipo_cuenta: "Ahorro", dias_credito: 60 };
    await editar({ lineas: [{ id: 21, proveedor_id: 3, descripcion: "Uniformes actualizados", cantidad: "2", precio_unitario: "150", metodo_pago: "Transferencia", condicion_pago: "Contado" }] });
    const upd = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("UPDATE rrhh_requerimiento_lineas"))!;
    // 2-3) editar descripción con el mismo proveedor: el snapshot VIEJO permanece (nunca "Banco G&T"/"987654"/999/60/"Otra SA").
    expect(upd[1]).toContain("Uniformes actualizados");
    expect(upd[1]).toContain("Clínica X");
    expect(upd[1]).toContain("Clínica X SA");
    expect(upd[1]).toContain("123");
    expect(upd[1]).toContain("Banco Industrial");
    expect(upd[1]).toContain("111222");
    expect(upd[1]).toContain("Monetaria");
    expect(upd[1]).toContain(30);
    expect(upd[1]).not.toContain("Banco G&T");
    expect(upd[1]).not.toContain("987654");
    expect(upd[1]).not.toContain("Otra SA");
    expect(upd[1]).not.toContain(60);
  });
  it("4-5) editar cantidad con el mismo proveedor: el snapshot viejo permanece", async () => {
    existentes = [lineaVieja];
    proveedor = { ...proveedor, activo: 1, banco: "Banco G&T", numero_cuenta: "987654" };
    await editar({ lineas: [{ id: 21, proveedor_id: 3, descripcion: "Uniformes", cantidad: "5", precio_unitario: "150", metodo_pago: "Transferencia", condicion_pago: "Contado" }] });
    const upd = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("UPDATE rrhh_requerimiento_lineas"))!;
    expect(upd[1]).toContain("Banco Industrial");
    expect(upd[1]).toContain("111222");
    expect(upd[1]).not.toContain("Banco G&T");
  });
  it("proveedor INACTIVO tampoco cambia el snapshot de la línea que ya lo tenía (caso ya cubierto, se conserva)", async () => {
    existentes = [lineaVieja];
    proveedor = { ...proveedor, activo: 0 };
    await editar({ lineas: [{ id: 21, proveedor_id: 3, descripcion: "Uniformes", cantidad: "2", precio_unitario: "150", metodo_pago: "Transferencia", condicion_pago: "Contado" }] });
    const upd = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("UPDATE rrhh_requerimiento_lineas"))!;
    expect(upd[1]).toContain("Banco Industrial");
    expect(upd[1]).toContain("111222");
  });
  it("6-7) cambiar REALMENTE proveedor_id: entonces sí toma el snapshot del proveedor NUEVO", async () => {
    const proveedorNuevo = { id: 5, activo: 1, nombre_comercial: "Lab Y", razon_social: "Lab Y SA", nit: "555", banco: "Banco G&T", numero_cuenta: "987654", tipo_cuenta: "Ahorro", dias_credito: 15 };
    existentes = [lineaVieja];
    m.conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM rrhh_requerimientos")) return [[cabecera]];
      if (sql.includes("FROM rrhh_requerimiento_lineas")) return [existentes];
      if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Entidad real" }]];
      if (sql.includes("FROM usuarios")) return [[{ nombre: "Usuario real" }]];
      if (sql.includes("FROM rrhh_proveedores")) return [(params as number[])[1] === 5 ? [proveedorNuevo] : [proveedor]];
      throw new Error(sql);
    });
    await editar({ lineas: [{ id: 21, proveedor_id: 5, descripcion: "Uniformes", cantidad: "2", precio_unitario: "150", metodo_pago: "Transferencia", condicion_pago: "Contado" }] });
    const upd = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("UPDATE rrhh_requerimiento_lineas"))!;
    expect(upd[1]).toContain("Lab Y");
    expect(upd[1]).toContain("Banco G&T");
    expect(upd[1]).toContain("987654");
    expect(upd[1]).not.toContain("Clínica X");
    expect(upd[1]).not.toContain("Banco Industrial");
  });
});

describe("18) Transferencia conserva banco/cuenta y 19) Transferencia sin cuenta -> error", () => {
  it("línea Transferencia con proveedor sin banco/cuenta es rechazada por el backend", async () => {
    proveedor = { ...proveedor, banco: null, numero_cuenta: null };
    await expect(crear()).rejects.toThrow(MSG_TRANSFERENCIA_SIN_CUENTA);
  });
  it("Efectivo/Cheque/Crédito no exigen cuenta bancaria", async () => {
    proveedor = { ...proveedor, banco: null, numero_cuenta: null };
    await expect(crear({ lineas: [{ ...lineaBase, metodo_pago: "Efectivo" }] } as never)).resolves.toMatchObject({ id: 12 });
  });
});

describe("20) Crédito conserva días", () => {
  it("guarda dias_credito_snapshot del proveedor", async () => {
    await crear({ lineas: [{ ...lineaBase, condicion_pago: "Crédito" }] } as never);
    const insertLinea = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO rrhh_requerimiento_lineas"))!;
    expect(insertLinea[1]).toContain(30);
  });
});

describe("21) edición Pendiente / 22) no editar Autorizada", () => {
  it("edita un Pendiente", async () => {
    existentes = [];
    await expect(editar()).resolves.toMatchObject({ id: 12, version: 3 });
  });
  it("rechaza editar un requerimiento Autorizada", async () => {
    cabecera = { ...cabecera, estado: "Autorizada" };
    await expect(editar()).rejects.toThrow("Solo se puede editar un requerimiento Pendiente.");
  });
});

describe("25) conflicto de version -> 409", () => {
  it("version distinta lanza ErrorRequerimientoRrhh 409", async () => {
    try {
      await editar({ version: 1 });
      throw new Error("no debió llegar aquí");
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorRequerimientoRrhh);
      expect((e as ErrorRequerimientoRrhh).status).toBe(409);
      expect((e as ErrorRequerimientoRrhh).message).toBe(CONFLICTO_RRHH_REQ);
    }
  });
});

describe("23) autorizar", () => {
  it("cambia a Autorizada y audita", async () => {
    cabecera = { codigo: "RH-2026-000012", total: "300.00", estado: "Pendiente", version: 2, requirente_usuario_id: 9, solicitante_usuario_id: 20, creado_por: 20 };
    m.conn.query.mockImplementation(async (sql: string) => (sql.includes("FROM rrhh_requerimientos") ? [[cabecera]] : [[]]));
    m.query.mockImplementation(async (sql: string) => (sql.includes("FROM rrhh_requerimientos") ? [{ ...cabecera, id: 12, fecha_requerimiento: "2026-09-28" }] : []));
    const detalle = await autorizarRequerimientoRrhh(1, 12, 2, { usuario: "jefe", autorizanteUsuarioId: 99, autorizanteNombre: "Jefe RRHH" });
    expect(m.conn.execute.mock.calls[0][0]).toContain("estado = 'Autorizada'");
    expect(m.audit).toHaveBeenCalledWith(m.conn, expect.objectContaining({ accion: "autorizar_requerimiento_rrhh" }));
    expect(detalle).not.toBeNull();
  });
  it("bloquea autoautorización (requirente/solicitante/creador)", async () => {
    cabecera = { codigo: "RH-2026-000012", total: "300.00", estado: "Pendiente", version: 2, requirente_usuario_id: 9, solicitante_usuario_id: 20, creado_por: 20 };
    m.conn.query.mockImplementation(async (sql: string) => (sql.includes("FROM rrhh_requerimientos") ? [[cabecera]] : [[]]));
    await expect(autorizarRequerimientoRrhh(1, 12, 2, { usuario: "x", autorizanteUsuarioId: 9, autorizanteNombre: "X" })).rejects.toThrow(MENSAJE_AUTOAUTORIZACION_RRHH);
  });
});

describe("24) rechazar con motivo", () => {
  it("exige motivo y cambia a Rechazada", async () => {
    cabecera = { codigo: "RH-2026-000012", total: "300.00", estado: "Pendiente", version: 2, requirente_usuario_id: 9, solicitante_usuario_id: 20, creado_por: 20 };
    m.conn.query.mockImplementation(async (sql: string) => (sql.includes("FROM rrhh_requerimientos") ? [[cabecera]] : [[]]));
    await expect(rechazarRequerimientoRrhh(1, 12, 2, { usuario: "x", usuarioId: 1, motivo: "  " })).rejects.toThrow("El rechazo requiere un motivo.");
    await rechazarRequerimientoRrhh(1, 12, 2, { usuario: "x", usuarioId: 1, motivo: "No autorizado por presupuesto" });
    expect(m.conn.execute.mock.calls[0][0]).toContain("estado = 'Rechazada'");
    expect(m.audit).toHaveBeenCalledWith(m.conn, expect.objectContaining({ accion: "rechazar_requerimiento_rrhh" }));
  });
});

describe("catálogos: sin N+1 (una consulta por catálogo)", () => {
  it("catalogosRequerimientoRrhh hace 3 consultas en paralelo (proveedores/entidades/usuarios)", async () => {
    await catalogosRequerimientoRrhh(1);
    expect(m.query).toHaveBeenCalledTimes(3);
  });
});

describe("listado: tenant y filtros", () => {
  it("siempre filtra por empresa_id", async () => {
    await listarRequerimientosRrhh(1, { codigo: "", desde: undefined, hasta: undefined });
    expect(m.query.mock.calls[0][1][0]).toBe(1);
  });
  it("filtra por proveedor_id y entidad_requirente_id", async () => {
    await listarRequerimientosRrhh(1, { codigo: "", proveedor_id: 3, entidad_requirente_id: 4 } as never);
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain("p.proveedor_id = ?");
    expect(sql).toContain("entidad_requirente_id = ?");
    expect(params).toContain(3);
    expect(params).toContain(4);
  });
});

// AJUSTE PR #372 (punto 3) — precisión de cantidad/precio_unitario alineada a 2 decimales en todo el flujo: schema,
// centavosRrhhReq() y la columna DECIMAL(12,2) de rrhh_requerimiento_lineas. El total final siempre son centavos exactos.
describe("precisión cantidad/precio (máximo 2 decimales)", () => {
  it.each([
    ["1", "150", "150.00"],
    ["2.5", "100", "250.00"],
    ["1.25", "80", "100.00"],
  ])("cantidad %s × precio %s = total %s", async (cantidad, precio_unitario, totalEsperado) => {
    await crear({ lineas: [{ ...lineaBase, cantidad, precio_unitario }] } as never);
    const insertLinea = m.conn.execute.mock.calls.find((c: unknown[]) => String(c[0]).includes("INSERT INTO rrhh_requerimiento_lineas"))!;
    expect(insertLinea[1]).toContain(totalEsperado);
  });
  it.each(["1.234", "1.2345"])("rechaza cantidad con más de 2 decimales: %s", cantidad => {
    expect(crearRequerimientoRrhhSchema.safeParse({ ...payloadBase, lineas: [{ ...lineaBase, cantidad }] }).success).toBe(false);
  });
  it("rechaza precio con más de 2 decimales (10.999)", () => {
    expect(crearRequerimientoRrhhSchema.safeParse({ ...payloadBase, lineas: [{ ...lineaBase, precio_unitario: "10.999" }] }).success).toBe(false);
  });
});
