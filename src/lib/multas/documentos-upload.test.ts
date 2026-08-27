import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantMultas: vi.fn() }));
vi.mock("@/lib/multas/backend", () => ({ obtenerMulta: vi.fn() }));
vi.mock("@/lib/multas/documentos", () => ({
  registrarDocumentoMulta: vi.fn(),
  TIPOS_DOCUMENTO_MULTA: ["MULTA", "COMPROBANTE_PAGO", "FACTURA", "OTRO"],
}));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { requireTenantMultas } from "@/lib/tenant";
import { obtenerMulta } from "@/lib/multas/backend";
import { registrarDocumentoMulta } from "@/lib/multas/documentos";
import { guardarUpload, borrarUpload } from "@/lib/uploads";
import { POST } from "@/app/api/empresas/[slug]/operaciones/multas/[id]/documentos/route";

const idCtx = { params: Promise.resolve({ slug: "prueba", id: "9" }) };

function reqConArchivo(nombre: string): Request {
  const form = new FormData();
  form.append("tipo", "MULTA");
  form.append("file", new File([new Uint8Array([1, 2, 3])], nombre, { type: "application/octet-stream" }));
  return new Request("http://localhost/x", { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantMultas).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantMultas>>,
  );
  vi.mocked(obtenerMulta).mockResolvedValue({ id: 9 } as unknown as Awaited<ReturnType<typeof obtenerMulta>>);
  vi.mocked(guardarUpload).mockResolvedValue({ relative: "empresas/7/multas/multa9_x.pdf", original: "archivo.pdf", size: 3 });
  vi.mocked(registrarDocumentoMulta).mockResolvedValue(55);
});
afterEach(() => vi.restoreAllMocks());

describe("MULTAS-5 (robustez) — subida de documentos", () => {
  it("1) si registrarDocumentoMulta falla DESPUÉS de guardar el archivo, el archivo físico se elimina (borrarUpload)", async () => {
    vi.mocked(registrarDocumentoMulta).mockRejectedValue(new Error("INSERT falló"));
    const response = await POST(reqConArchivo("boleta.pdf"), idCtx);
    expect(response.status).toBe(500);
    expect(guardarUpload).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/multas/multa9_x.pdf");
  });

  it("no borra nada cuando el INSERT sí tuvo éxito", async () => {
    const response = await POST(reqConArchivo("boleta.pdf"), idCtx);
    expect(response.status).toBe(201);
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it.each(["boleta.jpg", "boleta.jpeg", "boleta.png", "boleta.pdf"])(
    "2-5) %s permitido",
    async (nombre) => {
      const response = await POST(reqConArchivo(nombre), idCtx);
      expect(response.status).toBe(201);
      expect(guardarUpload).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["boleta.webp", "boleta.bmp"])(
    "6-7) %s rechazado (formato no permitido en Multas, aunque el helper global sí lo admita)",
    async (nombre) => {
      const response = await POST(reqConArchivo(nombre), idCtx);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/JPG, PNG o PDF/);
      expect(guardarUpload).not.toHaveBeenCalled();
    },
  );
});
