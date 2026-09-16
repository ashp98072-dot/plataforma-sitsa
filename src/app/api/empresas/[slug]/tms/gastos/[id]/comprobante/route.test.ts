import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(), borrarUpload: vi.fn(), contentTypeFor: vi.fn(() => "application/pdf"),
  validarRutaArchivoEmpresa: vi.fn(() => "C:/safe/file.pdf"),
  getUploadsRoot: vi.fn(() => "/hbuilds/uploads"),
  UploadValidationError: class UploadValidationError extends Error { constructor(message: string, public status: number) { super(message); } },
}));
vi.mock("fs/promises", () => ({ readFile: vi.fn(async () => Buffer.from("pdf")) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => true) }));

import { execute, query } from "@/lib/db";
import { requireTenantGastos } from "@/lib/tenant";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { DELETE, GET, POST } from "./route";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { getUploadsRoot, validarRutaArchivoEmpresa } from "@/lib/uploads";

const ctx = { params: Promise.resolve({ slug: "kt", id: "8" }) };
const fila = { activo: 1, factura_ruta_relativa: null, factura_nombre_original: null, factura_mime: null, factura_tamano: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 7 }, session: { username: "admin" } } as never);
});

describe("comprobante de gasto", () => {
  it.each(["ENOENT", "EACCES"])("registra diagnóstico seguro para %s sin cambiar respuesta", async (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(query).mockResolvedValue([{ ...fila, factura_ruta_relativa: "empresas/7/documentos/a.pdf", factura_nombre_original: "a.pdf" }] as never);
      vi.mocked(getUploadsRoot).mockReturnValue("/hbuilds/uploads");
      vi.mocked(validarRutaArchivoEmpresa).mockReturnValue("/hbuilds/uploads/empresas/7/documentos/a.pdf");
      vi.mocked(existsSync).mockReturnValue(code === "EACCES");
      vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error("no registrar mensaje"), { code }));
      const res = await GET(new Request("http://x"), ctx);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Comprobante no encontrado en disco." });
      expect(log).toHaveBeenCalledWith("[gastos-comprobante-diagnostico]", {
        uploadsRoot: "/hbuilds/uploads", imagenRuta: "empresas/7/documentos/a.pdf",
        rutaAbsolutaCalculada: "/hbuilds/uploads/empresas/7/documentos/a.pdf",
        existsSync: code === "EACCES", cwd: process.cwd(),
        uploadDirDefinida: Boolean(process.env.UPLOAD_DIR?.trim()), codigoError: code,
        etapa: "lectura", nombreError: "Error", mensajeError: "no registrar mensaje",
      });
      expect(execute).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("distingue fallo de respuesta después de leer el archivo sin modificar el 404", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(query).mockResolvedValue([{ ...fila, factura_ruta_relativa: "empresas/7/documentos/a.pdf", factura_nombre_original: "catálogo 漢.pdf" }] as never);
      vi.mocked(getUploadsRoot).mockReturnValue("/hbuilds/uploads");
      vi.mocked(validarRutaArchivoEmpresa).mockReturnValue("/hbuilds/uploads/empresas/7/documentos/a.pdf");
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from("contenido privado"));
      const res = await GET(new Request("http://x"), ctx);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Comprobante no encontrado en disco." });
      expect(log).toHaveBeenCalledWith("[gastos-comprobante-diagnostico]", expect.objectContaining({
        etapa: "construccion_respuesta", nombreError: "TypeError", mensajeError: expect.any(String),
        existsSync: true, codigoError: null,
      }));
      expect(JSON.stringify(log.mock.calls)).not.toContain("contenido privado");
      expect(execute).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("sube PDF válido en el ámbito de la empresa y marca tiene_factura", async () => {
    vi.mocked(query).mockResolvedValue([fila] as never);
    vi.mocked(guardarUpload).mockResolvedValue({ relative: "empresas/7/documentos/gasto8.pdf", original: "factura.pdf", size: 3 });
    const fd = new FormData(); fd.set("file", new File(["pdf"], "factura.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://x", { method: "POST", body: fd }), ctx);
    expect(res.status).toBe(200);
    expect(guardarUpload).toHaveBeenCalledWith(7, "documentos", "gasto8-factura", expect.any(File));
    expect(vi.mocked(execute).mock.calls[0][0]).toContain("tiene_factura = 1");
    expect(vi.mocked(execute).mock.calls[0][1]).toEqual(expect.arrayContaining([8, 7]));
  });

  it("rechaza extensiones no autorizadas", async () => {
    vi.mocked(query).mockResolvedValue([fila] as never);
    const fd = new FormData(); fd.set("file", new File(["x"], "factura.exe", { type: "application/octet-stream" }));
    const res = await POST(new Request("http://x", { method: "POST", body: fd }), ctx);
    expect(res.status).toBe(400); expect(guardarUpload).not.toHaveBeenCalled();
  });

  it("reemplaza y elimina el archivo anterior", async () => {
    vi.mocked(query).mockResolvedValue([{ ...fila, factura_ruta_relativa: "empresas/7/documentos/anterior.pdf", factura_nombre_original: "anterior.pdf" }] as never);
    vi.mocked(guardarUpload).mockResolvedValue({ relative: "empresas/7/documentos/nuevo.png", original: "nuevo.png", size: 3 });
    const fd = new FormData(); fd.set("file", new File(["png"], "nuevo.png", { type: "image/png" }));
    expect((await POST(new Request("http://x", { method: "POST", body: fd }), ctx)).status).toBe(200);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/documentos/anterior.pdf");
  });

  it("DELETE limpia metadata y el indicador", async () => {
    vi.mocked(query).mockResolvedValue([{ ...fila, factura_ruta_relativa: "empresas/7/documentos/a.pdf", factura_nombre_original: "a.pdf" }] as never);
    expect((await DELETE(new Request("http://x", { method: "DELETE" }), ctx)).status).toBe(200);
    expect(vi.mocked(execute).mock.calls[0][0]).toContain("tiene_factura = 0");
    expect(borrarUpload).toHaveBeenCalled();
  });

  it("no expone comprobantes de otra empresa", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([8, 7]);
  });
});
