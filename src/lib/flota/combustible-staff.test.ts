import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), subir: vi.fn(), borrar: vi.fn(), vehiculo: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }), query: m.query }));
vi.mock("./acceso", () => ({ obtenerVehiculoAccesibleTx: m.vehiculo, predicadoVehiculoAccesible: () => "v.empresa_id = ? OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso a WHERE a.empresa_id=?)" }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.subir, borrarUpload: m.borrar, contentTypeFor: () => "application/pdf", validarRutaArchivoEmpresa: () => true }));
import { catalogosCombustible, guardarCombustibleStaff } from "./combustible-staff";
import { combustibleStaffSchema, precioCalculado } from "./combustible-staff-schema";
import { listarCargasCombustibleRevision } from "./combustible";
// El formulario ya NO envía proveedor: el servidor lo deriva de la estación.
const input = { estacionId: 55, vehiculoId: 7, viajeId: null, numeroVale: "A-1", fechaConsumo: "2026-10-15", tipoCombustible: "diesel" as const, galones: "10.125", monto: "300.50", km: null, gasolinera: "Estación", observaciones: "Control operativo" };
const actor = { usuarioId: 91, username: "op" };
const file = { name: "vale.pdf", size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
let estado = "PENDIENTE";
let duplicado = false;
let proveedorActivo = 1;
/** Vale existente: la lectura previa sin bloqueo y la lectura bloqueada comparten la misma fila. */
let vale: Record<string, unknown>;
/** Estación (lectura previa y lectura bloqueada). `null` = no existe en la empresa. */
let estacion: Record<string, unknown> | null;
beforeEach(() => {
  vi.resetAllMocks(); estado = "PENDIENTE"; duplicado = false; proveedorActivo = 1;
  vale = { id: 11, vehiculo_id: 7, proveedor_id: 3, estacion_id: 55, gasolinera: "Shell Roosevelt", ruta_relativa: "empresas/1/flota/viejo.pdf" };
  estacion = { id: 55, proveedor_id: 3, nombre: "Shell Roosevelt", activo: 1 };
  m.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM compras_proveedores")) return [[{ id: params[1], activo: proveedorActivo }]];
    if (sql.includes("SELECT proveedor_id, estacion_id FROM flota_combustible_cargas")) return [[{ proveedor_id: vale.proveedor_id, estacion_id: vale.estacion_id }]];
    if (sql.includes("SELECT proveedor_id FROM flota_combustible_estaciones")) return [estacion ? [{ proveedor_id: estacion.proveedor_id }] : []];
    if (sql.includes("LOCK IN SHARE MODE")) return [estacion && Number(estacion.proveedor_id) === params[1] ? [{ id: estacion.id, nombre: estacion.nombre, activo: estacion.activo }] : []];
    if (sql.includes("SELECT id, estado")) return [[{ ...vale, estado }]];
    if (sql.includes("FROM flota_viajes")) return [[{ id: 9, vehiculo_id: 7 }]];
    if (sql.includes("UPPER(TRIM")) return [duplicado ? [{ id: 5 }] : []];
    return [];
  });
  m.vehiculo.mockResolvedValue({ id: 7, activo: 1 });
  m.execute.mockResolvedValue([{ insertId: 11 }]);
  m.subir.mockResolvedValue({ relative: "empresas/1/flota/nuevo.pdf", original: "vale.pdf", size: 10 });
});
describe("captura staff C-1", () => {
  it("alta sin captura de viaje resuelve NULL, nunca undefined/0", async () => {
    expect(combustibleStaffSchema.parse({ ...input, viajeId: undefined }).viajeId).toBeUndefined();
    await guardarCombustibleStaff(1, actor, { ...input, viajeId: undefined }, file);
    expect(m.execute.mock.calls[0][1][1]).toBeNull();
    expect(m.query.mock.calls.some(c => c[0].includes("FROM flota_viajes"))).toBe(false);
  });
  it("editar omitiendo viaje preserva vínculo histórico del registro bloqueado", async () => {
    vale = { ...vale, viaje_id: 9, gasolinera: "Histórica" };
    await guardarCombustibleStaff(1, actor, { ...input, viajeId: undefined }, null, 11);
    expect(m.execute.mock.calls[0][1][1]).toBe(9);
    expect(m.execute.mock.calls[0][1][10]).toBe("Histórica");
    expect(m.subir).not.toHaveBeenCalled();
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("FROM flota_viajes WHERE empresa_id = ? AND id = ?"), [1, 9]);
  });
  it("cambiar unidad no borra silenciosamente el viaje histórico incompatible", async () => {
    vale = { ...vale, viaje_id: 9 };
    await expect(guardarCombustibleStaff(1, actor, { ...input, viajeId: undefined, vehiculoId: 8 }, null, 11)).rejects.toThrow("Viaje no válido");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("texto libre no es proveedor_id ni estacion_id válido", () => {
    expect(combustibleStaffSchema.safeParse({ ...input, proveedorId: "Shell manual" }).success).toBe(false);
    expect(combustibleStaffSchema.safeParse({ ...input, estacionId: "Shell manual" }).success).toBe(false);
  });
  it("registra sin piloto ni viaje, PENDIENTE y precio Decimal", async () => {
    expect(await guardarCombustibleStaff(1, actor, input, file)).toBe(11);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("NULL, NULL"); expect(sql).toContain("'PENDIENTE'");
    expect(params[1]).toBeNull(); expect(params[8]).toBe("29.68");
    expect(m.commit).toHaveBeenCalledOnce(); expect(m.auditar).toHaveBeenCalledOnce();
    expect(sql).toContain("creado_por_usuario_id");
    expect(params.slice(-3, -1)).toEqual(["op", 91]);
    expect(m.auditar.mock.calls[0][1]).toMatchObject({ usuario: "op", detalle: expect.stringContaining("usuario #91") });
  });
  it("acepta viaje opcional de la misma empresa/unidad", async () => {
    await guardarCombustibleStaff(1, actor, { ...input, viajeId: 9 }, file);
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("WHERE empresa_id = ? AND id = ?"), [1, 9]);
  });
  it.each(["proveedor", "vehiculo", "viaje"])("rechaza %s ajeno", async recurso => {
    if (recurso === "vehiculo") m.vehiculo.mockResolvedValue(null);
    else { const original = m.query.getMockImplementation()!; m.query.mockImplementation((sql, params) => sql.includes(recurso === "proveedor" ? "FROM compras_proveedores" : "FROM flota_viajes") ? Promise.resolve([[]]) : original(sql, params)); }
    await expect(guardarCombustibleStaff(1, actor, { ...input, viajeId: recurso === "viaje" ? 9 : null }, file)).rejects.toThrow();
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled();
  });
  it("edita PENDIENTE conservando evidencia e identidad histórica", async () => {
    await guardarCombustibleStaff(1, actor, input, null, 11);
    expect(m.execute.mock.calls[0][0]).toContain("estado='PENDIENTE'");
    expect(m.execute.mock.calls[0][0]).not.toContain("empleado_id"); expect(m.subir).not.toHaveBeenCalled();
    expect(m.execute.mock.calls[0][0]).not.toContain("creado_por");
  });
  it.each(["APROBADO", "RECHAZADO"])("no edita %s", async value => {
    estado = value;
    await expect(guardarCombustibleStaff(1, actor, input, file, 11)).rejects.toMatchObject({ status: 409 });
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("nuevo exige evidencia", async () => {
    await expect(guardarCombustibleStaff(1, actor, input, null)).rejects.toThrow("evidencia");
  });
  it("duplicado preventivo dentro de empresa/proveedor (el derivado de la estación)", async () => {
    duplicado = true;
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toMatchObject({ status: 409 });
    expect(m.subir).not.toHaveBeenCalled(); expect(m.query).toHaveBeenCalledWith(expect.stringContaining("UPPER(TRIM"), [1, 3, "A-1", 0]);
  });
  it("compensa el archivo si falla BD", async () => {
    m.execute.mockRejectedValue(new Error("fallo"));
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("fallo");
    expect(m.rollback).toHaveBeenCalledOnce(); expect(m.borrar).toHaveBeenCalledWith("empresas/1/flota/nuevo.pdf");
  });
  it("si falla upload no escribe ni borra evidencia anterior", async () => {
    m.subir.mockRejectedValue(new Error("upload"));
    await expect(guardarCombustibleStaff(1, actor, input, file, 11)).rejects.toThrow("upload");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.borrar).not.toHaveBeenCalled();
  });
  it("catálogo mínimo sin datos bancarios ni credenciales; la estación trae proveedor y dirección para buscar", async () => {
    await catalogosCombustible(1);
    const sql = m.query.mock.calls.map(c => c[0]).join(" ");
    expect(sql).not.toMatch(/banco|cuenta|password|SELECT \*/i); expect(sql).toContain("flota_vehiculo_acceso");
    expect(sql).toContain("p.nombre_comercial AS proveedorNombre"); expect(sql).toContain("e.direccion");
  });
});
describe("proveedor derivado de la estación", () => {
  it("nuevo vale: el proveedor persistido es el de la estación (el formulario no lo envía)", async () => {
    estacion = { id: 55, proveedor_id: 8, nombre: "Puma Zona 9", activo: 1 };
    await guardarCombustibleStaff(1, actor, input, file);
    const [, params] = m.execute.mock.calls[0];
    expect(params[2]).toBe(8); // proveedor_id derivado
    expect(params[12]).toBe(55); // estacion_id
    expect(params[10]).toBe("Puma Zona 9"); // snapshot del servidor
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("FROM compras_proveedores"), [1, 8]);
    expect(m.auditar.mock.calls[0][1].detalle).toContain("proveedor #8");
  });
  it("NO se puede falsear proveedorId: estación del proveedor A con proveedor B se rechaza sin escribir ni subir", async () => {
    estacion = { id: 55, proveedor_id: 3, nombre: "Shell", activo: 1 };
    await expect(guardarCombustibleStaff(1, actor, { ...input, proveedorId: 4 }, file)).rejects.toThrow("no pertenece al proveedor indicado");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce();
  });
  it("un proveedorId coincidente es inocuo (compatibilidad), pero nunca manda", async () => {
    await guardarCombustibleStaff(1, actor, { ...input, proveedorId: 3 }, file);
    expect(m.execute.mock.calls[0][1][2]).toBe(3);
  });
  it("sin estación un vale NUEVO se rechaza con mensaje claro (estación catalogada obligatoria)", async () => {
    for (const estacionId of [null, undefined]) {
      await expect(guardarCombustibleStaff(1, actor, { ...input, estacionId }, file)).rejects.toThrow("Selecciona la estación de combustible");
    }
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled();
  });
  it("estación de OTRA empresa no existe para esta: se rechaza antes de bloquear proveedores o subir evidencia", async () => {
    estacion = null;
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("estación");
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("FROM flota_combustible_estaciones WHERE empresa_id = ? AND id = ?"), [1, 55]);
    expect(m.query.mock.calls.some(c => String(c[0]).includes("FROM compras_proveedores"))).toBe(false);
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled();
  });
  it("estación INACTIVA se rechaza en un vale nuevo", async () => {
    estacion = { ...estacion!, activo: 0 };
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("no está activa");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled();
  });
  it("proveedor inactivo de la estación se rechaza en un vale nuevo", async () => {
    proveedorActivo = 0;
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("Proveedor inactivo");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("estación cambió de proveedor entre la lectura y el bloqueo: conflicto, no se escribe", async () => {
    m.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM compras_proveedores")) return [[{ id: params[1], activo: 1 }]];
      if (sql.includes("SELECT proveedor_id FROM flota_combustible_estaciones")) return [[{ proveedor_id: 3 }]];
      if (sql.includes("LOCK IN SHARE MODE")) return [[]]; // ya no pertenece a ese proveedor
      return [];
    });
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("estación");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled();
  });
  it("cambiar de estación recalcula proveedor y snapshot", async () => {
    vale = { ...vale, proveedor_id: 3, estacion_id: 55, gasolinera: "Shell Roosevelt" };
    estacion = { id: 70, proveedor_id: 9, nombre: "Texaco Mixco", activo: 1 };
    await guardarCombustibleStaff(1, actor, { ...input, estacionId: 70 }, null, 11);
    const params = m.execute.mock.calls[0][1];
    expect(params[2]).toBe(9); expect(params[12]).toBe(70); expect(params[10]).toBe("Texaco Mixco");
  });
  it("editar omitiendo estacionId conserva estación, proveedor y snapshot del vale (no los decide el navegador)", async () => {
    await guardarCombustibleStaff(1, actor, { ...input, estacionId: undefined }, null, 11);
    const params = m.execute.mock.calls[0][1];
    expect(params[2]).toBe(3); expect(params[12]).toBe(55); expect(params[10]).toBe("Shell Roosevelt");
  });
  it("un vale con estación NO puede quedarse sin estación al editarlo", async () => {
    await expect(guardarCombustibleStaff(1, actor, { ...input, estacionId: null }, null, 11)).rejects.toThrow("Selecciona la estación");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("histórico SIN estación: se edita sin destruir `gasolinera` ni `proveedor_id` (y sin backfill)", async () => {
    vale = { ...vale, estacion_id: null, gasolinera: "Texto histórico" };
    await guardarCombustibleStaff(1, actor, { ...input, estacionId: null }, null, 11);
    const params = m.execute.mock.calls[0][1];
    expect(params[10]).toBe("Texto histórico"); expect(params[12]).toBeNull(); expect(params[2]).toBe(3);
    expect(m.query.mock.calls.some(c => String(c[0]).includes("FROM flota_combustible_estaciones"))).toBe(false);
  });
  it("histórico del portal sin proveedor ni estación: queda NULL y no se asigna un proveedor del navegador", async () => {
    vale = { ...vale, estacion_id: null, proveedor_id: null, gasolinera: null };
    await guardarCombustibleStaff(1, actor, { ...input, estacionId: null, proveedorId: 4 }, null, 11);
    expect(m.execute.mock.calls[0][1][2]).toBeNull();
    expect(m.query.mock.calls.some(c => String(c[0]).includes("UPPER(TRIM"))).toBe(false); // sin proveedor no hay contra qué comparar
  });
  it("histórico sin estación: un proveedorId distinto del guardado se rechaza", async () => {
    vale = { ...vale, estacion_id: null };
    await expect(guardarCombustibleStaff(1, actor, { ...input, estacionId: null, proveedorId: 4 }, null, 11)).rejects.toThrow("no se puede cambiar");
  });
  it("el vale cambió entre la lectura previa y el bloqueo: 409 sin escribir", async () => {
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation((sql, params) => sql.includes("SELECT id, estado") ? Promise.resolve([[{ ...vale, estacion_id: 99, estado }]]) : original(sql, params));
    await expect(guardarCombustibleStaff(1, actor, input, null, 11)).rejects.toMatchObject({ status: 409 });
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("vale inexistente: 404 desde la lectura previa", async () => {
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation((sql, params) => sql.includes("SELECT proveedor_id, estacion_id FROM flota_combustible_cargas") ? Promise.resolve([[]]) : original(sql, params));
    await expect(guardarCombustibleStaff(1, actor, input, null, 11)).rejects.toMatchObject({ status: 404 });
  });
});
describe("validación y mapeo", () => {
  it("estación usa nombre del servidor, no texto enviado, y filtra empresa/proveedor", async () => {
    await guardarCombustibleStaff(1, actor, { ...input, estacionId: 55, gasolinera: "Texto manipulado" }, file);
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("WHERE empresa_id=? AND proveedor_id=? AND id=?"), [1, 3, 55]);
    expect(m.execute.mock.calls[0][1][10]).toBe("Shell Roosevelt");
    expect(m.execute.mock.calls[0][1][12]).toBe(55);
  });
  it.each(["ajena", "otro proveedor", "inactiva"])("rechaza estación %s antes de subir evidencia", async caso => {
    if (caso === "ajena") estacion = null;
    if (caso === "otro proveedor") m.query.mockImplementation(async (sql: string, params: unknown[] = []) => sql.includes("LOCK IN SHARE MODE") ? [[]] : sql.includes("SELECT proveedor_id FROM flota_combustible_estaciones") ? [[{ proveedor_id: 3 }]] : sql.includes("FROM compras_proveedores") ? [[{ id: params[1], activo: 1 }]] : []);
    if (caso === "inactiva") estacion = { ...estacion!, activo: 0 };
    await expect(guardarCombustibleStaff(1, actor, input, file)).rejects.toThrow("estación");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.subir).not.toHaveBeenCalled();
  });
  it("edición mantiene estación inactiva y snapshot originales si no cambian", async () => {
    vale = { ...vale, gasolinera: "Nombre original" };
    estacion = { id: 55, proveedor_id: 3, nombre: "Nombre nuevo", activo: 0 };
    await guardarCombustibleStaff(1, actor, input, null, 11);
    expect(m.execute.mock.calls[0][1][10]).toBe("Nombre original");
    expect(m.execute.mock.calls[0][1][12]).toBe(55);
  });
  it("no acepta un registrador ficticio con ID 0", async () => {
    await expect(guardarCombustibleStaff(1, { usuarioId: 0, username: "op" }, input, file)).rejects.toThrow("Usuario registrador");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it.each(["vehiculoId", "numeroVale", "fechaConsumo", "monto", "galones"])("exige %s", campo => expect(combustibleStaffSchema.safeParse({ ...input, [campo]: "" }).success).toBe(false));
  it("proveedorId ya no es obligatorio (se deriva) y vacío equivale a no enviado", () => {
    expect(combustibleStaffSchema.safeParse({ ...input, proveedorId: "" }).success).toBe(true);
    expect(combustibleStaffSchema.parse({ ...input, proveedorId: "" }).proveedorId).toBeUndefined();
    expect(combustibleStaffSchema.parse(input).proveedorId).toBeUndefined();
  });
  it.each(["abc", "NaN", "0", "-1", "1.1234"])("rechaza galones %s", galones => expect(combustibleStaffSchema.safeParse({ ...input, galones }).success).toBe(false));
  it("calcula con Decimal", () => expect(precioCalculado("100", "3")).toBe("33.33"));
  it("histórico sin proveedor y sin viaje conserva NULL, no viaje 0", async () => {
    m.query.mockResolvedValueOnce([{ id: 1, viaje_id: null, proveedor_id: null, vehiculo_id: 7 }]).mockResolvedValueOnce([]);
    expect((await listarCargasCombustibleRevision(1)).items[0]).toMatchObject({ viajeId: null, proveedorId: null });
  });
  it("listado conserva actor staff y ambos IDs sin sustituirlos por piloto", async () => {
    m.query.mockResolvedValueOnce([{ id: 1, viaje_id: null, piloto_nombre: null, creado_por: "op", creado_por_usuario_id: 91, revisado_por: "revisor", revisado_por_usuario_id: 92 }]).mockResolvedValueOnce([]);
    expect((await listarCargasCombustibleRevision(1)).items[0]).toMatchObject({ viajeId: null, pilotoNombre: "—", creadoPor: "op", creadoPorUsuarioId: 91, revisadoPor: "revisor", revisadoPorUsuarioId: 92 });
  });
});
