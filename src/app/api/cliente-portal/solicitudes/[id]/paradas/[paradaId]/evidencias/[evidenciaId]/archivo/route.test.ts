import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tms/cliente-portal-guard", () => ({ requireClienteSession: vi.fn() }));
vi.mock("@/lib/tms/cliente-portal-seguimiento", () => ({
  obtenerEvidenciaClienteParaArchivo: vi.fn(),
}));
vi.mock("@/lib/uploads", () => ({
  absPathFromRelative: vi.fn((p: string) => `/abs/${p}`),
  contentTypeFor: vi.fn(() => "image/jpeg"),
}));
vi.mock("fs", () => ({ readFileSync: vi.fn(() => Buffer.from("contenido-binario")) }));

import { readFileSync } from "fs";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerEvidenciaClienteParaArchivo } from "@/lib/tms/cliente-portal-seguimiento";
import { absPathFromRelative } from "@/lib/uploads";
import { GET } from "./route";

const SESSION_A = { usuarioClienteId: 10, empresaId: 7, clienteId: 30, nombre: "Contacto A" };

function ctx(id: string, paradaId: string, evidenciaId: string) {
  return { params: Promise.resolve({ id, paradaId, evidenciaId }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClienteSession).mockResolvedValue({
    session: SESSION_A,
  } as Awaited<ReturnType<typeof requireClienteSession>>);
});

describe("GET .../evidencias/[evidenciaId]/archivo", () => {
  it("sin sesión → 401", async () => {
    vi.mocked(requireClienteSession).mockResolvedValue({
      error: new Response(null, { status: 401 }) as never,
    } as Awaited<ReturnType<typeof requireClienteSession>>);
    const res = await GET(new Request("http://localhost"), ctx("500", "1", "1"));
    expect(res.status).toBe(401);
    expect(obtenerEvidenciaClienteParaArchivo).not.toHaveBeenCalled();
  });

  it("ids no numéricos → 404, nunca llega al dominio", async () => {
    const res = await GET(new Request("http://localhost"), ctx("500", "1", "abc"));
    expect(res.status).toBe(404);
    expect(obtenerEvidenciaClienteParaArchivo).not.toHaveBeenCalled();
  });

  it("revalida SIEMPRE la cadena completa: empresaId/clienteId de sesión, solicitudId/paradaId/evidenciaId de la URL", async () => {
    vi.mocked(obtenerEvidenciaClienteParaArchivo).mockResolvedValue({
      rutaRelativa: "flota/2026/09/foto1.jpg",
      nombreOriginal: "foto1.jpg",
      mime: "image/jpeg",
    });
    await GET(new Request("http://localhost"), ctx("500", "42", "1"));
    expect(obtenerEvidenciaClienteParaArchivo).toHaveBeenCalledWith(7, 30, 500, 42, 1);
  });

  it("IDOR — evidenciaId existe pero fuera del plan/parada autorizados (dominio devuelve null) → 404", async () => {
    vi.mocked(obtenerEvidenciaClienteParaArchivo).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), ctx("500", "42", "9999"));
    expect(res.status).toBe(404);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("evidencia registrada pero archivo físico no encontrado (readFileSync lanza) → 404, no 500", async () => {
    vi.mocked(obtenerEvidenciaClienteParaArchivo).mockResolvedValue({
      rutaRelativa: "flota/2026/09/foto1.jpg",
      nombreOriginal: "foto1.jpg",
      mime: "image/jpeg",
    });
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const res = await GET(new Request("http://localhost"), ctx("500", "42", "1"));
    expect(res.status).toBe(404);
  });

  it("caso feliz → 200, streamea el archivo con headers correctos y SIN exponer la ruta real en ningún header/JSON", async () => {
    vi.mocked(obtenerEvidenciaClienteParaArchivo).mockResolvedValue({
      rutaRelativa: "flota/2026/09/foto1.jpg",
      nombreOriginal: "foto1.jpg",
      mime: "image/jpeg",
    });
    const res = await GET(new Request("http://localhost"), ctx("500", "42", "1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="foto1.jpg"');
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    // absPathFromRelative se llama server-side; ningún header expone la ruta absoluta ni relativa.
    expect(absPathFromRelative).toHaveBeenCalledWith("flota/2026/09/foto1.jpg");
    for (const [, value] of res.headers.entries()) {
      expect(value).not.toMatch(/flota\/2026\/09|\/abs\//);
    }
  });
});
