import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), connQuery: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), upload: vi.fn(), borrar: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ getConnection: async () => ({ ...m, query: m.connQuery }) }) }));
vi.mock("@/lib/auth-secret", () => ({ getAuthSecretBytes: () => new TextEncoder().encode("secreto-local-sintetico-solo-pruebas-importacion") }));
vi.mock("@/lib/uploads", () => ({ guardarUploadExcel: m.upload, borrarUpload: m.borrar, validarRutaArchivoEmpresa: () => "ruta-verificada" }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
import { confirmarImportacion, previewImportacion, detalleImportacion } from "./combustible-importaciones";
import { fixtureProveedor } from "./combustible-importacion.fixture";
let buffer: Buffer, repetido = false, previo = false, ajeno = false, nextId = 40;
const actor = { id: 8, username: "op" };
const archivo = { name: "anonimo.xlsx", size: 1, arrayBuffer: async () => new ArrayBuffer(1) };
beforeAll(async () => { buffer = await fixtureProveedor(); });
beforeEach(() => {
  vi.resetAllMocks(); repetido = false; previo = false; ajeno = false; nextId = 40;
  const rows = (sql: string, params: unknown[]) => {
    if (sql.includes("FROM compras_proveedores")) return ajeno ? [] : [{ id: 3, nombre_comercial: "Proveedor demo", activo: 1 }];
    if (sql.includes("archivo_sha256")) return repetido ? [{ id: 22 }] : [];
    if (sql.includes("SELECT DISTINCT")) return previo ? (params.slice(2) as string[]).map(k => ({ clave_operacion: k })) : [];
    return [];
  };
  m.query.mockImplementation(async (s, p) => rows(s, p)); m.connQuery.mockImplementation(async (s, p) => [rows(s, p)]);
  m.execute.mockImplementation(async () => [{ insertId: nextId++ }]);
  m.upload.mockResolvedValue({ relative: "empresas/1/flota/nuevo.xlsx", original: "anonimo.xlsx", size: 100 });
});
describe("preview y confirmación independientes de vales", () => {
  it("preview no escribe BD ni archivo; confirmar guarda todas las filas y auditoría atómica", async () => {
    const p = await previewImportacion(1, 3, actor, buffer);
    expect(m.execute).not.toHaveBeenCalled(); expect(m.upload).not.toHaveBeenCalled(); expect(m.beginTransaction).not.toHaveBeenCalled();
    const r = await confirmarImportacion(1, 3, actor, buffer, archivo, p.token);
    expect(r.id).toBe(40); expect(m.commit).toHaveBeenCalledOnce(); expect(m.auditar).toHaveBeenCalledOnce();
    expect(m.execute).toHaveBeenCalledTimes(p.filas.length + 1);
    for (const [sql, params] of m.execute.mock.calls) expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
    for (const [sql] of m.execute.mock.calls) {
      const columnas = sql.match(/\(([\s\S]*?)\)\s*VALUES/)![1].split(",");
      const valores = sql.match(/VALUES\s*\(([\s\S]*?)\)/)![1].split(",");
      expect(columnas.length).toBe(valores.length);
    }
    const idx = p.filas.findIndex(f => f.duplicado === "EXACTO");
    expect(m.execute.mock.calls[idx + 1][1].at(-1)).toBe(41 + p.filas[idx].canonica!);
    const sql = m.execute.mock.calls.map(c => c[0]).join(" "); expect(sql).not.toMatch(/INSERT INTO empleados|UPDATE flota_combustible_cargas|carga_combustible_id|solicitud_fondo_linea_id/);
    expect(m.upload.mock.calls[0][3]).toMatchObject({ name: "anonimo.xlsx", size: buffer.length });
    expect(Buffer.from(await m.upload.mock.calls[0][3].arrayBuffer())).toEqual(buffer);
  });
  it("bloquea mismo archivo, sin reimportación silenciosa", async () => {
    const p = await previewImportacion(1, 3, actor, buffer); repetido = true;
    await expect(previewImportacion(1, 3, actor, buffer)).rejects.toMatchObject({ status: 409 });
    await expect(confirmarImportacion(1, 3, actor, buffer, archivo, p.token)).rejects.toThrow("ya fue importado"); expect(m.upload).not.toHaveBeenCalled();
  });
  it("operación previa se advierte sin fusionar y nueva aparición entre preview/confirmar exige repetir preview", async () => {
    const p = await previewImportacion(1, 3, actor, buffer); previo = true;
    await expect(confirmarImportacion(1, 3, actor, buffer, archivo, p.token)).rejects.toThrow("clasificación cambió");
    const p2 = await previewImportacion(1, 3, actor, buffer); expect(p2.resumen.duplicadosPrevios).toBe(20);
    await confirmarImportacion(1, 3, actor, buffer, archivo, p2.token); expect(m.commit).toHaveBeenCalledOnce();
    for (const [sql, params] of m.query.mock.calls) if (sql.includes("SELECT DISTINCT")) expect(params.slice(0, 2)).toEqual([1, 3]);
  });
  it("proveedor ajeno rechazado", async () => { ajeno = true; await expect(previewImportacion(2, 3, actor, buffer)).rejects.toThrow("esta empresa"); expect(m.upload).not.toHaveBeenCalled(); });
  it.each(["tenant", "proveedor", "usuario", "archivo", "token"])("no acepta confirmar otro %s con el recibo", async caso => {
    const p = await previewImportacion(1, 3, actor, buffer);
    await expect(confirmarImportacion(caso === "tenant" ? 2 : 1, caso === "proveedor" ? 4 : 3, caso === "usuario" ? { ...actor, id: 9 } : actor, caso === "archivo" ? Buffer.from("distinto") : buffer, archivo, caso === "token" ? "inventado" : p.token)).rejects.toMatchObject({ status: 409 });
    expect(m.upload).not.toHaveBeenCalled();
  });
  it.each(["insert", "auditoria", "upload"])("rollback en %s compensa solamente el archivo nuevo", async caso => {
    const p = await previewImportacion(1, 3, actor, buffer);
    if (caso === "insert") m.execute.mockRejectedValue(new Error("DB"));
    if (caso === "auditoria") m.auditar.mockRejectedValue(new Error("DB"));
    if (caso === "upload") m.upload.mockRejectedValue(new Error("upload"));
    await expect(confirmarImportacion(1, 3, actor, buffer, archivo, p.token)).rejects.toThrow();
    expect(m.rollback).toHaveBeenCalledOnce(); expect(m.commit).not.toHaveBeenCalled();
    expect(m.borrar).toHaveBeenCalledTimes(caso === "upload" ? 0 : 1);
  });
  it("UNIQUE físico protege carrera y devuelve 409", async () => {
    const p = await previewImportacion(1, 3, actor, buffer); m.execute.mockRejectedValue({ code: "ER_DUP_ENTRY" });
    await expect(confirmarImportacion(1, 3, actor, buffer, archivo, p.token)).rejects.toMatchObject({ status: 409 });
  });
  it("COMMIT incierto no destruye evidencia que podría haber quedado referenciada", async () => {
    const p = await previewImportacion(1, 3, actor, buffer);
    m.commit.mockRejectedValue(new Error("conexión interrumpida"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(confirmarImportacion(1, 3, actor, buffer, archivo, p.token)).rejects.toThrow("conexión interrumpida");
    expect(m.borrar).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalledOnce(); warn.mockRestore();
  });
  it("detalle exige tenant y perfil y no devuelve rutas físicas", async () => {
    expect(await detalleImportacion(2, 40)).toBeNull();
    expect(m.query.mock.calls[0][0]).toContain("empresa_id=? AND id=? AND perfil_parser='HALEL'"); expect(m.query.mock.calls[0][1]).toEqual([2, 40]);
  });
});
