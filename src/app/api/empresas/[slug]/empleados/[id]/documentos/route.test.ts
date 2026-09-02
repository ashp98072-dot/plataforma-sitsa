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
vi.mock("@/lib/uploads", async () => {
  // AJUSTE PRE-MERGE PR #176 — UploadValidationError se mantiene REAL
  // (vía importActual), no mockeada: la ruta hace `instanceof
  // UploadValidationError` para decidir si expone el mensaje, así que el
  // test necesita la misma clase real, no un doble que solo comparte
  // forma.
  const actual = await vi.importActual<typeof import("@/lib/uploads")>("@/lib/uploads");
  return { ...actual, guardarUpload: vi.fn(), borrarUpload: vi.fn() };
});

import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { listarDocumentos, registrarDocumento } from "@/lib/rrhh/documentos";
import { guardarUpload, borrarUpload, UploadValidationError } from "@/lib/uploads";
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

  it("Caso C / sección 2-A: guardarUpload rechaza por tamaño → NO 500, sino 413 con mensaje funcional, DB no se toca", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(
      new UploadValidationError("El archivo supera el máximo de 50 MB.", 413),
    );
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(413);
    expect(res.status).not.toBe(500);
    const data = await res.json();
    expect(data.error).toBe("El archivo supera el máximo de 50 MB.");
    expect(registrarDocumento).not.toHaveBeenCalled();
    // guardarUpload nunca llegó a escribir nada (rechazó antes) → nada
    // que limpiar.
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("Caso E / sección 2-B: guardarUpload rechaza por formato no permitido → NO 500, sino 400 con mensaje funcional", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(
      new UploadValidationError("Formato no permitido. Usa: jpg, png, webp, bmp o pdf.", 400),
    );
    const res = await POST(reqConArchivo("contrato.docx"), ctx);
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/Formato no permitido/);
    expect(registrarDocumento).not.toHaveBeenCalled();
  });

  it("Caso F / sección 2-C: guardarUpload rechaza por archivo vacío → NO 500, sino 400, registrarDocumento NUNCA se llama (DB no se toca)", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(new UploadValidationError("Archivo vacío.", 400));
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Archivo vacío.");
    expect(registrarDocumento).not.toHaveBeenCalled();
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("Caso G: guardarUpload funciona pero registrarDocumento falla (error interno genérico) → cleanup best-effort del archivo, respuesta genérica", async () => {
    vi.mocked(registrarDocumento).mockRejectedValue(new Error("INSERT falló"));
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).not.toBe("INSERT falló");
    expect(data.error).toBe("No se pudo completar la carga del documento. Intenta nuevamente.");
    expect(guardarUpload).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/documentos/emp42_x.pdf");
  });

  it("AJUSTE PRE-MERGE PR #176 (punto 1): error de DB con código MySQL real → 500 genérico, NUNCA expone el error técnico, cleanup sigue ocurriendo", async () => {
    vi.mocked(registrarDocumento).mockRejectedValue(
      new Error("ER_NO_REFERENCED_ROW_2: Cannot add or update a child row: a foreign key constraint fails"),
    );
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(JSON.stringify(data)).not.toMatch(/ER_NO_REFERENCED_ROW_2/);
    expect(JSON.stringify(data)).not.toMatch(/foreign key/i);
    expect(data.error).toBe("No se pudo completar la carga del documento. Intenta nuevamente.");
    // El cleanup del archivo sigue ocurriendo igual, sin importar qué
    // tipo de error interno haya sido.
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/documentos/emp42_x.pdf");
  });

  it("error de filesystem al escribir (guardarUpload) → 500 genérico, nunca expone el mensaje interno del fs", async () => {
    vi.mocked(guardarUpload).mockRejectedValue(
      new Error("ENOSPC: no space left on device, write '/var/app/uploads/empresas/7/documentos/x.pdf'"),
    );
    const res = await POST(reqConArchivo(), ctx);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(JSON.stringify(data)).not.toMatch(/ENOSPC/);
    expect(JSON.stringify(data)).not.toMatch(/\/var\/app/);
    expect(data.error).toBe("No se pudo completar la carga del documento. Intenta nuevamente.");
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
