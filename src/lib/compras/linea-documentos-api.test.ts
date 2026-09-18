import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  requireCompras: vi.fn(),
  pertenece: vi.fn(),
  listar: vi.fn(),
  obtener: vi.fn(),
  registrar: vi.fn(),
  retirar: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  createReadStream: vi.fn(),
}));
vi.mock("./acceso", () => ({ requireComprasRequerimientos: m.requireCompras }));
vi.mock("./linea-documentos", async original => ({
  ...(await original<typeof import("./linea-documentos")>()),
  lineaPerteneceARequerimiento: m.pertenece,
  listarDocumentosLinea: m.listar,
  obtenerDocumentoLinea: m.obtener,
  registrarDocumentoLinea: m.registrar,
  retirarDocumentoLinea: m.retirar,
}));
vi.mock("fs", () => ({ existsSync: m.existsSync, statSync: m.statSync, createReadStream: m.createReadStream }));
vi.mock("@/lib/uploads", async original => {
  // UploadValidationError se mantiene REAL (mismo criterio que RRHH/Multas
  // — la ruta hace `instanceof UploadValidationError`).
  const actual = await original<typeof import("@/lib/uploads")>();
  return { ...actual, guardarUpload: vi.fn(), borrarUpload: vi.fn(), absPathFromRelative: vi.fn((r: string) => `/uploads/${r}`), contentTypeFor: actual.contentTypeFor };
});

import { Readable } from "stream";
import { guardarUpload, borrarUpload, UploadValidationError } from "@/lib/uploads";
import { lineaDocumentoRetirar, lineaDocumentoServir, lineaDocumentosGet, lineaDocumentoSubir } from "./linea-documentos-api";

const empresa = { id: 1 };
const session = { id: 8, username: "comprador" };

function reqConTipo(tipo: string, nombre = "factura.pdf"): Request {
  const fd = new FormData();
  fd.append("tipo", tipo);
  fd.append("file", new File([new Uint8Array([1, 2, 3])], nombre, { type: "application/pdf" }));
  return new Request("http://localhost/x", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.requireCompras.mockResolvedValue({ empresa, session, error: undefined });
  m.pertenece.mockResolvedValue(true);
  m.listar.mockResolvedValue([]);
  m.obtener.mockResolvedValue(null);
  m.registrar.mockResolvedValue(101);
  m.retirar.mockResolvedValue({ ok: true, mensaje: "Documento eliminado." });
  vi.mocked(guardarUpload).mockResolvedValue({ relative: "empresas/1/compras/req12_linea21_x.pdf", original: "factura.pdf", size: 3 });
});

describe("GET listar — compras_requerimientos:ver", () => {
  it("exige permiso ver y valida que la línea pertenezca al requerimiento", async () => {
    const res = await lineaDocumentosGet("a", "12", "21");
    expect(res.status).toBe(200);
    expect(m.requireCompras).toHaveBeenCalledWith("a", "ver");
    expect(m.pertenece).toHaveBeenCalledWith(1, 12, 21);
    expect(m.listar).toHaveBeenCalledWith(1, 12, 21);
  });

  it("línea que no pertenece al requerimiento => 404, nunca llega a listar", async () => {
    m.pertenece.mockResolvedValue(false);
    const res = await lineaDocumentosGet("a", "12", "21");
    expect(res.status).toBe(404);
    expect(m.listar).not.toHaveBeenCalled();
  });

  it("usuario sin permiso ver => 403", async () => {
    m.requireCompras.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    const res = await lineaDocumentosGet("a", "12", "21");
    expect(res.status).toBe(403);
    expect(m.pertenece).not.toHaveBeenCalled();
  });

  it("id/lineaId con formato inválido => 404 sin tocar el modelo", async () => {
    const res = await lineaDocumentosGet("a", "0", "21");
    expect(res.status).toBe(404);
    expect(m.pertenece).not.toHaveBeenCalled();
  });
});

