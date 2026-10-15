import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/flota/viajes-piloto", () => ({ colaboradorParticipaEnViaje: vi.fn() }));
vi.mock("@/lib/flota/combustible", () => ({ listarCargasCombustibleViaje: vi.fn(), obtenerArchivoCargaCombustible: vi.fn(), registrarCargaCombustible: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn(), contentTypeFor: vi.fn() }));
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { registrarCargaCombustible } from "@/lib/flota/combustible";
import { GET, POST } from "./route";
const ctx = { params: Promise.resolve({ id: "5" }) };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue({ empresaId: 7, empleadoId: 42 } as never);
  vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
});
it("captura retirada: POST 410 no toca sesión, archivos ni escritura", async () => {
  expect((await POST()).status).toBe(410);
  expect(registrarCargaCombustible).not.toHaveBeenCalled();
  expect(getColaboradorSession).not.toHaveBeenCalled();
});
describe("GET /api/portal/viajes/[id]/combustible", () => {
  it("exige participación en el viaje", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
  });

  it("lista las cargas propias del viaje con su url de foto", async () => {
    const { listarCargasCombustibleViaje } = await import("@/lib/flota/combustible");
    vi.mocked(listarCargasCombustibleViaje).mockResolvedValue([
      {
        id: 1, viajeId: 5, tipoCombustible: "diesel", numeroVale: "A-12345", fechaConsumo: "2026-09-02",
        galones: 40, monto: 850.5, precioGalon: 21.26, km: 12000, gasolinera: "Shell Zona 10",
        nombreArchivo: "vale.jpg", estado: "PENDIENTE", motivoRechazo: null, creadoPor: "portal:E001",
        creadoEn: "2026-09-03 10:00:00",
      },
    ]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cargas[0].url).toBe("/api/portal/viajes/5/combustible?adjuntoId=1");
  });
});
