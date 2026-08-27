import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("fs/promises", () => ({ readFile: vi.fn(), stat: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ getUploadsRoot: () => process.cwd(), guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/documentos", () => ({ registrarDocumento: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
import { query } from "@/lib/db";
import { readFile, stat } from "fs/promises";
import { guardarUpload, borrarUpload } from "@/lib/uploads";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { registrarDocumento } from "@/lib/rrhh/documentos";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { respuestaFotoEmpleado, tipoFotoEmpleado } from "./foto-empleado";
import { POST } from "@/app/api/empresas/[slug]/empleados/[id]/foto/route";
import { GET as propia } from "@/app/api/portal/ficha/foto/route";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const path = "empresas/3/documentos/emp7_foto.png";
const enviar = (contenido: BlobPart = png, nombre = "foto.png") => {
  const fd = new FormData(); fd.set("file", new File([contenido], nombre));
  return POST(new Request("http://localhost/foto", { method: "POST", body: fd }), { params: Promise.resolve({ slug: "kt", id: "7" }) });
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3 }, session: { username: "prueba" } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(obtenerEmpleado).mockResolvedValue({ id: 7 } as NonNullable<Awaited<ReturnType<typeof obtenerEmpleado>>>);
  vi.mocked(guardarUpload).mockResolvedValue({ relative: path, original: "foto.png", size: 8 });
  vi.mocked(registrarDocumento).mockResolvedValue(10);
  vi.mocked(query).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("fotografía del empleado", () => {
  it("reconoce formatos y rechaza SVG/PDF", () => {
    expect(tipoFotoEmpleado(png)).toBe("image/png");
    expect(tipoFotoEmpleado(new Uint8Array([255, 216, 255]))).toBe("image/jpeg");
    expect(tipoFotoEmpleado(Buffer.from("RIFF0000WEBP"))).toBe("image/webp");
    expect(tipoFotoEmpleado(Buffer.from("<svg/>"))).toBeNull();
    expect(tipoFotoEmpleado(Buffer.from("%PDF-1.4"))).toBeNull();
  });
  it("guarda Foto en el expediente existente usando la extensión del contenido", async () => {
    expect((await enviar(png, "archivo.exe")).status).toBe(201);
    expect(obtenerEmpleado).toHaveBeenCalledWith(3, 7);
    expect(guardarUpload).toHaveBeenCalledWith(3, "documentos", "emp7_foto", expect.objectContaining({ name: "foto.png" }));
    expect(registrarDocumento).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 3, idEmpleado: 7, tipoDocumento: "Foto", rutaArchivo: path }));
    expect(borrarUpload).not.toHaveBeenCalled();
  });
  it("no escribe sin permisos", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantRrhh>>);
    expect((await enviar()).status).toBe(403);
    expect(obtenerEmpleado).not.toHaveBeenCalled();
    expect(guardarUpload).not.toHaveBeenCalled();
  });
  it("no escribe si el empleado no pertenece a la empresa", async () => {
    vi.mocked(obtenerEmpleado).mockResolvedValue(null);
    expect((await enviar()).status).toBe(404);
    expect(guardarUpload).not.toHaveBeenCalled();
  });
  it("rechaza contenido no imagen y exceso de tamaño", async () => {
    expect((await enviar("<svg/>")).status).toBe(400);
    expect((await enviar(new Uint8Array(5 * 1024 * 1024 + 1))).status).toBe(400);
    expect(guardarUpload).not.toHaveBeenCalled();
  });
  it("si falla el registro limpia únicamente el nuevo archivo", async () => {
    vi.mocked(registrarDocumento).mockRejectedValue(new Error("fallo simulado"));
    expect((await enviar()).status).toBe(500);
    expect(borrarUpload).toHaveBeenCalledExactlyOnceWith(path);
  });
  it("portal exige sesión y obtiene IDs exclusivamente de ella", async () => {
    vi.mocked(getColaboradorSession).mockResolvedValue(null);
    expect((await propia()).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
    vi.mocked(getColaboradorSession).mockResolvedValue({ empresaId: 3, empleadoId: 7 } as NonNullable<Awaited<ReturnType<typeof getColaboradorSession>>>);
    expect((await propia()).status).toBe(404);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ? AND id_empleado = ?"), [3, 7]);
  });
  it("sirve la última foto sin caché pública", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 10, ruta_archivo: path }] as RowDataPacket[]);
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 8 } as Awaited<ReturnType<typeof stat>>);
    vi.mocked(readFile).mockResolvedValue(Buffer.from(png));
    const res = await respuestaFotoEmpleado(3, 7);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY subido_en DESC, id DESC LIMIT 1"), [3, 7]);
  });
  it("no lee rutas fuera del directorio documental de la empresa", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 10, ruta_archivo: "empresas/4/documentos/foto.png" }] as RowDataPacket[]);
    await expect(respuestaFotoEmpleado(3, 7)).rejects.toThrow("Ruta de fotografía inválida");
    expect(readFile).not.toHaveBeenCalled();
  });
});