describe("POST subir — compras_requerimientos:editar", () => {
  it("sube documento a línea válida con tipo permitido", async () => {
    const res = await lineaDocumentoSubir(reqConTipo("FACTURA"), "a", "12", "21");
    expect(res.status).toBe(201);
    expect(m.requireCompras).toHaveBeenCalledWith("a", "editar");
    expect(guardarUpload).toHaveBeenCalledWith(1, "compras", "req12_linea21", expect.anything());
    expect(m.registrar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 1, requerimientoId: 12, lineaId: 21, tipo: "FACTURA", subidoPorUsuarioId: 8 }));
  });

  it("múltiples documentos en la misma línea: cada subida es independiente", async () => {
    await lineaDocumentoSubir(reqConTipo("FACTURA", "factura.pdf"), "a", "12", "21");
    await lineaDocumentoSubir(reqConTipo("COTIZACION", "cotizacion.pdf"), "a", "12", "21");
    expect(m.registrar).toHaveBeenCalledTimes(2);
    expect(m.registrar.mock.calls[0][0].tipo).toBe("FACTURA");
    expect(m.registrar.mock.calls[1][0].tipo).toBe("COTIZACION");
  });

  it("línea que no pertenece al requerimiento => rechazo, nunca escribe", async () => {
    m.pertenece.mockResolvedValue(false);
    const res = await lineaDocumentoSubir(reqConTipo("FACTURA"), "a", "12", "21");
    expect(res.status).toBe(404);
    expect(guardarUpload).not.toHaveBeenCalled();
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("tipo no permitido => rechazo 400, nunca escribe", async () => {
    const res = await lineaDocumentoSubir(reqConTipo("INVENTADO"), "a", "12", "21");
    expect(res.status).toBe(400);
    expect(guardarUpload).not.toHaveBeenCalled();
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("archivo demasiado grande => rechazo, sin dejar huérfano en disco", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(new UploadValidationError("El archivo supera el máximo de 50 MB.", 413));
    const res = await lineaDocumentoSubir(reqConTipo("FACTURA"), "a", "12", "21");
    expect(res.status).toBe(413);
    expect(m.registrar).not.toHaveBeenCalled();
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("MIME/extensión inválida => rechazo (guardarUpload valida extensión)", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(new UploadValidationError("Formato no permitido. Usa: jpg, png, webp, bmp o pdf.", 400));
    const res = await lineaDocumentoSubir(reqConTipo("FACTURA", "malware.exe"), "a", "12", "21");
    expect(res.status).toBe(400);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("registrarDocumentoLinea falla tras guardar el archivo: cleanup best-effort", async () => {
    m.registrar.mockRejectedValue(new Error("INSERT falló"));
    const res = await lineaDocumentoSubir(reqConTipo("FACTURA"), "a", "12", "21");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).not.toContain("INSERT falló");
    expect(borrarUpload).toHaveBeenCalledWith("empresas/1/compras/req12_linea21_x.pdf");
  });

  it("usuario sin permiso editar => 403, nunca sube", async () => {
    m.requireCompras.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    const res = await lineaDocumentoSubir(reqConTipo("FACTURA"), "a", "12", "21");
    expect(res.status).toBe(403);
    expect(guardarUpload).not.toHaveBeenCalled();
  });

  it("archivo faltante => 400", async () => {
    const fd = new FormData();
    fd.append("tipo", "FACTURA");
    const res = await lineaDocumentoSubir(new Request("http://localhost/x", { method: "POST", body: fd }), "a", "12", "21");
    expect(res.status).toBe(400);
  });
});

describe("GET servir archivo (ver/descargar) — compras_requerimientos:ver", () => {
  it("sirve el archivo cuando el documento pertenece a la empresa y existe en disco", async () => {
    m.obtener.mockResolvedValue({ id: 55, rutaRelativa: "empresas/1/compras/x.pdf", nombreOriginal: "factura-123.pdf" });
    m.existsSync.mockReturnValue(true);
    m.statSync.mockReturnValue({ size: 999 });
    m.createReadStream.mockReturnValue(Readable.from([Buffer.from("x")]) as never);
    const res = await lineaDocumentoServir("a", "55");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("factura-123.pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("documento de otra empresa (tenant) => 404, nunca toca el filesystem", async () => {
    m.obtener.mockResolvedValue(null);
    const res = await lineaDocumentoServir("a", "55");
    expect(res.status).toBe(404);
    expect(m.existsSync).not.toHaveBeenCalled();
  });

  it("archivo no encontrado en disco => 404 funcional, no 500", async () => {
    m.obtener.mockResolvedValue({ id: 55, rutaRelativa: "empresas/1/compras/x.pdf", nombreOriginal: "x.pdf" });
    m.existsSync.mockReturnValue(false);
    const res = await lineaDocumentoServir("a", "55");
    expect(res.status).toBe(404);
  });

  it("usuario sin permiso ver => 403", async () => {
    m.requireCompras.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    const res = await lineaDocumentoServir("a", "55");
    expect(res.status).toBe(403);
    expect(m.obtener).not.toHaveBeenCalled();
  });
});

describe("DELETE retirar — compras_requerimientos:eliminar", () => {
  it("elimina con permiso", async () => {
    const res = await lineaDocumentoRetirar(new Request("http://localhost/x", { method: "DELETE", body: JSON.stringify({ motivo: "Duplicado" }) }), "a", "55");
    expect(res.status).toBe(200);
    expect(m.requireCompras).toHaveBeenCalledWith("a", "eliminar");
    expect(m.retirar).toHaveBeenCalledWith(1, 55, 8, "Duplicado");
  });

  it("no elimina sin permiso (403), nunca llama al modelo", async () => {
    m.requireCompras.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    const res = await lineaDocumentoRetirar(new Request("http://localhost/x", { method: "DELETE", body: "{}" }), "a", "55");
    expect(res.status).toBe(403);
    expect(m.retirar).not.toHaveBeenCalled();
  });

  it("propaga el status/mensaje del modelo (p. ej. 409 si el requerimiento ya no está Pendiente)", async () => {
    m.retirar.mockResolvedValue({ ok: false, status: 409, mensaje: "Solo se pueden eliminar documentos mientras el requerimiento esté Pendiente." });
    const res = await lineaDocumentoRetirar(new Request("http://localhost/x", { method: "DELETE", body: "{}" }), "a", "55");
    expect(res.status).toBe(409);
  });

  it("id inválido => 404 sin tocar el modelo", async () => {
    const res = await lineaDocumentoRetirar(new Request("http://localhost/x", { method: "DELETE", body: "{}" }), "a", "0");
    expect(res.status).toBe(404);
    expect(m.retirar).not.toHaveBeenCalled();
  });
});
