import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/documentos", () => ({
  listarDocumentos: vi.fn(),
  registrarDocumento: vi.fn(),
  TIPOS_DOCUMENTO: [
    "DPI", "Foto", "Contrato", "Licencia", "Antecedentes penales",
    "Antecedentes policíacos", "Tarjeta de pulmones", "Tarjeta de salud",
    "Manipulación de alimentos", "IGSS", "Boleta permiso", "Otro",
  ],
}));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { listarDocumentos, registrarDocumento } from "@/lib/rrhh/documentos";
import { guardarUpload, borrarUpload } from "@/lib/uploads";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "sitsa", id: "42" }) };

function reqConArchivo(nombre = "dpi.pdf"): Request {
  const form = new FormData();
  form.append("tipo", "DPI");
  form.append("file", new File([new Uint8Array([1, 2, 3])], nombre, { type: "application/pdf" }));
  return new Request("http://localhost/x", { method: "POST", body: form });
}

/** Simula req.formData() lanzando el error técnico real de Next/undici
 * cuando el body multipart llega incompleto/truncado. */
function reqFormDataRota(): Request {
  return {
    formData: () => Promise.reject(new TypeError("Failed to parse body as FormData.")),
  } as unknown as Request;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(requireTenantRrhh).mockResolvedValue({
    empresa: { id: 7 },
    session: { username: "rrhh1" },
  } as unknown as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(obtenerEmpleado).mockResolvedValue({ id: 42, nombre: "Juan Pérez" } as unknown as Awaited<
    ReturnType<typeof obtenerEmpleado>
  >);
  vi.mocked(guardarUpload).mockResolvedValue({
    relative: "empresas/7/documentos/emp42_x.pdf",
    original: "dpi.pdf",
    size: 3,
  });
  vi.mocked(registrarDocumento).mockResolvedValue(101);
});
afterEach(() => vi.restoreAllMocks());

describe("RRHH-EXPEDIENTES-UPLOAD-STABILITY — POST documentos", () => {
  it("Caso A: multipart válido + archivo pequeño → éxito, 200", async () => {
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mensaje).toBe("Documento subido.");
    expect(data.id).toBe(101);
    expect(guardarUpload).toHaveBeenCalledTimes(1);
    expect(registrarDocumento).toHaveBeenCalledTimes(1);
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("Caso B: req.formData() lanza el error técnico de bajo nivel → respuesta funcional, NUNCA expone 'Failed to parse body as FormData.'", async () => {
    const res = await POST(reqFormDataRota(), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).not.toMatch(/Failed to parse/i);
    expect(data.error).not.toMatch(/FormData/);
    // Mensaje funcional, no afirma con certeza que el archivo es
    // demasiado grande (el servidor no puede saberlo si el proxy ya
    // truncó el request).
    expect(data.error).toMatch(/Puede ser demasiado grande o la conexión se interrumpió/);
    expect(guardarUpload).not.toHaveBeenCalled();
    expect(registrarDocumento).not.toHaveBeenCalled();
    // El detalle técnico SÍ se registra, pero solo en el log del
    // servidor — nunca en la respuesta HTTP.
    expect(console.error).toHaveBeenCalled();
  });

  it("Caso C: guardarUpload rechaza por tamaño (mensaje ya funcional de uploads.ts) → rechazado claramente, DB no se toca", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(new Error("El archivo supera el máximo de 50 MB."));
    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();
    expect(data.error).toBe("El archivo supera el máximo de 50 MB.");
    expect(registrarDocumento).not.toHaveBeenCalled();
    // guardarUpload nunca llegó a escribir nada (rechazó antes) → nada
    // que limpiar.
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("Caso E: guardarUpload rechaza por formato no permitido → rechazado claramente", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(
      new Error("Formato no permitido. Usa: jpg, png, webp, bmp o pdf."),
    );
    const res = await POST(reqConArchivo("contrato.docx"), ctx);
    const data = await res.json();
    expect(data.error).toMatch(/Formato no permitido/);
    expect(registrarDocumento).not.toHaveBeenCalled();
  });

  it("Caso F: guardarUpload falla → registrarDocumento NUNCA se llama (DB no se toca)", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(new Error("Archivo vacío."));
    await POST(reqConArchivo(), ctx);
    expect(registrarDocumento).not.toHaveBeenCalled();
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("Caso G: guardarUpload funciona pero registrarDocumento falla → cleanup best-effort del archivo recién creado", async () => {
    vi.mocked(registrarDocumento).mockRejectedValue(new Error("INSERT falló"));
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(500);
    expect(guardarUpload).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/documentos/emp42_x.pdf");
  });

  it("empleado no encontrado → 404, nunca llega a formData/guardarUpload", async () => {
    vi.mocked(obtenerEmpleado).mockResolvedValue(null);
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(404);
    expect(guardarUpload).not.toHaveBeenCalled();
  });

  it("sin permiso (ni editar ni crear) → error del guard, nunca toca la DB", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as unknown as Awaited<ReturnType<typeof requireTenantRrhh>>);
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(403);
    expect(obtenerEmpleado).not.toHaveBeenCalled();
  });
});

describe("RRHH-EXPEDIENTES-UPLOAD-STABILITY — GET documentos (Casos H/I: intacto, solo lectura)", () => {
  it("Caso H: GET sigue funcionando igual — lista documentos del empleado", async () => {
    vi.mocked(listarDocumentos).mockResolvedValue([
      { id: 1, empresaId: 7, idEmpleado: 42, tipoDocumento: "DPI", rutaArchivo: "x", nombreOriginal: "dpi.pdf", subidoEn: "2026-09-02", subidoPor: "rrhh1" },
    ]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.documentos).toHaveLength(1);
  });

  it("Caso I: GET nunca escribe — no llama guardarUpload/registrarDocumento/borrarUpload", async () => {
    vi.mocked(listarDocumentos).mockResolvedValue([]);
    await GET(new Request("http://localhost/x"), ctx);
    expect(guardarUpload).not.toHaveBeenCalled();
    expect(registrarDocumento).not.toHaveBeenCalled();
    expect(borrarUpload).not.toHaveBeenCalled();
  });
});
