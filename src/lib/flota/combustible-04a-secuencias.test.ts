import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Adaptador fail-closed: SQL se inspecciona como texto; nunca se carga mysql2 ni se abre conexión.
const m = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), get: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn(), subir: vi.fn(), borrar: vi.fn(), guardar: vi.fn(), compensar: vi.fn(), auditar: vi.fn(), autorizar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.get }), query: async (s: string, p: unknown[]) => (await m.query(s, p))[0] }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_REAL_PROHIBIDO"); } }));
vi.mock("@/lib/auth-secret", () => ({ getAuthSecretBytes: () => new TextEncoder().encode("04a-synthetic-in-memory-test-key-only-not-a-real-secret") }));
vi.mock("@/lib/uploads", () => ({ guardarUploadExcel: m.subir, borrarUpload: m.borrar, validarRutaArchivoEmpresa: () => true }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
vi.mock("./cb2/storage", () => ({ guardar: m.guardar, compensar: m.compensar, leer: () => { throw Error("LECTURA_REAL_PROHIBIDA"); } }));
import { confirmarArchivo, preview } from "./cb2/service";
import { analizar, ErrorCB2 } from "./cb2/model";
import { tx } from "./cb2/repository";
import { confirmarImportacion, previewImportacion } from "./combustible-importaciones";
import { libro, row } from "./cb2/fixture";

type Registro = Record<string, unknown>;
let tablas: Record<string, Registro[]>;
let snapshot: Record<string, Registro[]>;
let nextId: number;
let vehiculoActivo: boolean;
let empleadoActivo: boolean;
let proveedorActivo: boolean;
const ctx = { empresaId: 1, proveedorId: 3, actor: { id: 9, username: "demo-04a" }, autorizar: m.autorizar };
const archivo = { name: "sintetico.xlsx", size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
const internos = () => tablas.flota_combustible_cargas;
const consumos = () => tablas.flota_cb2_consumos;
const originales = () => tablas.flota_cb2_filas;
const ambito = (r: Registro, p: unknown[]) => r.empresa_id === p[0] && r.proveedor_id === p[1];

beforeEach(() => {
  vi.resetAllMocks(); nextId = 100; vehiculoActivo = empleadoActivo = proveedorActivo = true;
  tablas = Object.fromEntries(["flota_cb2_importaciones", "flota_cb2_consumos", "flota_cb2_filas", "flota_cb2_facturas", "flota_combustible_conciliaciones", "flota_combustible_conciliacion_filas", "flota_combustible_cargas"].map(t => [t, []]));
  // Vale interno ya existente: solo fixture en memoria, nunca se inserta por los servicios bajo prueba.
  internos().push({ id: 7, empresa_id: 1, proveedor_id: 3, numero_vale: "0001", vehiculo_id: 1, monto: "200", galones: "10", estado: "PENDIENTE" });
  m.get.mockResolvedValue(m);
  m.beginTransaction.mockImplementation(async () => { snapshot = structuredClone(tablas); });
  m.rollback.mockImplementation(async () => { if (snapshot) tablas = structuredClone(snapshot); });
  m.subir.mockResolvedValue({ relative: "empresas/1/flota/reporte-sintetico.xlsx", original: archivo.name, size: 1 });
  m.guardar.mockResolvedValue("empresas/1/flota/cb2/sintetico.xlsx");
  m.query.mockImplementation(async (sql: string, p: unknown[] = []) => {
    let rows: Registro[];
    if (sql.startsWith("SET ")) rows = [];
    else if (sql.startsWith("SELECT @@SESSION")) rows = [{ mode: "STRICT_ALL_TABLES", innodb: 1 }];
    else if (sql.startsWith("SELECT @@foreign")) rows = [{ fk: 1, ck: 1 }];
    else if (sql.includes("FROM compras_proveedores")) rows = [{ id: 3, nombre_comercial: "Proveedor sintético", activo: Number(proveedorActivo) }].filter(r => !sql.includes("activo=1") || r.activo === 1);
    else if (sql.includes("FROM flota_vehiculos")) rows = [{ id: 1, empresa_id: 1, placa: "C-001ABC", activo: Number(vehiculoActivo), estado: vehiculoActivo ? "Activo" : "Inactivo" }];
    else if (sql.includes("FROM empleados")) rows = empleadoActivo ? [{ id: 77 }] : [];
    else if (sql.includes("FROM flota_cb2_importaciones")) rows = tablas.flota_cb2_importaciones.filter(r => ambito(r, p) && r.archivo_sha256 === p[2]);
    else if (sql.includes("FROM flota_cb2_filas")) rows = originales().filter(r => ambito(r, p) && (sql.includes("operacion_clave=?") ? r.operacion_tipo === p[2] && r.operacion_clave === p[3] : r.importacion_id === p[2]));
    else if (sql.includes("FROM flota_cb2_consumos")) rows = consumos().filter(r => ambito(r, p) && (sql.includes("clave_candidata IN") ? p.slice(2).includes(r.clave_candidata) || p.slice(2).includes(r.vale_norm) : r.id === p[2]));
    else if (sql.includes("FROM flota_combustible_conciliaciones WHERE")) rows = tablas.flota_combustible_conciliaciones.filter(r => ambito(r, p) && r.archivo_sha256 === p[2]);
    else if (sql.includes("FROM flota_combustible_conciliacion_filas")) {
      rows = tablas.flota_combustible_conciliacion_filas.filter(r => tablas.flota_combustible_conciliaciones.some(h => h.id === r.conciliacion_id && ambito(h, p) && h.perfil_parser === "HALEL") && p.slice(2).includes(r.clave_operacion));
    } else throw Error(`SQL mock no previsto: ${sql}`);
    return [rows];
  });
  m.execute.mockImplementation(async (sql: string, p: unknown[]) => {
    const insert = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/);
    if (insert) {
      const [, table, columns, values] = insert;
      if (!tablas[table] || table === "flota_combustible_cargas") throw Error(`Escritor no permitido: ${table}`);
      let cursor = 0;
      const cells = values.split(",").map(v => v.trim() === "?" ? p[cursor++] : v.trim().replace(/^'|'$/g, ""));
      if (cursor !== p.length) throw Error("Parámetros mock incompatibles");
      const id = nextId++;
      tablas[table].push({ id, ...Object.fromEntries(columns.split(",").map((c, i) => [c.trim(), cells[i]])) });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE flota_cb2_importaciones SET")) return [{ affectedRows: 1 }];
    throw Error(`Escritura mock no prevista: ${sql}`);
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function preparar(buffer?: Buffer, empleado = false) {
  const b = buffer ?? await libro([row()]);
  const l = (await analizar(b, "HALEL", "GTQ")).find(l => l.clave)!;
  const entrada = { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: [{ candidato: l.clave!, vehiculoId: 1, ...(empleado ? { empleadoId: 77 } : {}) }] };
  const recibo = await preview(ctx, b, entrada);
  return { b, entrada, recibo };
}
async function confirmarCB2(p: Awaited<ReturnType<typeof preparar>>, clave = "clave-sintetica-04a") {
  return confirmarArchivo(ctx, p.b, archivo.name, p.entrada, clave, p.recibo.token);
}
async function importarC2B(b: Buffer) {
  const p = await previewImportacion(1, 3, ctx.actor, b);
  return confirmarImportacion(1, 3, ctx.actor, b, archivo, p.token);
}

describe("04A secuencias reales sobre adaptador SQL en memoria, no garantía DB", () => {
  it("CB2 → C2B guarda consumo y reporte coexistentes sin consultar CB2 desde C2B ni alterar vale interno", async () => {
    const antes = structuredClone(internos()), p = await preparar();
    await confirmarCB2(p); expect(consumos()).toHaveLength(1);
    const desde = m.query.mock.calls.length;
    await importarC2B(p.b);
    expect(tablas.flota_combustible_conciliaciones).toHaveLength(1); expect(consumos()).toHaveLength(1);
    expect(m.query.mock.calls.slice(desde).some(([s]) => /flota_cb2_/.test(s))).toBe(false);
    expect(internos()).toEqual(antes); // entidades separadas, nunca total combinado ni fusión
  });
  it("C2B → CB2 bloquea candidato y conserva evidencia original; no crea consumo", async () => {
    const p = await preparar(); await importarC2B(p.b);
    const reporte = structuredClone(tablas.flota_combustible_conciliacion_filas);
    await confirmarCB2(p);
    expect(consumos()).toHaveLength(0); expect(originales().some(r => r.resultado === "BLOQUEADA")).toBe(true);
    expect(tablas.flota_cb2_importaciones).toHaveLength(1); expect(m.compensar).not.toHaveBeenCalled();
    expect(tablas.flota_combustible_conciliacion_filas).toEqual(reporte);
  });
  it("CB2 mismo vale en archivo nuevo reutiliza consumo y deja el vale interno intacto", async () => {
    const p = await preparar(); await confirmarCB2(p);
    const antes = structuredClone(consumos()), vales = structuredClone(internos());
    const b = await libro([row()], w => { w.worksheets[0].name = "OTRA"; });
    await confirmarCB2(await preparar(b), "otra-clave-sintetica-04a");
    expect(consumos()).toEqual(antes); expect(internos()).toEqual(vales);
    expect(originales().some(r => r.resultado === "REUTILIZADA")).toBe(true);
  });
  it("mismo vale con monto distinto bloquea nueva aparición, sin sobrescribir consumo previo", async () => {
    await confirmarCB2(await preparar()); const antes = structuredClone(consumos());
    const r = row(); r[5] = 201;
    await confirmarCB2(await preparar(await libro([r])), "conflicto-sintetico-04a");
    expect(consumos()).toEqual(antes); expect(originales().some(r => r.resultado === "BLOQUEADA")).toBe(true);
  });
  it("misma clave recupera antes de token vencido; no duplica evidencia ni auditoría", async () => {
    const p = await preparar(); await confirmarCB2(p);
    const eventos = structuredClone(originales()), auditorias = m.auditar.mock.calls.length;
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(await confirmarCB2(p)).toMatchObject({ repetida: true });
    expect(originales()).toEqual(eventos); expect(m.auditar).toHaveBeenCalledTimes(auditorias); expect(m.guardar).toHaveBeenCalledOnce();
  });
  it("token vencido sin operación previa no sube evidencia", async () => {
    const p = await preparar(); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60_000);
    await expect(confirmarCB2(p)).rejects.toMatchObject({ status: 409 });
    expect(m.guardar).not.toHaveBeenCalled(); expect(consumos()).toHaveLength(0);
  });
  it.each(["actor", "contenido"])("clave CB2 reutilizada con %s diferente rechaza recuperación", async caso => {
    const p = await preparar(); await confirmarCB2(p);
    const antes = structuredClone(originales());
    await expect(confirmarArchivo(caso === "actor" ? { ...ctx, actor: { id: 10, username: "otro-demo" } } : ctx, p.b, archivo.name,
      caso === "contenido" ? { ...p.entrada, moneda: "USD" } : p.entrada, "clave-sintetica-04a", p.recibo.token)).rejects.toThrow("incompatible");
    expect(originales()).toEqual(antes); expect(m.guardar).toHaveBeenCalledOnce();
  });
  it("mismo archivo CB2 con clave nueva requiere reanudación en vez de crear otra cabecera", async () => {
    const p = await preparar(); await confirmarCB2(p);
    expect(await confirmarCB2(p, "clave-nueva-04a")).toMatchObject({ existente: true, requiereReanudacion: true });
    expect(tablas.flota_cb2_importaciones).toHaveLength(1); expect(m.guardar).toHaveBeenCalledOnce();
  });
  it("diario CB2 incompleto impide recuperar y no certifica otra importación", async () => {
    const p = await preparar(); await confirmarCB2(p); originales().pop();
    await expect(confirmarCB2(p)).rejects.toThrow("incompleto");
    expect(m.guardar).toHaveBeenCalledOnce(); expect(consumos()).toHaveLength(1);
  });
  it("C2B no revalida callback de autorización del servicio CB2: deuda de contrato, no permiso aprobado", async () => {
    const p = await preparar(); m.autorizar.mockRejectedValue(new ErrorCB2("revocado", 403));
    await importarC2B(p.b);
    expect(m.autorizar).not.toHaveBeenCalled(); expect(tablas.flota_combustible_conciliaciones).toHaveLength(1);
    // Se invoca el servicio C2B, no el guard HTTP. No demuestra que un endpoint acepte un usuario revocado.
  });
  it("C2B repetido devuelve 409, no recupera resultado idempotente CB2", async () => {
    const p = await preparar(), recibo = await previewImportacion(1, 3, ctx.actor, p.b);
    await confirmarImportacion(1, 3, ctx.actor, p.b, archivo, recibo.token);
    await expect(confirmarImportacion(1, 3, ctx.actor, p.b, archivo, recibo.token)).rejects.toMatchObject({ status: 409 });
    expect(tablas.flota_combustible_conciliaciones).toHaveLength(1); expect(m.subir).toHaveBeenCalledOnce();
  });
  it("C2B reclasificación posterior al preview exige nuevo recibo antes del upload", async () => {
    const p = await preparar(), recibo = await previewImportacion(1, 3, ctx.actor, p.b);
    await importarC2B(p.b); // antecedente del mismo vale en otro archivo
    tablas.flota_combustible_conciliaciones[0].archivo_sha256 = "otro-hash-sintetico";
    const subidas = m.subir.mock.calls.length;
    await expect(confirmarImportacion(1, 3, ctx.actor, p.b, archivo, recibo.token)).rejects.toThrow("clasificación cambió");
    expect(m.subir).toHaveBeenCalledTimes(subidas);
  });
  it("C2B token vencido aun con archivo confirmado no recupera recibo previo", async () => {
    const p = await preparar(), recibo = await previewImportacion(1, 3, ctx.actor, p.b);
    await confirmarImportacion(1, 3, ctx.actor, p.b, archivo, recibo.token);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60_000);
    await expect(confirmarImportacion(1, 3, ctx.actor, p.b, archivo, recibo.token)).rejects.toThrow("expiró");
    expect(m.subir).toHaveBeenCalledOnce();
  });
});

describe("04A transacción CB2 y conservación de evidencia comparada", () => {
  it("CB2 rollback fallido clasifica resultado incierto y conserva archivo preparado", async () => {
    const p = await preparar(); m.auditar.mockRejectedValueOnce(Error("fallo original")); m.rollback.mockRejectedValueOnce(Error("rollback perdido"));
    await expect(confirmarCB2(p)).rejects.toMatchObject({ status: 503, incierto: true });
    expect(m.compensar).not.toHaveBeenCalled(); expect(m.destroy).toHaveBeenCalledOnce();
  });
  it("revocación tras esperar bloqueo simulado impide ejecutar callback transaccional", async () => {
    const orden: string[] = [], callback = vi.fn();
    const original = m.query.getMockImplementation()!;
    m.query.mockImplementation(async (s: string, p: unknown[]) => {
      if (s.includes("FROM compras_proveedores") && s.includes("FOR UPDATE")) orden.push("proveedor-bloqueado");
      return original(s, p);
    });
    m.autorizar.mockImplementation(async () => { orden.push("revocado"); throw new ErrorCB2("permiso revocado", 403); });
    await expect(tx(ctx, callback)).rejects.toMatchObject({ status: 403 });
    expect(orden).toEqual(["proveedor-bloqueado", "revocado"]); expect(callback).not.toHaveBeenCalled(); expect(m.commit).not.toHaveBeenCalled();
  });
  it.each(["vehiculo", "empleado", "proveedor"])("catálogo %s revocado después del preview impide consumo", async caso => {
    const p = await preparar(undefined, caso === "empleado");
    if (caso === "vehiculo") vehiculoActivo = false;
    if (caso === "empleado") empleadoActivo = false;
    if (caso === "proveedor") proveedorActivo = false;
    await expect(confirmarCB2(p)).rejects.toMatchObject({ status: 403 }); expect(consumos()).toHaveLength(0);
  });
  it.each(["CB2", "C2B"])("%s COMMIT confirmado conserva evidencia", async flujo => {
    const p = await preparar(); if (flujo === "CB2") await confirmarCB2(p); else await importarC2B(p.b);
    expect(m.compensar).not.toHaveBeenCalled(); expect(m.borrar).not.toHaveBeenCalled();
  });
  it.each(["CB2", "C2B"])("%s rollback antes de COMMIT compensa solo evidencia nueva", async flujo => {
    const p = await preparar(); m.auditar.mockRejectedValueOnce(Error("auditoría simulada fallida"));
    await expect(flujo === "CB2" ? confirmarCB2(p) : importarC2B(p.b)).rejects.toThrow("auditoría simulada fallida");
    // CB2 ya confirmó la transacción inicial de consulta; la transacción de escritura revierte.
    expect(m.commit).toHaveBeenCalledTimes(flujo === "CB2" ? 1 : 0); expect(tablas.flota_cb2_importaciones).toHaveLength(0); expect(tablas.flota_combustible_conciliaciones).toHaveLength(0);
    expect(flujo === "CB2" ? m.compensar.mock.calls : m.borrar.mock.calls).toEqual(flujo === "CB2" ? [[1, "empresas/1/flota/cb2/sintetico.xlsx"]] : [["empresas/1/flota/reporte-sintetico.xlsx"]]);
  });
  it.each(["CB2", "C2B"])("%s COMMIT incierto conserva evidencia potencialmente referenciada", async flujo => {
    const p = await preparar();
    // CB2 realiza una primera transacción de recuperación sin escrituras antes del upload.
    m.commit.mockImplementation(async () => {
      if (m.guardar.mock.calls.length || m.subir.mock.calls.length) {
        snapshot = structuredClone(tablas); // escenario sintético: commit aplicado, respuesta perdida
        throw Error("respuesta COMMIT perdida");
      }
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resultado = flujo === "CB2" ? confirmarCB2(p) : importarC2B(p.b);
    if (flujo === "CB2") await expect(resultado).rejects.toMatchObject({ status: 503, incierto: true });
    else await expect(resultado).rejects.toThrow("respuesta COMMIT perdida");
    expect(m.compensar).not.toHaveBeenCalled(); expect(m.borrar).not.toHaveBeenCalled();
    expect(tablas[flujo === "CB2" ? "flota_cb2_importaciones" : "flota_combustible_conciliaciones"]).toHaveLength(1);
    if (flujo === "CB2") expect(m.destroy).toHaveBeenCalledOnce(); else expect(warn).toHaveBeenCalledOnce();
  });
});
