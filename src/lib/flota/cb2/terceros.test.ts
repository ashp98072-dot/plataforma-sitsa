import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), insert: vi.fn(), diario: vi.fn(), guardar: vi.fn(), release: vi.fn(), auditar: vi.fn(), autorizar: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => m }) }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_PROHIBIDO"); } }));
vi.mock("@/lib/auth-secret", () => ({ getAuthSecretBytes: () => new TextEncoder().encode("synthetic-only-cb2-terceros-tests-no-production") }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
vi.mock("./storage", () => ({ guardar: m.guardar, compensar: vi.fn() }));
vi.mock("./repository", async original => ({ ...await original<typeof import("./repository")>(),
  tx: async (ctx: { autorizar: () => Promise<void> }, fn: (c: unknown, p: unknown) => unknown) => { await ctx.autorizar(); return fn(m, { nombre_comercial: "Proveedor sintético" }); },
  anterior: async () => null, insert: m.insert, diario: m.diario,
}));
import { registrarTerceros, revisarTerceros, reconocerTercero, validarTercero, listarTerceros } from "./terceros";
import { tercerosHttp } from "./terceros-http";
import { seleccion } from "./model";
import { preview, confirmarArchivo } from "./service";
import { libro, row } from "./fixture";
import type { AsociacionExterna } from "./terceros-model";
import { asignacionesExactas, seleccionSegura } from "@/components/flota/cb2/preview-model";
import type { CatalogosCB2 } from "@/components/flota/cb2/client";
import type { PoolConnection } from "mysql2/promise";

const ctx = { empresaId: 1, proveedorId: 3, actor: { id: 9, username: "capturista-demo" }, autorizar: m.autorizar };
const alta = { proveedorId: 3, pilotoReferencia: "contrato-demo-piloto-001", nombre: "Piloto Ejemplo", unidadReferencia: "contrato-demo-unidad-001", placa: "060 KHK", tipo: "MOTOCICLETA", descripcion: "Moto de reparto sintética", relacion: "CONTRATISTA", evidencia: "expediente-sintetico" };
const asociacion = (): AsociacionExterna => ({ id: 31, piloto_id: 11, unidad_id: 21, nombre: alta.nombre, placa: alta.placa, tipo: alta.tipo, descripcion: alta.descripcion, relacion: alta.relacion, estado: "VERIFICADA", revision: 1, piloto_referencia: alta.pilotoReferencia, unidad_referencia: alta.unidadReferencia });
let catalogo: AsociacionExterna[];
let registro: Record<string, unknown> | undefined;
let piloto: Record<string, unknown> | undefined, unidad: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "1"); catalogo = []; registro = piloto = unidad = undefined;
  m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 9, username: "capturista-demo", rol: "Admin" } });
  m.guardar.mockResolvedValue("solo-memoria");
  m.diario.mockImplementation(async (_c, _ctx, _tipo, _clave, _digest, eventos) => eventos);
  m.insert.mockImplementation(async (_c, table: string, values: Record<string, unknown>) => {
    if (table === "flota_cb2_externos_pilotos") { piloto = { id: 11, ...values }; return 11; }
    if (table === "flota_cb2_externos_unidades") { unidad = { id: 21, ...values }; return 21; }
    if (table === "flota_cb2_externos_asociaciones") { registro = { id: 31, ...values }; return 31; }
    return 100;
  });
  m.query.mockImplementation(async (sql: string, p: unknown[]) => {
    if (sql.includes("FROM compras_proveedores")) return [[{ id: 3 }]];
    if (sql.includes("FROM empresas")) return [[{ id: 1, activa: 1 }]];
    if (sql.includes("FROM usuarios")) return [[{ id: p[0], activo: 1, rol_global: "Admin" }]];
    if (sql.includes("FROM flota_cb2_externos_asociaciones a JOIN")) return [p[0] === 1 ? catalogo : []];
    if (sql.includes("FROM flota_cb2_externos_pilotos")) return [piloto ? [piloto] : []];
    if (sql.includes("FROM flota_cb2_externos_unidades")) return [unidad ? [unidad] : []];
    if (sql.includes("FROM flota_cb2_externos_asociaciones")) return [p[0] === 1 && registro ? [registro] : []];
    if (/FROM flota_combustible_cargas|FROM flota_cb2_consumos|FROM flota_cb2_filas|FROM flota_cb2_importaciones|FROM flota_combustible_conciliacion_filas/.test(sql)) return [[]];
    throw Error(`Consulta mock inesperada: ${sql}`);
  });
  m.execute.mockImplementation(async (sql, p) => {
    if (sql.startsWith("UPDATE flota_cb2_externos_asociaciones") && registro) { registro.estado = p[0]; registro.revision = Number(registro.revision) + 1; registro.verificado_por = p[1]; catalogo = [{ ...asociacion(), estado: String(p[0]), revision: Number(registro.revision) }]; }
    return [{ affectedRows: 1 }];
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("terceros: reconocimiento estricto, sin empleados ficticios", () => {
  it("asociación verificada permite variaciones normalizadas de nombre y placa", () => {
    expect(reconocerTercero(" PILOTO   EJEMPLO ", "060-KHK", [asociacion()])).toMatchObject({ estado: "UNICA_VERIFICADA", asociacion: { id: 31 } });
  });
  it.each(["PENDIENTE", "REVOCADA"])("%s nunca se completa automáticamente", estado => {
    expect(reconocerTercero(alta.nombre, alta.placa, [{ ...asociacion(), estado }]).asociacion).toBeNull();
  });
  it("homónimos con IDs diferentes quedan pendientes aunque solo una unidad coincida", () => {
    expect(reconocerTercero(alta.nombre, alta.placa, [asociacion(), { ...asociacion(), id: 32, piloto_id: 12, unidad_id: 22, placa: "OTRA" }]).asociacion).toBeNull();
  });
  it("misma placa con unidades diferentes no se usa como identidad física", () => {
    expect(reconocerTercero(alta.nombre, alta.placa, [asociacion(), { ...asociacion(), id: 32, unidad_id: 22 }]).asociacion).toBeNull();
  });
  it("cambio de vehículo no reconocido queda pendiente; nueva asociación verificada permite reconocerlo", () => {
    expect(reconocerTercero(alta.nombre, "061 KHK", [asociacion()]).asociacion).toBeNull();
    expect(reconocerTercero(alta.nombre, "061 KHK", [asociacion(), { ...asociacion(), id: 32, unidad_id: 22, placa: "061 KHK" }]).asociacion?.id).toBe(32);
  });
  it.each([["", alta.placa], [alta.nombre, ""], ["Otro nombre", alta.placa]])("datos insuficientes o contradictorios %j/%j quedan pendientes", (nombre, placa) => {
    expect(reconocerTercero(nombre, placa, [asociacion()]).asociacion).toBeNull();
  });
});

describe("persistencia y confirmación: servicios reales con adaptadores mock; no motor real", () => {
  it("D2 apagada deniega altas y selección aun con solicitud manipulada; no lee tablas nuevas", async () => {
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "");
    await expect(registrarTerceros(ctx, alta)).rejects.toMatchObject({ status: 403 });
    await expect(validarTercero(m as unknown as PoolConnection, ctx, 31, 21, alta.nombre, alta.placa)).rejects.toMatchObject({ status: 403 });
    expect(await listarTerceros(1)).toEqual([]); expect(m.query).not.toHaveBeenCalled(); expect(m.insert).not.toHaveBeenCalled();
  });
  it("primera alta pendiente, revisión independiente y segunda importación reconocida sin recrear identidades", async () => {
    await registrarTerceros(ctx, alta);
    expect(registro).toMatchObject({ estado: "PENDIENTE", piloto_id: 11, unidad_id: 21 });
    await expect(revisarTerceros(ctx, 31, 0, "VERIFICADA")).rejects.toMatchObject({ status: 403 });
    await revisarTerceros({ ...ctx, actor: { id: 10, username: "revisor-demo" } }, 31, 0, "VERIFICADA");
    const cantidad = m.insert.mock.calls.length;
    for (const vale of ["SINTETICO-001", "SINTETICO-002"]) {
      const r = row(vale); r[2] = alta.placa; r[8] = alta.nombre;
      const buffer = await libro([r]);
      const inicial = await preview(ctx, buffer, { perfil: "HALEL", moneda: "GTQ", seleccion: [] });
      const fila = inicial.filas.find(f => f.candidato)!;
      expect(fila.asociacionExterna?.id).toBe(31);
      const cat: CatalogosCB2 = { tercerosHabilitados: true, terceros: catalogo, proveedores: [], vehiculos: [{ id: -21, placa: alta.placa }] };
      expect(asignacionesExactas(inicial.filas, cat)[fila.candidato!]).toBe("-21");
      expect(asignacionesExactas(inicial.filas, { ...cat, vehiculos: [...cat.vehiculos, { id: 99, placa: alta.placa }] })).toEqual({});
      expect(seleccionSegura(inicial.filas, cat, { [fila.candidato!]: "-21" })[fila.candidato!]).toBe("-21");
      const entrada = { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: [{ candidato: fila.candidato!, vehiculoId: -21, asociacionExternaId: 31 }] };
      const recibo = await preview(ctx, buffer, entrada);
      await confirmarArchivo(ctx, buffer, "sintetico.xlsx", entrada, `sintetico-${vale}`, recibo.token);
    }
    const creados = m.insert.mock.calls.filter(([, t]) => t === "flota_cb2_consumos");
    expect(creados).toHaveLength(2);
    expect(creados[0][2]).toMatchObject({ vehiculo_id: null, empleado_id: null, asociacion_externa_id: 31, placa_original: alta.placa, piloto_informado: alta.nombre });
    expect(JSON.parse(creados[0][2].identidad_externa)).toMatchObject({ piloto_id: 11, unidad_id: 21, relacion: "CONTRATISTA", tipo: "MOTOCICLETA" });
    expect(m.insert.mock.calls.slice(cantidad).some(([, t]) => /externos|empleados|flota_vehiculos/.test(t))).toBe(false);
  });
  it("reintentar alta reutiliza referencias estables y no duplica asociación", async () => {
    await registrarTerceros(ctx, alta); const n = m.insert.mock.calls.length;
    expect(await registrarTerceros(ctx, alta)).toMatchObject({ id: 31, existente: true });
    expect(m.insert).toHaveBeenCalledTimes(n);
    expect(m.query).toHaveBeenCalledWith("SELECT id FROM empresas WHERE id=? FOR UPDATE", [1]);
  });
  it("referencia estable con nombre o placa contradictorios no sobrescribe el catálogo", async () => {
    await registrarTerceros(ctx, alta);
    await expect(registrarTerceros(ctx, { ...alta, nombre: "Otra identidad" })).rejects.toThrow("contradictorios");
    await expect(registrarTerceros(ctx, { ...alta, placa: "061 KHK" })).rejects.toThrow("contradictorios");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("revisión obsoleta y asociación de otra empresa no permiten verificar ni seleccionar", async () => {
    await registrarTerceros(ctx, alta);
    await expect(revisarTerceros(ctx, 31, 9, "VERIFICADA")).rejects.toThrow("obsoleta");
    await expect(revisarTerceros({ ...ctx, empresaId: 2 }, 31, 0, "VERIFICADA")).rejects.toMatchObject({ status: 404 });
    catalogo = [asociacion()];
    await expect(validarTercero(m as unknown as PoolConnection, { ...ctx, empresaId: 2 }, 31, 21, alta.nombre, alta.placa)).rejects.toThrow("incompatible");
  });
  it("revocar después del preview impide confirmar aunque se conserve el ID", async () => {
    catalogo = [asociacion()];
    const r = row(); r[2] = alta.placa; r[8] = alta.nombre; const buffer = await libro([r]);
    const a = await preview(ctx, buffer, { perfil: "HALEL", moneda: "GTQ", seleccion: [] });
    const entrada = { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: [{ candidato: a.filas.find(f => f.candidato)!.candidato!, vehiculoId: -21, asociacionExternaId: 31 }] };
    const p = await preview(ctx, buffer, entrada); catalogo[0].estado = "REVOCADA";
    await expect(confirmarArchivo(ctx, buffer, "sintetico.xlsx", entrada, "sintetico-revocado", p.token)).rejects.toThrow("revocado");
    expect(m.insert.mock.calls.some(([, t]) => t === "flota_cb2_consumos")).toBe(false);
  });
  it("identidad mixta externo/empleado o propia/asociación se rechaza en el contrato", () => {
    const candidato = "a".repeat(64);
    expect(seleccion.safeParse([{ candidato, vehiculoId: -21 }]).success).toBe(false);
    expect(seleccion.safeParse([{ candidato, vehiculoId: 21, asociacionExternaId: 31 }]).success).toBe(false);
    expect(seleccion.safeParse([{ candidato, vehiculoId: -21, asociacionExternaId: 31, empleadoId: 7 }]).success).toBe(false);
  });
  it("mismo ID con otra sesion o username no puede autoverificar; auditoria conserva identidades", async () => {
    await registrarTerceros(ctx, alta);
    await expect(revisarTerceros({ ...ctx, actor: { id: ctx.actor.id, username: "sesion-nueva" } }, 31, 0, "VERIFICADA")).rejects.toMatchObject({ status: 403 });
    expect(m.execute).not.toHaveBeenCalled();
    await revisarTerceros({ ...ctx, actor: { id: 10, username: "otro-admin" } }, 31, 0, "VERIFICADA");
    const evento = JSON.parse(m.auditar.mock.calls.at(-1)![1].detalle);
    expect(evento).toMatchObject({ creadoPor: 9, actorId: 10, verificadoPor: 10, estadoAnterior: "PENDIENTE", estado: "VERIFICADA", revisionAnterior: 0, revision: 1 });
    await revisarTerceros(ctx, 31, 1, "REVOCADA");
    expect(JSON.parse(m.auditar.mock.calls.at(-1)![1].detalle)).toMatchObject({ creadoPor: 9, actorId: 9, verificadoPor: 10, estadoAnterior: "VERIFICADA", estado: "REVOCADA" });
  });
  it.each([{ activo: 0, rol_global: "Admin" }, { activo: 1, rol_global: "Operaciones" }])("rol/estado vigente %j impide llamadas directas aunque la sesion fuera Admin", async actual => {
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation((sql, args) => sql.includes("FROM usuarios") ? Promise.resolve([[{ id: ctx.actor.id, ...actual }]]) : original(sql, args));
    await expect(registrarTerceros(ctx, alta)).rejects.toMatchObject({ status: 403 });
    expect(m.insert).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
  });
  it("revocar configuracion o permiso mientras espera empresa bloquea la gestion", async () => {
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (sql, args) => {
      const r = await original(sql, args);
      if (sql === "SELECT id FROM empresas WHERE id=? FOR UPDATE") vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "");
      return r;
    });
    await expect(registrarTerceros(ctx, alta)).rejects.toMatchObject({ status: 403 }); expect(m.insert).not.toHaveBeenCalled();
  });
  it("API real con SQL mock: cuenta creadora no verifica tras cambiar sesion; otro Admin verifica", async () => {
    const request = (method: string, body: object) => new Request("http://localhost/api/terceros", { method, headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await tercerosHttp(request("POST", alta), "demo")).status).toBe(201);
    const op = { proveedorId: 3, id: 31, revision: 0, estado: "VERIFICADA" };
    m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 9, username: "sesion-renovada", rol: "Admin" } });
    expect((await tercerosHttp(request("PATCH", op), "demo")).status).toBe(403);
    expect(m.execute).not.toHaveBeenCalled();
    expect((await tercerosHttp(request("PATCH", { ...op, creado_por: 10 }), "demo")).status).toBe(400);
    m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 10, username: "otro-admin", rol: "Admin" } });
    expect((await tercerosHttp(request("PATCH", op), "demo")).status).toBe(200);
    expect(registro).toMatchObject({ creado_por: 9, verificado_por: 10, estado: "VERIFICADA" });
  });
});
